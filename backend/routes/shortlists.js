const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

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

// Is req.user an active member of band `bandId`?
async function isActiveMember(client, bandId, userId) {
  const result = await client.query(
    `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
    [bandId, userId]
  );
  return result.rowCount > 0;
}

// GET /api/shortlists/mine — every shortlist across every band the caller is an
// active member of, for the Shortlists card's band picker and the add-to-shortlist
// popover.
router.get('/mine', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT sl.id, sl.name, sl.band_id, b.name AS band_name, sl.created_by, sl.created_at,
         COUNT(ss.id) AS item_count
       FROM shortlists sl
       JOIN band_members bm ON bm.band_id = sl.band_id AND bm.user_id = $1 AND bm.status = 'active'
       JOIN bands b ON b.id = sl.band_id
       LEFT JOIN shortlist_sessions ss ON ss.shortlist_id = sl.id
       GROUP BY sl.id
       ORDER BY b.name, sl.name`,
      [req.user.id]
    );
    res.json({ shortlists: result.rows });
  } catch (err) {
    console.error('Error fetching shortlists:', err);
    res.status(500).json({ message: 'Failed to fetch shortlists' });
  } finally {
    client.release();
  }
});

// POST /api/shortlists — create a shortlist. Any active band member can create one.
router.post('/', authenticateToken, async (req, res) => {
  const { band_id, name } = req.body || {};
  const bandId = parseInt(band_id, 10);
  if (!bandId || !name || !name.trim()) {
    return res.status(400).json({ message: 'band_id and name are required' });
  }

  const client = await getClient();
  try {
    if (!(await isActiveMember(client, bandId, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    const insertResult = await client.query(
      'INSERT INTO shortlists (band_id, name, created_by) VALUES ($1, $2, $3)',
      [bandId, name.trim(), req.user.id]
    );
    const created = await client.query(
      `SELECT sl.id, sl.name, sl.band_id, b.name AS band_name, sl.created_by, sl.created_at, 0 AS item_count
       FROM shortlists sl JOIN bands b ON b.id = sl.band_id WHERE sl.id = $1`,
      [insertResult.insertId]
    );
    res.status(201).json({ shortlist: created.rows[0] });
  } catch (err) {
    console.error('Error creating shortlist:', err);
    res.status(500).json({ message: 'Failed to create shortlist' });
  } finally {
    client.release();
  }
});

// PATCH /api/shortlists/:id — rename. Any active member of the shortlist's band.
router.patch('/:id', authenticateToken, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ message: 'name is required' });

  const client = await getClient();
  try {
    const existing = await client.query('SELECT band_id FROM shortlists WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Shortlist not found' });
    if (!(await isActiveMember(client, existing.rows[0].band_id, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    await client.query('UPDATE shortlists SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
    res.json({ message: 'Shortlist renamed' });
  } catch (err) {
    console.error('Error renaming shortlist:', err);
    res.status(500).json({ message: 'Failed to rename shortlist' });
  } finally {
    client.release();
  }
});

// DELETE /api/shortlists/:id — any active member of the shortlist's band.
router.delete('/:id', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const existing = await client.query('SELECT band_id FROM shortlists WHERE id = $1', [req.params.id]);
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Shortlist not found' });
    if (!(await isActiveMember(client, existing.rows[0].band_id, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    await client.query('DELETE FROM shortlists WHERE id = $1', [req.params.id]);
    res.json({ message: 'Shortlist deleted' });
  } catch (err) {
    console.error('Error deleting shortlist:', err);
    res.status(500).json({ message: 'Failed to delete shortlist' });
  } finally {
    client.release();
  }
});

// GET /api/shortlists/:id — shortlist detail + its recordings, any active member of
// the shortlist's band.
router.get('/:id', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const shortlistResult = await client.query(
      `SELECT sl.id, sl.name, sl.band_id, b.name AS band_name, sl.created_by, sl.created_at
       FROM shortlists sl JOIN bands b ON b.id = sl.band_id WHERE sl.id = $1`,
      [req.params.id]
    );
    if (shortlistResult.rowCount === 0) return res.status(404).json({ message: 'Shortlist not found' });
    const shortlist = shortlistResult.rows[0];
    if (!(await isActiveMember(client, shortlist.band_id, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    const sessionsResult = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, sb.name AS band_name, s.duration_ms, u.handle AS uploader_handle,
         ss.added_by, ss.added_at,
         ROUND(AVG(sr.rating), 1) AS avg_rating,
         COUNT(DISTINCT sr.user_id) AS rating_count,
         MAX(CASE WHEN sr.user_id = $2 THEN sr.rating END) AS my_rating,
         COUNT(DISTINCT sc.id) AS comment_count
       FROM shortlist_sessions ss
       JOIN sessions s ON s.id = ss.session_id
       LEFT JOIN bands sb ON sb.id = s.band_id
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN session_ratings sr ON sr.session_id = s.id
       LEFT JOIN session_comments sc ON sc.session_id = s.id AND sc.is_deleted = 0
       WHERE ss.shortlist_id = $1
       GROUP BY s.id, ss.added_by, ss.added_at
       ORDER BY ss.added_at DESC`,
      [req.params.id, req.user.id]
    );

    res.json({ shortlist, sessions: sessionsResult.rows });
  } catch (err) {
    console.error('Error fetching shortlist:', err);
    res.status(500).json({ message: 'Failed to fetch shortlist' });
  } finally {
    client.release();
  }
});

// POST /api/shortlists/:id/sessions — add a recording. The actor must be an active
// member of the shortlist's band, AND the recording's uploader must also be an active
// member of that same band (covers band/individual/mashup recordings uploaded by any
// current bandmate, including the actor's own).
router.post('/:id/sessions', authenticateToken, async (req, res) => {
  const { session_id } = req.body || {};
  const sessionId = parseInt(session_id, 10);
  if (!sessionId) return res.status(400).json({ message: 'session_id is required' });

  const client = await getClient();
  try {
    const shortlistResult = await client.query('SELECT band_id FROM shortlists WHERE id = $1', [req.params.id]);
    if (shortlistResult.rowCount === 0) return res.status(404).json({ message: 'Shortlist not found' });
    const bandId = shortlistResult.rows[0].band_id;
    if (!(await isActiveMember(client, bandId, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    const sessionResult = await client.query('SELECT user_id FROM sessions WHERE id = $1', [sessionId]);
    if (sessionResult.rowCount === 0) return res.status(404).json({ message: 'Session not found' });
    if (!(await isActiveMember(client, bandId, sessionResult.rows[0].user_id))) {
      return res.status(403).json({ message: 'This recording was not uploaded by a current member of this band' });
    }

    await client.query(
      'INSERT IGNORE INTO shortlist_sessions (shortlist_id, session_id, added_by) VALUES ($1, $2, $3)',
      [req.params.id, sessionId, req.user.id]
    );
    res.status(201).json({ message: 'Added to shortlist' });
  } catch (err) {
    console.error('Error adding session to shortlist:', err);
    res.status(500).json({ message: 'Failed to add session to shortlist' });
  } finally {
    client.release();
  }
});

// DELETE /api/shortlists/:id/sessions/:sessionId — unlist a recording (does not
// delete the underlying session).
router.delete('/:id/sessions/:sessionId', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const shortlistResult = await client.query('SELECT band_id FROM shortlists WHERE id = $1', [req.params.id]);
    if (shortlistResult.rowCount === 0) return res.status(404).json({ message: 'Shortlist not found' });
    if (!(await isActiveMember(client, shortlistResult.rows[0].band_id, req.user.id))) {
      return res.status(403).json({ message: 'You must be an active member of this band' });
    }

    await client.query(
      'DELETE FROM shortlist_sessions WHERE shortlist_id = $1 AND session_id = $2',
      [req.params.id, req.params.sessionId]
    );
    res.json({ message: 'Removed from shortlist' });
  } catch (err) {
    console.error('Error removing session from shortlist:', err);
    res.status(500).json({ message: 'Failed to remove session from shortlist' });
  } finally {
    client.release();
  }
});

module.exports = router;
