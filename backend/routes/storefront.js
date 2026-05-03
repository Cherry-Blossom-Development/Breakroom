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

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$|^[a-z0-9]{3}$/;

// GET /api/storefront/public/:storeUrl  (no auth — must be before /)
router.get('/public/:storeUrl', async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT page_title, content, settings FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Store not found' });
    res.json(parseSettings(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch public storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront/check-url/:storeUrl  (auth required)
router.get('/check-url/:storeUrl', authenticate, async (req, res) => {
  const { storeUrl } = req.params;
  if (!SLUG_RE.test(storeUrl)) {
    return res.json({ available: false, reason: 'Use 3–60 lowercase letters, numbers, or hyphens (no leading/trailing hyphens).' });
  }
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT user_id FROM user_storefront WHERE store_url = $1',
      [storeUrl]
    );
    if (result.rowCount === 0) return res.json({ available: true });
    res.json({ available: result.rows[0].user_id === req.user.id });
  } catch (err) {
    console.error('Failed to check store URL:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront
router.get('/', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT id, store_url, page_title, content, settings, updated_at FROM user_storefront WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return res.json(null);
    res.json(parseSettings(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/storefront — upsert
router.put('/', authenticate, async (req, res) => {
  const { store_url, page_title, content, settings } = req.body;

  if (store_url && !SLUG_RE.test(store_url)) {
    return res.status(400).json({ message: 'Invalid store URL format.' });
  }

  let client;
  try {
    client = await getClient();

    // If a URL is provided, ensure it isn't taken by someone else
    if (store_url) {
      const conflict = await client.query(
        'SELECT user_id FROM user_storefront WHERE store_url = $1 AND user_id != $2',
        [store_url, req.user.id]
      );
      if (conflict.rowCount > 0) {
        client.release();
        return res.status(409).json({ message: 'That store URL is already taken.' });
      }
    }

    await client.query(
      `INSERT INTO user_storefront (user_id, store_url, page_title, content, settings)
       VALUES ($1, $2, $3, $4, $5)
       ON DUPLICATE KEY UPDATE store_url = $2, page_title = $3, content = $4, settings = $5`,
      [req.user.id, store_url || null, page_title || '', content || '', JSON.stringify(settings || {})]
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
