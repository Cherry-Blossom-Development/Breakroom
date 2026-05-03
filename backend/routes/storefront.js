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

// GET /api/storefront
router.get('/', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT id, page_title, content, settings, updated_at FROM user_storefront WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return res.json(null);
    const row = result.rows[0];
    if (typeof row.settings === 'string') {
      try { row.settings = JSON.parse(row.settings); } catch { row.settings = {}; }
    }
    res.json(row);
  } catch (err) {
    console.error('Failed to fetch storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/storefront — upsert
router.put('/', authenticate, async (req, res) => {
  const { page_title, content, settings } = req.body;
  let client;
  try {
    client = await getClient();
    await client.query(
      `INSERT INTO user_storefront (user_id, page_title, content, settings)
       VALUES ($1, $2, $3, $4)
       ON DUPLICATE KEY UPDATE page_title = $2, content = $3, settings = $4`,
      [req.user.id, page_title || '', content || '', JSON.stringify(settings || {})]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('Failed to save storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
