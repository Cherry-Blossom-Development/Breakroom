const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies.jwtToken;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = user.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin middleware
const requireAdmin = async (req, res, next) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT 1 FROM user_permissions up
       JOIN permissions p ON up.permission_id = p.id
       WHERE up.user_id = $1 AND p.name = 'admin_access'
       UNION
       SELECT 1 FROM user_groups ug
       JOIN group_permissions gp ON ug.group_id = gp.group_id
       JOIN permissions p ON gp.permission_id = p.id
       WHERE ug.user_id = $2 AND p.name = 'admin_access'`,
      [req.user.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(403).json({ message: 'Admin access required' });
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Error checking permissions' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/features/mine
 * Returns the feature keys the current user has access to.
 * Used by the frontend to check feature access.
 */
router.get('/mine', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT f.feature_key FROM features f
       JOIN feature_users fu ON fu.feature_id = f.id
       WHERE fu.user_id = $1 AND f.is_active = true`,
      [req.user.id]
    );
    res.json({ features: result.rows.map(r => r.feature_key) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load features' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/features
 * Admin: list all features with enrolled user count.
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT f.id, f.feature_key, f.name, f.description, f.is_active, f.created_at,
              COUNT(fu.user_id) AS user_count
       FROM features f
       LEFT JOIN feature_users fu ON fu.feature_id = f.id
       GROUP BY f.id
       ORDER BY f.created_at DESC`
    );
    res.json({ features: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load features' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/features
 * Admin: create a new feature flag.
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { feature_key, name, description } = req.body;
  if (!feature_key || !name) return res.status(400).json({ message: 'feature_key and name are required' });

  const client = await getClient();
  try {
    await client.query(
      'INSERT INTO features (feature_key, name, description) VALUES ($1, $2, $3)',
      [feature_key.trim().toLowerCase().replace(/\s+/g, '_'), name.trim(), description?.trim() || null]
    );
    res.status(201).json({ message: 'Feature created' });
  } catch (err) {
    if (err.message?.includes('Duplicate')) {
      return res.status(409).json({ message: 'A feature with that key already exists' });
    }
    res.status(500).json({ message: 'Failed to create feature' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/features/:id
 * Admin: update a feature flag (name, description, is_active).
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, is_active } = req.body;
  const client = await getClient();
  try {
    await client.query(
      'UPDATE features SET name = $1, description = $2, is_active = $3 WHERE id = $4',
      [name, description, is_active, req.params.id]
    );
    res.json({ message: 'Feature updated' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update feature' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/features/:id
 * Admin: delete a feature flag (cascades to feature_users).
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    await client.query('DELETE FROM features WHERE id = $1', [req.params.id]);
    res.json({ message: 'Feature deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete feature' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/features/:id/users
 * Admin: list users enrolled in a feature.
 */
router.get('/:id/users', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, fu.added_method, fu.added_at
       FROM feature_users fu
       JOIN users u ON u.id = fu.user_id
       WHERE fu.feature_id = $1
       ORDER BY fu.added_at DESC`,
      [req.params.id]
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load feature users' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/features/:id/users
 * Admin: add a specific user to a feature by handle.
 */
router.post('/:id/users', authenticate, requireAdmin, async (req, res) => {
  const { handle } = req.body;
  if (!handle) return res.status(400).json({ message: 'handle is required' });

  const client = await getClient();
  try {
    const user = await client.query('SELECT id FROM users WHERE handle = $1', [handle]);
    if (user.rowCount === 0) return res.status(404).json({ message: 'User not found' });

    await client.query(
      'INSERT IGNORE INTO feature_users (feature_id, user_id, added_method) VALUES ($1, $2, $3)',
      [req.params.id, user.rows[0].id, 'manual']
    );
    res.status(201).json({ message: 'User added to feature' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add user' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/features/:id/users/random
 * Admin: add a random percentage of all users to a feature.
 */
router.post('/:id/users/random', authenticate, requireAdmin, async (req, res) => {
  const percent = parseInt(req.body.percent);
  if (!percent || percent < 1 || percent > 100) {
    return res.status(400).json({ message: 'percent must be between 1 and 100' });
  }

  const client = await getClient();
  try {
    // Get all users not already in this feature, shuffled randomly
    const allUsers = await client.query(
      `SELECT u.id FROM users u
       WHERE u.id NOT IN (
         SELECT user_id FROM feature_users WHERE feature_id = $1
       )
       ORDER BY RAND()`,
      [req.params.id]
    );

    const total = allUsers.rows.length;
    const count = Math.max(1, Math.round(total * percent / 100));
    const toAdd = allUsers.rows.slice(0, count);

    for (const u of toAdd) {
      await client.query(
        'INSERT IGNORE INTO feature_users (feature_id, user_id, added_method) VALUES ($1, $2, $3)',
        [req.params.id, u.id, 'random']
      );
    }

    res.json({ message: `Added ${toAdd.length} users`, added: toAdd.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add random users' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/features/:id/users/:userId
 * Admin: remove a user from a feature.
 */
router.delete('/:id/users/:userId', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    await client.query(
      'DELETE FROM feature_users WHERE feature_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    res.json({ message: 'User removed from feature' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove user' });
  } finally {
    client.release();
  }
});

module.exports = router;
