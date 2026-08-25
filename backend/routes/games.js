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

// Loads a character's current sector and every sector directly reachable
// from it (haulonaut_sector_links stores both directions of each
// connection, so this is a single indexed lookup). Shared by the
// character-fetch and navigate endpoints so both return the same shape.
async function loadPilotLocation(client, gameUserId) {
  const pilotResult = await client.query(
    `SELECT hs.id, hs.sector_number
     FROM haulonaut_pilots hp
     JOIN haulonaut_sectors hs ON hs.id = hp.current_sector_id
     WHERE hp.game_user_id = $1`,
    [gameUserId]
  );
  if (pilotResult.rowCount === 0) return { currentSector: null, connectedSectors: [] };
  const currentSector = pilotResult.rows[0];

  const linksResult = await client.query(
    `SELECT hs.id, hs.sector_number
     FROM haulonaut_sector_links hsl
     JOIN haulonaut_sectors hs ON hs.id = hsl.to_sector_id
     WHERE hsl.from_sector_id = $1
     ORDER BY hs.sector_number`,
    [currentSector.id]
  );

  return { currentSector, connectedSectors: linksResult.rows };
}

/**
 * GET /api/games/:gameKey
 * Game info, every currently-active universe instance (a game can have
 * several running concurrently), and the requesting user's characters
 * across ALL instances of this game (including ended ones, so history
 * isn't lost when a universe closes) -- each character carries its
 * instance's name/status so the landing page can label which universe
 * it's in.
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

    const instancesResult = await client.query(
      `SELECT gi.id, gi.name, gi.started_at,
              (SELECT COUNT(*) FROM haulonaut_sectors hs WHERE hs.game_instance_id = gi.id) AS sector_count,
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id) AS player_count
       FROM game_instances gi
       WHERE gi.game_id = $1 AND gi.status = 'active'
       ORDER BY gi.started_at DESC`,
      [game.id]
    );
    const instances = instancesResult.rows;

    const charactersResult = await client.query(
      `SELECT gu.id, gu.display_name, gu.status, gu.created_at, gu.last_played_at, gu.died_at,
              gi.id AS instance_id, gi.name AS instance_name, gi.status AS instance_status
       FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       WHERE gi.game_id = $1 AND gu.user_id = $2
       ORDER BY gu.last_played_at DESC`,
      [game.id, req.user.id]
    );

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

    res.json({ game, instances, characters: charactersResult.rows, isAdmin });
  } catch (err) {
    console.error('Error loading game:', err);
    res.status(500).json({ message: 'Failed to load game' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters
 * Create a new character in a specific active instance of this game.
 * Body: { display_name, instance_id }.
 */
