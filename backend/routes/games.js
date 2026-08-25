const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { buildUniverseGraph } = require('../utilities/haulonautUniverse');
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

// Game admin: either an explicit game_admins row, or site-wide admin_access
// (mirrors checkPermission.js's query, OR'd with the game-scoped grant).
// Looks up the game by :gameKey and attaches req.gameId for downstream
// handlers on success.
const requireGameAdmin = async (req, res, next) => {
  const client = await getClient();
  try {
    const gameResult = await client.query('SELECT id FROM games WHERE game_key = $1', [req.params.gameKey]);
    if (gameResult.rowCount === 0) return res.status(404).json({ message: 'Game not found' });
    const gameId = gameResult.rows[0].id;

    const adminCheck = await client.query(
      `SELECT 1 FROM game_admins WHERE game_id = $1 AND user_id = $2
       UNION
       SELECT 1 FROM permissions p
       WHERE p.name = 'admin_access' AND p.is_active = true AND (
         EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = $3)
         OR EXISTS (
           SELECT 1 FROM group_permissions gp
           JOIN user_groups ug ON ug.group_id = gp.group_id
           WHERE gp.permission_id = p.id AND ug.user_id = $4
         )
       )`,
      [gameId, req.user.id, req.user.id, req.user.id]
    );
    if (adminCheck.rowCount === 0) return res.status(403).json({ message: 'Not a game admin' });

    req.gameId = gameId;
    next();
  } catch (err) {
    console.error('Error checking game admin:', err);
    res.status(500).json({ message: 'Failed to check game admin' });
  } finally {
    client.release();
  }
};

// Builds "INSERT INTO table (cols) VALUES ($1,$2),($3,$4),..." with a
// flattened params array. The db.js wrapper runs queries as MySQL prepared
// statements, which don't support mysql2's "VALUES ?" bulk-array shortcut,
// so multi-row inserts need every placeholder spelled out explicitly.
function buildBulkInsertQuery(table, columns, rows) {
  const valuesSql = rows
    .map((_, rowIndex) => `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`)
    .join(', ');
  return {
    sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesSql}`,
    params: rows.flat()
  };
}

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

    const adminCheck = await client.query(
      `SELECT 1 FROM game_admins WHERE game_id = $1 AND user_id = $2
       UNION
       SELECT 1 FROM permissions p
       WHERE p.name = 'admin_access' AND p.is_active = true AND (
         EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = $3)
         OR EXISTS (
           SELECT 1 FROM group_permissions gp
           JOIN user_groups ug ON ug.group_id = gp.group_id
           WHERE gp.permission_id = p.id AND ug.user_id = $4
         )
       )`,
      [game.id, req.user.id, req.user.id, req.user.id]
    );
    const isAdmin = adminCheck.rowCount > 0;

    res.json({ game, instance, characters, isAdmin });
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

/**
 * GET /api/games/:gameKey/admin/overview
 * Game-admin only: current active instance details plus the full player
 * roster (every character in that instance, not just the caller's own).
 */
router.get('/:gameKey/admin/overview', authenticate, requireGameAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const instanceResult = await client.query(
      `SELECT gi.id, gi.name, gi.status, gi.started_at,
              (SELECT COUNT(*) FROM haulonaut_sectors hs WHERE hs.game_instance_id = gi.id) AS sector_count
       FROM game_instances gi
       WHERE gi.game_id = $1 AND gi.status = 'active'
       ORDER BY gi.started_at DESC LIMIT 1`,
      [req.gameId]
    );
    const instance = instanceResult.rowCount > 0 ? instanceResult.rows[0] : null;

    let roster = [];
    if (instance) {
      const rosterResult = await client.query(
        `SELECT gu.id, gu.display_name, gu.status, gu.created_at, gu.last_played_at, u.handle AS owner_handle
         FROM game_users gu
         LEFT JOIN users u ON u.id = gu.user_id
         WHERE gu.game_instance_id = $1
         ORDER BY gu.last_played_at DESC`,
        [instance.id]
      );
      roster = rosterResult.rows;
    }

    res.json({ instance, roster });
  } catch (err) {
    console.error('Error loading game admin overview:', err);
    res.status(500).json({ message: 'Failed to load overview' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/admin/universe
 * Game-admin only: generate a fresh universe for this game, ending whatever
 * instance is currently active. Body: { name, sectors, min_links, max_links,
 * avg_degree } -- all optional, defaulting to the same values the CLI
 * generator script uses.
 */
router.post('/:gameKey/admin/universe', authenticate, requireGameAdmin, async (req, res) => {
  const name = (req.body.name || `Haulonaut Universe ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`).trim();
  const sectorCount = parseInt(req.body.sectors, 10) || 1000;
  const minLinks = parseInt(req.body.min_links, 10) || 1;
  const maxLinks = parseInt(req.body.max_links, 10) || 6;
  const avgDegree = parseFloat(req.body.avg_degree) || 3.5;

  if (sectorCount < 10 || sectorCount > 5000) {
    return res.status(400).json({ message: 'sectors must be between 10 and 5000' });
  }

  let graph;
  try {
    graph = buildUniverseGraph(sectorCount, minLinks, maxLinks, avgDegree);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();

    await client.query(
      `UPDATE game_instances SET status = 'ended', ended_at = NOW() WHERE game_id = $1 AND status = 'active'`,
      [req.gameId]
    );

    const instanceResult = await client.query(
      `INSERT INTO game_instances (game_id, name, status) VALUES ($1, $2, 'setup')`,
      [req.gameId, name]
    );
    const instanceId = instanceResult.insertId;

    const sectorRows = [];
    for (let n = 1; n <= sectorCount; n++) sectorRows.push([instanceId, n]);
    const SECTOR_BATCH = 500;
    for (let i = 0; i < sectorRows.length; i += SECTOR_BATCH) {
      const { sql, params } = buildBulkInsertQuery(
        'haulonaut_sectors', ['game_instance_id', 'sector_number'], sectorRows.slice(i, i + SECTOR_BATCH)
      );
      await client.query(sql, params);
    }

    const sectorIdResult = await client.query(
      'SELECT id, sector_number FROM haulonaut_sectors WHERE game_instance_id = $1 ORDER BY sector_number',
      [instanceId]
    );
    const idByIndex = sectorIdResult.rows.map(r => r.id); // index i -> sector_number i+1's DB id

    const linkRows = [];
    for (const [a, b] of graph.edges) {
      linkRows.push([instanceId, idByIndex[a], idByIndex[b]]);
      linkRows.push([instanceId, idByIndex[b], idByIndex[a]]);
    }
    const LINK_BATCH = 300;
    for (let i = 0; i < linkRows.length; i += LINK_BATCH) {
      const { sql, params } = buildBulkInsertQuery(
        'haulonaut_sector_links', ['game_instance_id', 'from_sector_id', 'to_sector_id'], linkRows.slice(i, i + LINK_BATCH)
      );
      await client.query(sql, params);
    }

    await client.query(`UPDATE game_instances SET status = 'active', started_at = NOW() WHERE id = $1`, [instanceId]);

    await client.commit();

    res.status(201).json({
      instance: { id: instanceId, name },
      sectorCount: sectorRows.length,
      linkCount: linkRows.length,
      degreeStats: graph.stats
    });
  } catch (err) {
    await client.rollback();
    console.error('Error generating universe:', err);
    res.status(500).json({ message: 'Failed to generate universe' });
  } finally {
    client.release();
  }
});

module.exports = router;
