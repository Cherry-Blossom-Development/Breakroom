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

/**
 * GET /api/games/:gameKey
 * Game info, its current active universe instance (if any), and the
 * requesting user's characters within that instance. One call covers
 * everything the Games landing page needs for a single game's ad card.
 */
router.get('/:gameKey', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const gameResult = await client.query(
      'SELECT id, game_key, name, description FROM games WHERE game_key = $1 AND is_active = true',
      [req.params.gameKey]
    );
    if (gameResult.rowCount === 0) return res.status(404).json({ message: 'Game not found' });
    const game = gameResult.rows[0];

    const instanceResult = await client.query(
      `SELECT gi.id, gi.name
       FROM game_instances gi
       WHERE gi.game_id = $1 AND gi.status = 'active'
       ORDER BY gi.started_at DESC LIMIT 1`,
      [game.id]
    );
    const instance = instanceResult.rowCount > 0 ? instanceResult.rows[0] : null;

    let characters = [];
    if (instance) {
      const charactersResult = await client.query(
        `SELECT id, display_name, status, created_at, last_played_at, died_at
         FROM game_users WHERE game_instance_id = $1 AND user_id = $2
         ORDER BY last_played_at DESC`,
        [instance.id, req.user.id]
      );
      characters = charactersResult.rows;
    }

    res.json({ game, instance, characters });
  } catch (err) {
    console.error('Error loading game:', err);
    res.status(500).json({ message: 'Failed to load game' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters
 * Create a new character in the current active instance of this game.
 */
router.post('/:gameKey/characters', authenticate, async (req, res) => {
  const displayName = (req.body.display_name || '').trim();
  if (!displayName) return res.status(400).json({ message: 'display_name is required' });
  if (displayName.length > 64) return res.status(400).json({ message: 'display_name must be 64 characters or fewer' });

  const client = await getClient();
  try {
    const gameResult = await client.query(
      'SELECT id FROM games WHERE game_key = $1 AND is_active = true',
      [req.params.gameKey]
    );
    if (gameResult.rowCount === 0) return res.status(404).json({ message: 'Game not found' });

    const instanceResult = await client.query(
      `SELECT id FROM game_instances WHERE game_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
      [gameResult.rows[0].id]
    );
    if (instanceResult.rowCount === 0) {
      return res.status(409).json({ message: 'No active universe for this game yet' });
    }

    const insertResult = await client.query(
      `INSERT INTO game_users (game_instance_id, user_id, display_name, status) VALUES ($1, $2, $3, 'active')`,
      [instanceResult.rows[0].id, req.user.id, displayName]
    );

    const created = await client.query(
      'SELECT id, display_name, status, created_at, last_played_at, died_at FROM game_users WHERE id = $1',
      [insertResult.insertId]
    );

    res.status(201).json({ character: created.rows[0] });
  } catch (err) {
    console.error('Error creating game character:', err);
    res.status(500).json({ message: 'Failed to create character' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/characters/:id
 * Fetch a single character owned by the requesting user, and mark it as
 * just-played (drives the "resume most recent" ordering on the landing page).
 */
router.get('/:gameKey/characters/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT gu.id, gu.display_name, gu.status, gu.created_at, gu.last_played_at, gu.died_at
       FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Character not found' });

    await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [req.params.id]);

    res.json({ character: result.rows[0] });
  } catch (err) {
    console.error('Error loading character:', err);
    res.status(500).json({ message: 'Failed to load character' });
  } finally {
    client.release();
  }
});

module.exports = router;
