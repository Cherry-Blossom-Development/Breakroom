const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { checkPermission } = require('../middleware/checkPermission');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Site-admin only: granting/revoking game_admins is a platform-level action
// (deciding who gets elevated privileges), distinct from the game_admins
// themselves, who only get access to their one game's operational tools
// (backend/routes/games.js's /admin/* endpoints), not this list.
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

/**
 * GET /api/admin/games
 * List all games with their game-admin count.
 */
router.get('/', authenticate, checkPermission('admin_access'), async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT g.id, g.game_key, g.name, COUNT(ga.user_id) AS admin_count
       FROM games g
       LEFT JOIN game_admins ga ON ga.game_id = g.id
       GROUP BY g.id
       ORDER BY g.name`
    );
    res.json({ games: result.rows });
  } catch (err) {
    console.error('Error loading games:', err);
    res.status(500).json({ message: 'Failed to load games' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/games/:gameId/admins
 * List the game admins for one game.
 */
router.get('/:gameId/admins', authenticate, checkPermission('admin_access'), async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, ga.added_at
       FROM game_admins ga
       JOIN users u ON u.id = ga.user_id
       WHERE ga.game_id = $1
       ORDER BY ga.added_at DESC`,
      [req.params.gameId]
    );
    res.json({ admins: result.rows });
  } catch (err) {
    console.error('Error loading game admins:', err);
    res.status(500).json({ message: 'Failed to load game admins' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/games/:gameId/admins
 * Grant a user game-admin rights for this game, by handle.
 */
router.post('/:gameId/admins', authenticate, checkPermission('admin_access'), async (req, res) => {
  const { handle } = req.body;
  if (!handle) return res.status(400).json({ message: 'handle is required' });

  const client = await getClient();
  try {
    const user = await client.query('SELECT id FROM users WHERE handle = $1', [handle]);
    if (user.rowCount === 0) return res.status(404).json({ message: 'User not found' });

    await client.query(
      'INSERT IGNORE INTO game_admins (game_id, user_id) VALUES ($1, $2)',
      [req.params.gameId, user.rows[0].id]
    );
    res.status(201).json({ message: 'Game admin added' });
  } catch (err) {
    console.error('Error adding game admin:', err);
    res.status(500).json({ message: 'Failed to add game admin' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/admin/games/:gameId/admins/:userId
 * Revoke a user's game-admin rights for this game.
 */
router.delete('/:gameId/admins/:userId', authenticate, checkPermission('admin_access'), async (req, res) => {
  const client = await getClient();
  try {
    await client.query(
      'DELETE FROM game_admins WHERE game_id = $1 AND user_id = $2',
      [req.params.gameId, req.params.userId]
    );
    res.json({ message: 'Game admin removed' });
  } catch (err) {
    console.error('Error removing game admin:', err);
    res.status(500).json({ message: 'Failed to remove game admin' });
  } finally {
    client.release();
  }
});

module.exports = router;
