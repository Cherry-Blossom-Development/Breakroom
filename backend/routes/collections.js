const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const parseSettings = (row) => {
  if (row && typeof row.settings === 'string') {
    try { row.settings = JSON.parse(row.settings); } catch { row.settings = {}; }
  }
  return row;
};

// GET /api/collections
router.get('/', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT id, name, settings, created_at, updated_at FROM user_collections WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows.map(parseSettings));
  } catch (err) {
    console.error('Failed to fetch collections:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/collections
router.post('/', authenticate, async (req, res) => {
  const { name, settings } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
  let client;
  try {
    client = await getClient();
    const insert = await client.query(
      'INSERT INTO user_collections (user_id, name, settings) VALUES ($1, $2, $3)',
      [req.user.id, name.trim(), JSON.stringify(settings || {})]
    );
    const result = await client.query(
      'SELECT id, name, settings, created_at, updated_at FROM user_collections WHERE id = $1',
      [insert.insertId]
    );
    res.status(201).json(parseSettings(result.rows[0]));
  } catch (err) {
    console.error('Failed to create collection:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/collections/:id
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, settings } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'UPDATE user_collections SET name = $1, settings = $2 WHERE id = $3 AND user_id = $4',
      [name.trim(), JSON.stringify(settings || {}), id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Collection not found' });
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Failed to update collection:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/collections/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'DELETE FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Collection not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Failed to delete collection:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
