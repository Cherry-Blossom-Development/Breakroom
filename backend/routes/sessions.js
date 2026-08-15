const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3, getS3Url, streamFromS3 } = require('../utilities/aws-s3');
const { normalizeToWav } = require('../utilities/audio');
const { extractToken } = require('../utilities/auth');
const { isSubscribed } = require('../utilities/subscription');
const { emitToUser } = require('../utilities/socket');
const { checkAndFilterContent } = require('../utilities/contentFilter');
const { sendToUser } = require('../utilities/fcm');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Base SELECT used in GET / and after POST
const sessionSelect = (userId) => ({
  sql: `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at,
          ROUND(AVG(sr.rating), 1) AS avg_rating,
          COUNT(sr.rating) AS rating_count,
          MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating
        FROM sessions s
        LEFT JOIN session_ratings sr ON sr.session_id = s.id`,
  // caller appends WHERE + GROUP BY
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const allowedExts = /\.(mp3|wav|aac|ogg|flac|m4a|webm|opus)$/i;
    const isAudioMime = /^audio\//.test(file.mimetype);
    const isAllowedExt = allowedExts.test(file.originalname);
    if (isAudioMime || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

const authenticateToken = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = { id: user.rows[0].id, handle: user.rows[0].handle };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Does `userId` have access to session `sessionId`? Owner, active member of the
// session's own band_id, or active member of a band that has this session in one of
// its shortlists (widens visibility only to what's been explicitly shortlisted, not
// to every recording any bandmate has ever uploaded).
async function hasSessionAccess(client, sessionId, userId) {
  const result = await client.query(
    `SELECT s.id FROM sessions s
     LEFT JOIN band_members bm ON bm.band_id = s.band_id AND bm.user_id = $2 AND bm.status = 'active'
     WHERE s.id = $1 AND (
       s.user_id = $2 OR bm.band_id IS NOT NULL OR EXISTS (
         SELECT 1 FROM shortlist_sessions ss
         JOIN shortlists sl ON sl.id = ss.shortlist_id
         JOIN band_members bm2 ON bm2.band_id = sl.band_id AND bm2.user_id = $2 AND bm2.status = 'active'
         WHERE ss.session_id = s.id
       )
     )`,
    [sessionId, userId]
  );
  return result.rowCount > 0;
}

// GET /api/sessions — list the current user's sessions with avg rating
router.get('/', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name,
         s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating,
         (SELECT COUNT(*) FROM shortlist_sessions ss WHERE ss.session_id = s.id) AS shortlist_count
       FROM sessions s
       LEFT JOIN bands b ON b.id = s.band_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN session_ratings sr ON sr.session_id = s.id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.recorded_at DESC, s.uploaded_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ message: 'Failed to fetch sessions' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/band-members — sessions from other active members of shared bands
router.get('/band-members', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name,
         s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         u.handle AS uploader_handle,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating,
         (SELECT COUNT(*) FROM shortlist_sessions ss WHERE ss.session_id = s.id) AS shortlist_count
       FROM sessions s
       JOIN band_members bm_me ON bm_me.band_id = s.band_id AND bm_me.user_id = $1 AND bm_me.status = 'active'
       JOIN band_members bm_them ON bm_them.band_id = s.band_id AND bm_them.user_id = s.user_id AND bm_them.status = 'active'
       LEFT JOIN bands b ON b.id = s.band_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN session_ratings sr ON sr.session_id = s.id
       WHERE s.user_id != $1
       GROUP BY s.id
       ORDER BY s.recorded_at DESC, s.uploaded_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Error fetching band member sessions:', err);
    res.status(500).json({ message: 'Failed to fetch band member sessions' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/practice-suggestions — recent-history defaults for the Band Practice/
// Individual upload/record forms: the user's most common band, and (for a given or resolved
// band) their most common session names, both scoped to the last 2 months and to whichever
// sessionType the calling form cares about (band practice vs. individual recordings)
router.get('/practice-suggestions', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const sessionType = ['band', 'individual', 'mashup'].includes(req.query.sessionType) ? req.query.sessionType : 'band';

    const bandRow = await client.query(
      `SELECT s.band_id, COUNT(*) AS cnt
       FROM sessions s
       JOIN band_members bm ON bm.band_id = s.band_id AND bm.user_id = $1 AND bm.status = 'active'
       WHERE s.user_id = $1 AND s.band_id IS NOT NULL AND s.session_type = $2
         AND s.uploaded_at >= DATE_SUB(NOW(), INTERVAL 2 MONTH)
       GROUP BY s.band_id
       ORDER BY cnt DESC, MAX(s.uploaded_at) DESC
       LIMIT 1`,
      [req.user.id, sessionType]
    );
    const defaultBandId = bandRow.rowCount > 0 ? bandRow.rows[0].band_id : null;
    const targetBandId = req.query.bandId ? parseInt(req.query.bandId, 10) : defaultBandId;

    let commonNames = [];
    if (targetBandId) {
      const nameRows = await client.query(
        `SELECT name, COUNT(*) AS cnt
         FROM sessions
         WHERE user_id = $1 AND band_id = $2 AND session_type = $3
           AND uploaded_at >= DATE_SUB(NOW(), INTERVAL 2 MONTH)
         GROUP BY name
         ORDER BY cnt DESC, MAX(uploaded_at) DESC
         LIMIT 10`,
        [req.user.id, targetBandId, sessionType]
      );
      commonNames = nameRows.rows.map(r => r.name);
    }

    res.json({ defaultBandId, commonNames });
  } catch (err) {
    console.error('Error fetching practice suggestions:', err);
    res.status(500).json({ message: 'Failed to fetch suggestions' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/stream — access-checked proxy from S3 (owner, active band
// member, or active member of a band that has this session in one of its shortlists)
router.get('/:id/stream', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    if (!(await hasSessionAccess(client, req.params.id, req.user.id))) {
      return res.status(404).json({ message: 'Session not found' });
    }
    const result = await client.query('SELECT s3_key FROM sessions WHERE id = $1', [req.params.id]);
    await streamFromS3(result.rows[0].s3_key, req, res);
  } catch (err) {
    console.error('Error streaming session:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to stream session' });
  } finally {
    client.release();
  }
});

// POST /api/sessions — upload a new session
router.post('/', authenticateToken, audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No audio file uploaded' });

  const { name, recorded_at, band_id, session_type, instrument_id } = req.body;
  const sessionTypeVal = session_type === 'individual' ? 'individual' : session_type === 'mashup' ? 'mashup' : 'band';

  // Enforce free-tier limits: 3 band sessions, 3 individual sessions
  const FREE_LIMITS = { band: 3, individual: 3 };
  const limitClient = await getClient();
  try {
    const countResult = await limitClient.query(
      'SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = $1 AND session_type = $2',
      [req.user.id, sessionTypeVal]
    );
    const count = parseInt(countResult.rows[0].cnt, 10);
    if (count >= FREE_LIMITS[sessionTypeVal]) {
      const { subscribed } = await isSubscribed(req.user.id);
      if (!subscribed) {
        return res.status(402).json({
          message: `Free accounts are limited to ${FREE_LIMITS[sessionTypeVal]} ${sessionTypeVal} sessions`,
          requiresSubscription: true,
        });
      }
    }
  } finally {
    limitClient.release();
  }

  const bandIdVal = band_id ? parseInt(band_id, 10) : null;
  const instrumentIdVal = instrument_id ? parseInt(instrument_id, 10) : null;

  // Normalize to WAV: convert any format → 44100Hz 16-bit WAV with EBU R128 loudness normalization
  let wavBuffer, durationMs;
  try {
    const result = await normalizeToWav(req.file.buffer);
    wavBuffer = result.buffer;
    durationMs = result.durationMs;
  } catch (err) {
    console.error('Audio normalization failed:', err);
    return res.status(500).json({ message: 'Failed to process audio: ' + err.message });
  }

  const s3Key = `sessions/${req.user.id}/${Date.now()}.wav`;

  const uploadResult = await uploadToS3(wavBuffer, s3Key, 'audio/wav');
  if (!uploadResult.success) {
    return res.status(500).json({ message: 'Failed to upload to storage: ' + uploadResult.error });
  }

  const client = await getClient();
  try {
    const insertResult = await client.query(
      'INSERT INTO sessions (user_id, name, s3_key, file_size, mime_type, recorded_at, band_id, session_type, instrument_id, normalized, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [req.user.id, name || 'Untitled Session', s3Key, wavBuffer.length, 'audio/wav', recorded_at || null, bandIdVal, sessionTypeVal, instrumentIdVal, 1, durationMs]
    );
    const session = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name, s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         NULL AS avg_rating, 0 AS rating_count, NULL AS my_rating
       FROM sessions s
       LEFT JOIN bands b ON b.id = s.band_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       WHERE s.id = $1`,
      [insertResult.insertId]
    );
    res.status(201).json({ session: session.rows[0] });
  } catch (err) {
    console.error('Error saving session:', err);
    await deleteFromS3(s3Key);
    res.status(500).json({ message: 'Failed to save session' });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/rate — upsert the current user's rating (null to clear)
router.post('/:id/rate', authenticateToken, async (req, res) => {
  const { rating } = req.body;
  const client = await getClient();
  try {
    // Allow session owner, active band member, or active member of a band that has
    // this session in one of its shortlists to rate
    if (!(await hasSessionAccess(client, req.params.id, req.user.id))) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (rating === null || rating === undefined) {
      await client.query(
        'DELETE FROM session_ratings WHERE session_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
    } else {
      const r = parseInt(rating, 10);
      if (r < 1 || r > 10) return res.status(400).json({ message: 'Rating must be 1–10' });
      await client.query(
        'INSERT INTO session_ratings (session_id, user_id, rating) VALUES ($1, $2, $3) ON DUPLICATE KEY UPDATE rating = $3',
        [req.params.id, req.user.id, r]
      );
    }

    const updated = await client.query(
      `SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(rating) AS rating_count,
              MAX(CASE WHEN user_id = $2 THEN rating END) AS my_rating
       FROM session_ratings WHERE session_id = $1`,
      [req.params.id, req.user.id]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Error saving rating:', err);
    res.status(500).json({ message: 'Failed to save rating' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/shortlists — which shortlist IDs (within bands the caller is
// an active member of) this session already belongs to. Feeds the add-to-shortlist
// popover's pre-checked boxes.
router.get('/:id/shortlists', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT ss.shortlist_id
       FROM shortlist_sessions ss
       JOIN shortlists sl ON sl.id = ss.shortlist_id
       JOIN band_members bm ON bm.band_id = sl.band_id AND bm.user_id = $2 AND bm.status = 'active'
       WHERE ss.session_id = $1`,
      [req.params.id, req.user.id]
    );
    res.json({ shortlistIds: result.rows.map(r => r.shortlist_id) });
  } catch (err) {
    console.error('Error fetching session shortlists:', err);
    res.status(500).json({ message: 'Failed to fetch session shortlists' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/comments — threaded (one level deep) discussion attached to
// this recording. Same access rule as streaming/rating.
router.get('/:id/comments', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    if (!(await hasSessionAccess(client, req.params.id, req.user.id))) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const result = await client.query(
      `SELECT sc.id, sc.session_id, sc.user_id, sc.parent_id, sc.content, sc.created_at,
         u.handle AS author_handle, u.first_name AS author_first_name,
         u.last_name AS author_last_name, u.photo_path AS author_photo
       FROM session_comments sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.session_id = $1 AND sc.is_deleted = 0
       ORDER BY sc.created_at ASC`,
      [req.params.id]
    );

    const commentsMap = new Map();
    const topLevel = [];
    result.rows.forEach(row => {
      commentsMap.set(row.id, {
        id: row.id,
        sessionId: row.session_id,
        userId: row.user_id,
        parentId: row.parent_id,
        content: row.content,
        createdAt: row.created_at,
        author: {
          handle: row.author_handle,
          firstName: row.author_first_name,
          lastName: row.author_last_name,
          photo: row.author_photo
        },
        replies: []
      });
    });
    commentsMap.forEach(comment => {
      if (comment.parentId && commentsMap.has(comment.parentId)) {
        commentsMap.get(comment.parentId).replies.push(comment);
      } else {
        topLevel.push(comment);
      }
    });

    res.json({ comments: topLevel });
  } catch (err) {
    console.error('Error fetching session comments:', err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/comments — post a comment (or a one-level-deep reply via
// parent_id). Notifies other active members of any band whose shortlist includes this
// session.
router.post('/:id/comments', authenticateToken, async (req, res) => {
  const { content, parent_id } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ message: 'Comment content is required' });
  if (content.length > 2000) return res.status(400).json({ message: 'Comment cannot exceed 2000 characters' });

  const client = await getClient();
  try {
    if (!(await hasSessionAccess(client, req.params.id, req.user.id))) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (parent_id) {
      const parentCheck = await client.query(
        'SELECT id FROM session_comments WHERE id = $1 AND session_id = $2 AND is_deleted = 0',
        [parent_id, req.params.id]
      );
      if (parentCheck.rowCount === 0) return res.status(400).json({ message: 'Parent comment not found' });
    }

    const insertResult = await client.query(
      'INSERT INTO session_comments (session_id, user_id, parent_id, content) VALUES ($1, $2, $3, $4)',
      [req.params.id, req.user.id, parent_id || null, content.trim()]
    );

    const row = (await client.query(
      `SELECT sc.id, sc.session_id, sc.user_id, sc.parent_id, sc.content, sc.created_at,
         u.handle AS author_handle, u.first_name AS author_first_name,
         u.last_name AS author_last_name, u.photo_path AS author_photo
       FROM session_comments sc JOIN users u ON u.id = sc.user_id WHERE sc.id = $1`,
      [insertResult.insertId]
    )).rows[0];

    const comment = {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      parentId: row.parent_id,
      content: row.content,
      createdAt: row.created_at,
      author: {
        handle: row.author_handle,
        firstName: row.author_first_name,
        lastName: row.author_last_name,
        photo: row.author_photo
      },
      replies: []
    };

    checkAndFilterContent('comment', comment.id, [content], req.user.id).catch(() => {});

    // Notify other active members of any band that has this session shortlisted
    const notifyResult = await client.query(
      `SELECT DISTINCT bm.user_id
       FROM shortlist_sessions ss
       JOIN shortlists sl ON sl.id = ss.shortlist_id
       JOIN band_members bm ON bm.band_id = sl.band_id AND bm.status = 'active'
       WHERE ss.session_id = $1 AND bm.user_id != $2`,
      [req.params.id, req.user.id]
    );
    for (const { user_id: targetUserId } of notifyResult.rows) {
      const settingResult = await client.query(
        'SELECT notifications_enabled FROM user_settings WHERE user_id = $1',
        [targetUserId]
      );
      const s = settingResult.rows[0];
      if (!s || s.notifications_enabled) {
        emitToUser(targetUserId, 'shortlist_comment_badge_update', {
          sessionId: parseInt(req.params.id, 10),
          commenterHandle: req.user.handle,
          preview: content.substring(0, 100)
        });
        sendToUser(targetUserId, {
          type: 'shortlist_comment',
          sessionId: String(req.params.id),
          commenterHandle: req.user.handle,
          preview: content.substring(0, 100)
        }).catch(() => {});
      }
    }

    res.status(201).json({ comment });
  } catch (err) {
    console.error('Error creating session comment:', err);
    res.status(500).json({ message: 'Failed to create comment' });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/comments/:commentId — soft delete, author only
router.delete('/comments/:commentId', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const existing = await client.query(
      'SELECT user_id FROM session_comments WHERE id = $1 AND is_deleted = 0',
      [req.params.commentId]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Comment not found' });
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own comments' });
    }

    await client.query('UPDATE session_comments SET is_deleted = 1 WHERE id = $1', [req.params.commentId]);
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('Error deleting session comment:', err);
    res.status(500).json({ message: 'Failed to delete comment' });
  } finally {
    client.release();
  }
});

// POST /api/sessions/:id/sources — record which source sessions went into a mashup
router.post('/:id/sources', authenticateToken, async (req, res) => {
  const { sources } = req.body; // [{ session_id, volume }]
  if (!Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ message: 'sources must be a non-empty array' });
  }

  const client = await getClient();
  try {
    const mashup = await client.query(
      "SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mashup'",
      [req.params.id, req.user.id]
    );
    if (mashup.rowCount === 0) return res.status(404).json({ message: 'Mashup session not found' });

    for (const src of sources) {
      const sessionId = parseInt(src.session_id, 10);
      const volume = parseFloat(src.volume);
      if (!sessionId || isNaN(volume)) continue;
      await client.query(
        'INSERT INTO mashup_sources (mashup_session_id, source_session_id, volume) VALUES ($1, $2, $3)',
        [req.params.id, sessionId, Math.max(0, Math.min(1, volume))]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error recording mashup sources:', err);
    res.status(500).json({ message: 'Failed to record mashup sources' });
  } finally {
    client.release();
  }
});

// PATCH /api/sessions/:id — update name, recorded_at, band_id, and/or instrument_id
router.patch('/:id', authenticateToken, async (req, res) => {
  const { name, recorded_at, band_id, instrument_id } = req.body;
  const client = await getClient();
  try {
    const existing = await client.query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Session not found' });

    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (recorded_at !== undefined) { fields.push(`recorded_at = $${idx++}`); values.push(recorded_at || null); }
    if (band_id !== undefined) { fields.push(`band_id = $${idx++}`); values.push(band_id || null); }
    if (instrument_id !== undefined) { fields.push(`instrument_id = $${idx++}`); values.push(instrument_id || null); }
    if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    values.push(req.params.id);
    await client.query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    const updated = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name,
         s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating
       FROM sessions s
       LEFT JOIN bands b ON b.id = s.band_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN session_ratings sr ON sr.session_id = s.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [req.params.id, req.user.id]
    );
    res.json({ session: updated.rows[0] });
  } catch (err) {
    console.error('Error updating session:', err);
    res.status(500).json({ message: 'Failed to update session' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/public — public access to session info and audio
// No authentication required - anyone with the link can view/play
router.get('/:id/public', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at,
         u.handle AS uploader_handle,
         s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN session_ratings sr ON sr.session_id = s.id
       WHERE s.id = $1
       GROUP BY s.id, u.handle, i.name`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Session not found' });

    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('Error fetching public session:', err);
    res.status(500).json({ message: 'Failed to fetch session' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/public/stream — public streaming endpoint
// No authentication required - anyone with the link can stream
router.get('/:id/public/stream', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT s3_key FROM sessions WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Session not found' });
    await streamFromS3(result.rows[0].s3_key, req, res);
  } catch (err) {
    console.error('Error streaming public session:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to stream session' });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const existing = await client.query(
      'SELECT s3_key FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Session not found' });

    const s3Key = existing.rows[0].s3_key;
    await client.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    await deleteFromS3(s3Key);

    res.json({ message: 'Session deleted' });
  } catch (err) {
    console.error('Error deleting session:', err);
    res.status(500).json({ message: 'Failed to delete session' });
  } finally {
    client.release();
  }
});

module.exports = router;
