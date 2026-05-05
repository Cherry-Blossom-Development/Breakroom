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

const DEFAULT_SECTIONS = [
  { id: 'content', type: 'content', visible: true },
  { id: 'collections', type: 'collections', visible: true, title: 'My Collections' }
];

// GET /api/storefront/public/:storeUrl  (no auth — must be before /)
router.get('/public/:storeUrl', async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT user_id, page_title, content, settings FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Store not found' });

    const row = parseSettings(result.rows[0]);
    const sections = (row.settings && row.settings.sections) ? row.settings.sections : DEFAULT_SECTIONS;

    const collectionsVisible = sections.some(s => s.type === 'collections' && s.visible);
    let collections = [];
    if (collectionsVisible) {
      const colResult = await client.query(
        'SELECT id, name, settings FROM user_collections WHERE user_id = $1 ORDER BY created_at ASC',
        [row.user_id]
      );
      collections = colResult.rows.map(c => {
        if (c.settings && typeof c.settings === 'string') {
          try { c.settings = JSON.parse(c.settings); } catch { c.settings = {}; }
        }
        return c;
      });
    }

    res.json({
      page_title: row.page_title,
      content: row.content,
      settings: row.settings,
      sections,
      collections
    });
  } catch (err) {
    console.error('Failed to fetch public storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront/public/:storeUrl/collection/:collectionId  (no auth)
router.get('/public/:storeUrl/collection/:collectionId', async (req, res) => {
  let client;
  try {
    client = await getClient();
    // Resolve storeUrl → user_id
    const storeResult = await client.query(
      'SELECT user_id, page_title, settings FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (storeResult.rowCount === 0) return res.status(404).json({ message: 'Store not found' });

    const { user_id } = storeResult.rows[0];

    // Fetch collection — must belong to this store's owner
    const colResult = await client.query(
      'SELECT id, name, settings FROM user_collections WHERE id = $1 AND user_id = $2',
      [req.params.collectionId, user_id]
    );
    if (colResult.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    const collection = parseSettings(colResult.rows[0]);

    // Fetch available items only
    const itemResult = await client.query(
      `SELECT id, name, description, image_path, price_cents, shipping_cost_cents,
              weight_oz, length_in, width_in, height_in
       FROM collection_items
       WHERE collection_id = $1 AND is_available = 1
       ORDER BY display_order ASC, created_at ASC`,
      [req.params.collectionId]
    );

    res.json({
      store_url: req.params.storeUrl,
      store_title: storeResult.rows[0].page_title,
      collection,
      items: itemResult.rows
    });
  } catch (err) {
    console.error('Failed to fetch public collection:', err);
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
