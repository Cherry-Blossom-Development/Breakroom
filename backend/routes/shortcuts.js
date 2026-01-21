const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Auth middleware - supports both cookie (web) and Authorization header (mobile)
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query(
      'SELECT id, handle, first_name, last_name FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Get all shortcuts for the current user
router.get('/', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, name, url, icon, sort_order, created_at
       FROM user_shortcuts
       WHERE user_id = $1
       ORDER BY sort_order, created_at`,
      [req.user.id]
    );

    res.json({ shortcuts: result.rows });
  } catch (err) {
    console.error('Error fetching shortcuts:', err);
    res.status(500).json({ message: 'Failed to fetch shortcuts' });
  } finally {
    client.release();
  }
});

// Check if a shortcut exists for a specific URL
router.get('/check', authenticate, async (req, res) => {
  const { url } = req.query;
  const client = await getClient();

  try {
    if (!url) {
      return res.status(400).json({ message: 'URL parameter is required' });
    }

    const result = await client.query(
      `SELECT id, name, url FROM user_shortcuts
       WHERE user_id = $1 AND url = $2`,
      [req.user.id, url]
    );

    res.json({
      exists: result.rowCount > 0,
      shortcut: result.rows[0] || null
    });
  } catch (err) {
    console.error('Error checking shortcut:', err);
    res.status(500).json({ message: 'Failed to check shortcut' });
  } finally {
    client.release();
  }
});

// Create a new shortcut
router.post('/', authenticate, async (req, res) => {
  const { name, url, icon } = req.body;
  const client = await getClient();

  try {
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Name is required' });
    }

    if (!url || url.trim().length === 0) {
      return res.status(400).json({ message: 'URL is required' });
    }

    // Check if shortcut with same URL already exists
    const existing = await client.query(
      'SELECT id FROM user_shortcuts WHERE user_id = $1 AND url = $2',
      [req.user.id, url.trim()]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({ message: 'A shortcut for this URL already exists' });
    }

    // Get the max sort_order to add new shortcut at the end
    const maxOrderResult = await client.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM user_shortcuts WHERE user_id = $1',
      [req.user.id]
    );
    const nextOrder = maxOrderResult.rows[0].next_order;

    await client.query(
      `INSERT INTO user_shortcuts (user_id, name, url, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, name.trim(), url.trim(), icon || null, nextOrder]
    );

    // Get the inserted shortcut
    const result = await client.query(
      `SELECT id, name, url, icon, sort_order, created_at
       FROM user_shortcuts
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    res.status(201).json({ shortcut: result.rows[0] });
  } catch (err) {
    console.error('Error creating shortcut:', err);
    res.status(500).json({ message: 'Failed to create shortcut' });
  } finally {
    client.release();
  }
});

// Delete a shortcut by ID
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Verify the shortcut belongs to the user
    const existing = await client.query(
      'SELECT id FROM user_shortcuts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Shortcut not found' });
    }

    await client.query('DELETE FROM user_shortcuts WHERE id = $1', [id]);

    res.json({ message: 'Shortcut deleted successfully' });
  } catch (err) {
    console.error('Error deleting shortcut:', err);
    res.status(500).json({ message: 'Failed to delete shortcut' });
  } finally {
    client.release();
  }
});

// Delete a shortcut by URL
router.delete('/by-url', authenticate, async (req, res) => {
  const { url } = req.body;
  const client = await getClient();

  try {
    if (!url) {
      return res.status(400).json({ message: 'URL is required' });
    }

    const result = await client.query(
      'DELETE FROM user_shortcuts WHERE user_id = $1 AND url = $2',
      [req.user.id, url]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Shortcut not found' });
    }

    res.json({ message: 'Shortcut deleted successfully' });
  } catch (err) {
    console.error('Error deleting shortcut:', err);
    res.status(500).json({ message: 'Failed to delete shortcut' });
  } finally {
    client.release();
  }
});

module.exports = router;
