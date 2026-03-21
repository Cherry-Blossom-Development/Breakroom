const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3, getS3Url } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

const FIELDS = 'id, name, s3_key, file_size, mime_type, uploaded_at, recorded_at, rating';

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

// GET /api/sessions — list the current user's sessions
router.get('/', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT ${FIELDS} FROM sessions WHERE user_id = $1 ORDER BY recorded_at DESC, uploaded_at DESC`,
      [req.user.id]
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ message: 'Failed to fetch sessions' });
  } finally {
    client.release();
  }
});

// GET /api/sessions/:id/stream — redirect to S3 URL for audio playback
router.get('/:id/stream', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT s3_key FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Session not found' });
    res.redirect(302, getS3Url(result.rows[0].s3_key));
  } catch (err) {
    console.error('Error streaming session:', err);
    res.status(500).json({ message: 'Failed to stream session' });
  } finally {
    client.release();
  }
});

// POST /api/sessions — upload a new session
router.post('/', authenticateToken, audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No audio file uploaded' });

  const { name, recorded_at } = req.body;
  const ext = path.extname(req.file.originalname).toLowerCase() || '.audio';
  const s3Key = `sessions/${req.user.id}/${Date.now()}${ext}`;

  const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
  if (!uploadResult.success) {
    return res.status(500).json({ message: 'Failed to upload to storage: ' + uploadResult.error });
  }

  const client = await getClient();
  try {
    const insertResult = await client.query(
      'INSERT INTO sessions (user_id, name, s3_key, file_size, mime_type, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user.id, name || 'Untitled Session', s3Key, req.file.size, req.file.mimetype, recorded_at || null]
    );
    const session = await client.query(
      `SELECT ${FIELDS} FROM sessions WHERE id = $1`,
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

// PATCH /api/sessions/:id — update name, recorded_at, and/or rating
router.patch('/:id', authenticateToken, async (req, res) => {
  const { name, recorded_at, rating } = req.body;
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
    if (rating !== undefined) {
      const r = rating === null ? null : parseInt(rating, 10);
      if (r !== null && (r < 1 || r > 10)) return res.status(400).json({ message: 'Rating must be 1–10' });
      fields.push(`rating = $${idx++}`);
      values.push(r);
    }
    if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    values.push(req.params.id);
    await client.query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    const updated = await client.query(`SELECT ${FIELDS} FROM sessions WHERE id = $1`, [req.params.id]);
    res.json({ session: updated.rows[0] });
  } catch (err) {
    console.error('Error updating session:', err);
    res.status(500).json({ message: 'Failed to update session' });
  } finally {
    client.release();
  }
});

// DELETE /api/sessions/:id — delete session and remove from S3
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
