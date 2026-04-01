const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3, getS3Url, streamFromS3 } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');

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

// GET /api/sessions — list the current user's sessions with avg rating
router.get('/', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name,
         s.instrument_id, i.name AS instrument_name,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating
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
         u.handle AS uploader_handle,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(sr.rating) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating
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

// GET /api/sessions/:id/stream — access-checked proxy from S3 (owner or active band member)
router.get('/:id/stream', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT s.s3_key FROM sessions s
       LEFT JOIN band_members bm ON bm.band_id = s.band_id AND bm.user_id = $2 AND bm.status = 'active'
       WHERE s.id = $1 AND (s.user_id = $2 OR bm.band_id IS NOT NULL)`,
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Session not found' });
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
  const bandIdVal = band_id ? parseInt(band_id, 10) : null;
  const instrumentIdVal = instrument_id ? parseInt(instrument_id, 10) : null;
  const sessionTypeVal = session_type === 'individual' ? 'individual' : 'band';
  const ext = path.extname(req.file.originalname).toLowerCase() || '.audio';
  const s3Key = `sessions/${req.user.id}/${Date.now()}${ext}`;

  const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
  if (!uploadResult.success) {
    return res.status(500).json({ message: 'Failed to upload to storage: ' + uploadResult.error });
  }

  const client = await getClient();
  try {
    const insertResult = await client.query(
      'INSERT INTO sessions (user_id, name, s3_key, file_size, mime_type, recorded_at, band_id, session_type, instrument_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [req.user.id, name || 'Untitled Session', s3Key, req.file.size, req.file.mimetype, recorded_at || null, bandIdVal, sessionTypeVal, instrumentIdVal]
    );
    const session = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name, s.instrument_id, i.name AS instrument_name,
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
    // Allow session owner or active band member to rate
    const existing = await client.query(
      `SELECT s.id FROM sessions s
       LEFT JOIN band_members bm ON bm.band_id = s.band_id AND bm.user_id = $2 AND bm.status = 'active'
       WHERE s.id = $1 AND (s.user_id = $2 OR bm.band_id IS NOT NULL)`,
      [req.params.id, req.user.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Session not found' });

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
