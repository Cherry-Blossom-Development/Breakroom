const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3 } = require('../utilities/aws-s3');
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// =====================
// COLLECTION CRUD
// =====================

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

// GET /api/collections/:id
router.get('/:id', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT id, name, settings, created_at, updated_at FROM user_collections WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });
    res.json(parseSettings(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch collection:', err);
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
    // Fetch all item image_paths so we can clean up S3
    const items = await client.query(
      'SELECT image_path FROM collection_items WHERE collection_id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    const result = await client.query(
      'DELETE FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Collection not found' });
    // Clean up S3 images (fire and forget — don't block the response)
    for (const row of items.rows) {
      if (row.image_path) deleteFromS3(row.image_path).catch(() => {});
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Failed to delete collection:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// =====================
// COLLECTION ITEMS
// =====================

// GET /api/collections/:id/items
router.get('/:id/items', authenticate, async (req, res) => {
  const { id } = req.params;
  let client;
  try {
    client = await getClient();
    // Verify ownership
    const col = await client.query(
      'SELECT id FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (col.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    const result = await client.query(
      `SELECT id, name, description, image_path, display_order,
              price_cents, is_available, shipping_cost_cents,
              weight_oz, length_in, width_in, height_in,
              created_at, updated_at
       FROM collection_items WHERE collection_id = $1 ORDER BY display_order ASC, created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch items:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/collections/:id/items
router.post('/:id/items', authenticate, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

  const priceCents       = req.body.price        ? Math.round(parseFloat(req.body.price) * 100)        : null;
  const shippingCents    = req.body.shipping_cost ? Math.round(parseFloat(req.body.shipping_cost) * 100) : null;
  const weightOz         = req.body.weight_oz    ? parseFloat(req.body.weight_oz)    : null;
  const lengthIn         = req.body.length_in    ? parseFloat(req.body.length_in)    : null;
  const widthIn          = req.body.width_in     ? parseFloat(req.body.width_in)     : null;
  const heightIn         = req.body.height_in    ? parseFloat(req.body.height_in)    : null;
  const isAvailable      = req.body.is_available === 'true' ? 1 : 0;

  let client;
  try {
    client = await getClient();
    const col = await client.query(
      'SELECT id FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (col.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    let s3Key = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      s3Key = `collections/${req.user.id}/${id}/item_${Date.now()}${ext}`;
      const upload = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
      if (!upload.success) return res.status(500).json({ message: 'Image upload failed' });
    }

    const insert = await client.query(
      `INSERT INTO collection_items
         (collection_id, user_id, name, description, image_path,
          price_cents, is_available, shipping_cost_cents, weight_oz, length_in, width_in, height_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, req.user.id, name.trim(), description || null, s3Key,
       priceCents, isAvailable, shippingCents, weightOz, lengthIn, widthIn, heightIn]
    );
    const result = await client.query(
      `SELECT id, name, description, image_path, display_order,
              price_cents, is_available, shipping_cost_cents,
              weight_oz, length_in, width_in, height_in,
              created_at, updated_at
       FROM collection_items WHERE id = $1`,
      [insert.insertId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create item:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/collections/:id/items/:itemId
router.put('/:id/items/:itemId', authenticate, upload.single('image'), async (req, res) => {
  const { id, itemId } = req.params;
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

  const priceCents       = req.body.price        ? Math.round(parseFloat(req.body.price) * 100)        : null;
  const shippingCents    = req.body.shipping_cost ? Math.round(parseFloat(req.body.shipping_cost) * 100) : null;
  const weightOz         = req.body.weight_oz    ? parseFloat(req.body.weight_oz)    : null;
  const lengthIn         = req.body.length_in    ? parseFloat(req.body.length_in)    : null;
  const widthIn          = req.body.width_in     ? parseFloat(req.body.width_in)     : null;
  const heightIn         = req.body.height_in    ? parseFloat(req.body.height_in)    : null;
  const isAvailable      = req.body.is_available === 'true' ? 1 : 0;

  let client;
  try {
    client = await getClient();
    const col = await client.query(
      'SELECT id FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (col.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    const existing = await client.query(
      'SELECT id, image_path FROM collection_items WHERE id = $1 AND collection_id = $2',
      [itemId, id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Item not found' });

    let s3Key = existing.rows[0].image_path;
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const newKey = `collections/${req.user.id}/${id}/item_${Date.now()}${ext}`;
      const upload = await uploadToS3(req.file.buffer, newKey, req.file.mimetype);
      if (!upload.success) return res.status(500).json({ message: 'Image upload failed' });
      if (s3Key) deleteFromS3(s3Key).catch(() => {});
      s3Key = newKey;
    }

    await client.query(
      `UPDATE collection_items SET
         name = $1, description = $2, image_path = $3,
         price_cents = $4, is_available = $5, shipping_cost_cents = $6,
         weight_oz = $7, length_in = $8, width_in = $9, height_in = $10
       WHERE id = $11`,
      [name.trim(), description || null, s3Key,
       priceCents, isAvailable, shippingCents,
       weightOz, lengthIn, widthIn, heightIn, itemId]
    );
    const result = await client.query(
      `SELECT id, name, description, image_path, display_order,
              price_cents, is_available, shipping_cost_cents,
              weight_oz, length_in, width_in, height_in,
              created_at, updated_at
       FROM collection_items WHERE id = $1`,
      [itemId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update item:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/collections/:id/items/:itemId
router.delete('/:id/items/:itemId', authenticate, async (req, res) => {
  const { id, itemId } = req.params;
  let client;
  try {
    client = await getClient();
    const col = await client.query(
      'SELECT id FROM user_collections WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (col.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    const existing = await client.query(
      'SELECT id, image_path FROM collection_items WHERE id = $1 AND collection_id = $2',
      [itemId, id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Item not found' });

    await client.query('DELETE FROM collection_items WHERE id = $1', [itemId]);
    if (existing.rows[0].image_path) {
      deleteFromS3(existing.rows[0].image_path).catch(() => {});
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Failed to delete item:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