router.post('/:gameKey/characters', authenticate, async (req, res) => {
  const displayName = (req.body.display_name || '').trim();
  const instanceId = parseInt(req.body.instance_id, 10);
  if (!displayName) return res.status(400).json({ message: 'display_name is required' });
  if (displayName.length > 64) return res.status(400).json({ message: 'display_name must be 64 characters or fewer' });
  if (!instanceId) return res.status(400).json({ message: 'instance_id is required' });

  const client = await getClient();
  try {
    const instanceResult = await client.query(
      `SELECT gi.id FROM game_instances gi
       JOIN games g ON g.id = gi.game_id
       WHERE gi.id = $1 AND g.game_key = $2 AND gi.status = 'active'`,
      [instanceId, req.params.gameKey]
    );
    if (instanceResult.rowCount === 0) {
      return res.status(409).json({ message: 'That universe is not active' });
    }

    const startSector = await client.query(
      'SELECT id FROM haulonaut_sectors WHERE game_instance_id = $1 ORDER BY sector_number LIMIT 1',
      [instanceId]
    );
    if (startSector.rowCount === 0) {
      return res.status(409).json({ message: 'That universe has no sectors yet' });
    }

    await client.beginTransaction();

    const insertResult = await client.query(
      `INSERT INTO game_users (game_instance_id, user_id, display_name, status) VALUES ($1, $2, $3, 'active')`,
      [instanceId, req.user.id, displayName]
    );

    // Spawn at sector 1 (the traditional "home base" starting sector).
    await client.query(
      'INSERT INTO haulonaut_pilots (game_user_id, current_sector_id) VALUES ($1, $2)',
      [insertResult.insertId, startSector.rows[0].id]
    );

    await client.commit();

    const created = await client.query(
      'SELECT id, display_name, status, created_at, last_played_at, died_at FROM game_users WHERE id = $1',
      [insertResult.insertId]
    );

    res.status(201).json({ character: created.rows[0] });
  } catch (err) {
    await client.rollback();
    console.error('Error creating game character:', err);
    res.status(500).json({ message: 'Failed to create character' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/characters/:id
 * Fetch a single character owned by the requesting user, and mark it as
 * just-played (drives the "resume most recent" ordering on the landing
 * page). Also returns where they currently are and every sector reachable
 * from there, for the navigation bar.
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

    const { currentSector, connectedSectors } = await loadPilotLocation(client, req.params.id);

    res.json({ character: result.rows[0], currentSector, connectedSectors });
  } catch (err) {
    console.error('Error loading character:', err);
    res.status(500).json({ message: 'Failed to load character' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/navigate
 * Move the character's ship along a warp link. Body: { to_sector_id }.
 * Rejects the move unless to_sector_id is actually linked from the
 * character's current sector -- the client only ever offers linked sectors,
 * but this is re-checked server-side rather than trusted.
 */
router.post('/:gameKey/characters/:id/navigate', authenticate, async (req, res) => {
  const toSectorId = parseInt(req.body.to_sector_id, 10);
  if (!toSectorId) return res.status(400).json({ message: 'to_sector_id is required' });

  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });

    const pilotResult = await client.query(
      'SELECT current_sector_id FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    const linkCheck = await client.query(
      'SELECT 1 FROM haulonaut_sector_links WHERE from_sector_id = $1 AND to_sector_id = $2',
      [pilotResult.rows[0].current_sector_id, toSectorId]
    );
    if (linkCheck.rowCount === 0) return res.status(400).json({ message: 'That sector is not reachable from here' });

    await client.query(
      'UPDATE haulonaut_pilots SET current_sector_id = $1 WHERE game_user_id = $2',
      [toSectorId, req.params.id]
    );
    await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [req.params.id]);

    const { currentSector, connectedSectors } = await loadPilotLocation(client, req.params.id);

    res.json({ currentSector, connectedSectors });
  } catch (err) {
    console.error('Error navigating:', err);
    res.status(500).json({ message: 'Failed to navigate' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/admin/overview
 * Game-admin only: every instance for this game (active and ended, most
 * recent first) with basic stats. No roster here -- fetch that per-instance
 * via /admin/instances/:instanceId/roster, since a game can now have several
 * instances at once and pulling every roster up front doesn't scale.
 */
router.get('/:gameKey/admin/overview', authenticate, requireGameAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const instancesResult = await client.query(
      `SELECT gi.id, gi.name, gi.status, gi.started_at, gi.ended_at,
              (SELECT COUNT(*) FROM haulonaut_sectors hs WHERE hs.game_instance_id = gi.id) AS sector_count,
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id) AS player_count
       FROM game_instances gi
       WHERE gi.game_id = $1
       ORDER BY gi.started_at DESC
       LIMIT 25`,
      [req.gameId]
    );

    res.json({ instances: instancesResult.rows });
  } catch (err) {
    console.error('Error loading game admin overview:', err);
    res.status(500).json({ message: 'Failed to load overview' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/admin/instances/:instanceId/roster
 * Game-admin only: full player roster for one instance of this game.
 */
router.get('/:gameKey/admin/instances/:instanceId/roster', authenticate, requireGameAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const instanceCheck = await client.query(
      'SELECT id FROM game_instances WHERE id = $1 AND game_id = $2',
      [req.params.instanceId, req.gameId]
    );
    if (instanceCheck.rowCount === 0) return res.status(404).json({ message: 'Instance not found' });

    const rosterResult = await client.query(
      `SELECT gu.id, gu.display_name, gu.status, gu.created_at, gu.last_played_at, u.handle AS owner_handle
       FROM game_users gu
       LEFT JOIN users u ON u.id = gu.user_id
       WHERE gu.game_instance_id = $1
       ORDER BY gu.last_played_at DESC`,
      [req.params.instanceId]
    );

    res.json({ roster: rosterResult.rows });
  } catch (err) {
    console.error('Error loading instance roster:', err);
    res.status(500).json({ message: 'Failed to load roster' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/admin/instances/:instanceId/end
 * Game-admin only: explicitly end one active instance. Other instances for
 * this game are unaffected -- multiple universes can run concurrently.
 */
router.post('/:gameKey/admin/instances/:instanceId/end', authenticate, requireGameAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE game_instances SET status = 'ended', ended_at = NOW()
       WHERE id = $1 AND game_id = $2 AND status = 'active'`,
      [req.params.instanceId, req.gameId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Active instance not found' });
    }
    res.json({ message: 'Universe ended' });
  } catch (err) {
    console.error('Error ending universe:', err);
    res.status(500).json({ message: 'Failed to end universe' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/admin/universe
 * Game-admin only: generate a fresh universe for this game, alongside any
 * other instances currently active (does not end anything -- use
 * /admin/instances/:instanceId/end for that separately). Body: { name,
 * sectors, min_links, max_links, avg_degree } -- all optional, defaulting
 * to the same values the CLI generator script uses.
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
