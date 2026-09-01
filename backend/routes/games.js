const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { buildUniverseGraph, generateSectorContent } = require('../utilities/haulonautUniverse');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// A new pilot's starting stake, and what a single warp costs -- must stay
// in sync with the haulonaut_pilots column defaults in migrations 059 and
// 061, since both the self-heal spawn path and character creation insert a
// pilot row without specifying credits/rations/fuel and rely on those
// defaults matching these numbers. Rations and fuel both drain on warp (a
// ship needs to feed its crew and burn reaction mass regardless of
// distance); credits aren't touched by movement at all -- they'll only
// ever be spent on something the player actually chooses to buy. Rations
// and fuel are clamped at 0 in the /navigate UPDATE rather than going
// negative -- ways to replenish them are a separate follow-up.
const STARTING_CREDITS = 1000;
const STARTING_RATIONS = 100;
const STARTING_FUEL = 100;
const WARP_RATIONS_COST = 1;
const WARP_FUEL_COST = 1;

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

// Loads a character's current sector (with its description), every sector
// directly reachable from it (haulonaut_sector_links stores both
// directions of each connection, so this is a single indexed lookup), what
// features (planets, trading outposts, ...) are in the current sector, and
// which other active characters are also there right now. Shared by the
// character-fetch and navigate endpoints so both return the same shape.
//
// Self-healing: a character with no haulonaut_pilots row yet (spawned
// before this table existed, or any other gap) gets one created here, at a
// random sector in their instance, rather than surfacing a broken "nowhere"
// state to the player.
async function loadPilotLocation(client, gameUserId) {
  let pilotResult = await client.query(
    `SELECT hs.id, hs.sector_number, hs.description, hp.credits, hp.rations, hp.fuel
     FROM haulonaut_pilots hp
     JOIN haulonaut_sectors hs ON hs.id = hp.current_sector_id
     WHERE hp.game_user_id = $1`,
    [gameUserId]
  );

  if (pilotResult.rowCount === 0) {
    const spawned = await spawnPilotAtRandomSector(client, gameUserId);
    if (!spawned) return { currentSector: null, connectedSectors: [], features: [], playersHere: [], credits: 0, rations: 0, fuel: 0 };
    pilotResult = { rows: [spawned] };
  }

  const { credits, rations, fuel, ...currentSector } = pilotResult.rows[0];

  const linksResult = await client.query(
    `SELECT hs.id, hs.sector_number
     FROM haulonaut_sector_links hsl
     JOIN haulonaut_sectors hs ON hs.id = hsl.to_sector_id
     WHERE hsl.from_sector_id = $1
     ORDER BY hs.sector_number`,
    [currentSector.id]
  );

  const featuresResult = await client.query(
    'SELECT id, feature_type, name, description FROM haulonaut_sector_features WHERE sector_id = $1',
    [currentSector.id]
  );

  const playersResult = await client.query(
    `SELECT gu.id, gu.display_name
     FROM game_users gu
     JOIN haulonaut_pilots hp ON hp.game_user_id = gu.id
     WHERE hp.current_sector_id = $1 AND gu.id != $2 AND gu.status = 'active'`,
    [currentSector.id, gameUserId]
  );

  const visitedResult = await client.query(
    'SELECT sector_id FROM haulonaut_visited_sectors WHERE game_user_id = $1',
    [gameUserId]
  );
  const visitedIds = new Set(visitedResult.rows.map(r => r.sector_id));
  const connectedSectors = linksResult.rows.map(s => ({ ...s, visited: visitedIds.has(s.id) }));

  return {
    currentSector,
    connectedSectors,
    features: featuresResult.rows,
    playersHere: playersResult.rows,
    credits,
    rations,
    fuel
  };
}

// Every non-zero-quantity item a character currently owns, joined against
// the catalog for display. Rations and fuel deliberately never appear here
// -- see the comment on their special-cases in the /purchase route.
async function loadInventory(client, gameUserId) {
  const result = await client.query(
    `SELECT i.item_key, i.name, i.category, hi.quantity
     FROM haulonaut_pilot_inventory hi
     JOIN haulonaut_items i ON i.id = hi.item_id
     WHERE hi.game_user_id = $1 AND hi.quantity > 0
     ORDER BY i.category, i.name`,
    [gameUserId]
  );
  return result.rows;
}

// Breadth-first search over one instance's sector graph from startSectorId.
// Every warp costs the same (unweighted edges), so BFS gives true shortest
// hop-count paths. Returns Map<sectorId, { distance, prevSectorId }> for
// every sector reachable from the start -- shared by /known-locations
// (annotates each discovered feature's distance) and /route/:sectorId
// (reconstructs the actual path by walking prevSectorId back to the start).
async function computeSectorDistances(client, instanceId, startSectorId) {
  const linksResult = await client.query(
    'SELECT from_sector_id, to_sector_id FROM haulonaut_sector_links WHERE game_instance_id = $1',
    [instanceId]
  );
  const adjacency = new Map();
  for (const link of linksResult.rows) {
    if (!adjacency.has(link.from_sector_id)) adjacency.set(link.from_sector_id, []);
    adjacency.get(link.from_sector_id).push(link.to_sector_id);
  }

  const distances = new Map([[startSectorId, { distance: 0, prevSectorId: null }]]);
  const queue = [startSectorId];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const currentDistance = distances.get(current).distance;
    for (const next of adjacency.get(current) || []) {
      if (!distances.has(next)) {
        distances.set(next, { distance: currentDistance + 1, prevSectorId: current });
        queue.push(next);
      }
    }
  }
  return distances;
}

// Records that a character has been to a sector (first visit creates the
// row; later visits just bump last_visited_at). Drives the "you've been
// here before" highlight on the warp buttons.
async function markSectorVisited(client, gameUserId, sectorId) {
  await client.query(
    `INSERT INTO haulonaut_visited_sectors (game_user_id, sector_id) VALUES ($1, $2)
     ON DUPLICATE KEY UPDATE last_visited_at = NOW()`,
    [gameUserId, sectorId]
  );
}

// Picks a random sector in the character's instance and creates their
// haulonaut_pilots row there. Returns the sector { id, sector_number,
// description }, or null if the character or its instance has no sectors
// at all.
async function spawnPilotAtRandomSector(client, gameUserId) {
  const gameUserResult = await client.query('SELECT game_instance_id FROM game_users WHERE id = $1', [gameUserId]);
  if (gameUserResult.rowCount === 0) return null;

  const randomSector = await client.query(
    'SELECT id, sector_number, description FROM haulonaut_sectors WHERE game_instance_id = $1 ORDER BY RAND() LIMIT 1',
    [gameUserResult.rows[0].game_instance_id]
  );
  if (randomSector.rowCount === 0) return null;

  await client.query(
    'INSERT IGNORE INTO haulonaut_pilots (game_user_id, current_sector_id) VALUES ($1, $2)',
    [gameUserId, randomSector.rows[0].id]
  );
  await markSectorVisited(client, gameUserId, randomSector.rows[0].id);

  // credits/rations/fuel aren't re-fetched here -- a just-inserted pilot
  // always has the column defaults, which match these constants (see the
  // comment by their declaration).
  return { ...randomSector.rows[0], credits: STARTING_CREDITS, rations: STARTING_RATIONS, fuel: STARTING_FUEL };
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
      'SELECT id FROM haulonaut_sectors WHERE game_instance_id = $1 ORDER BY RAND() LIMIT 1',
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

    // Spawn at a random sector -- no "home base," everyone starts somewhere different.
    await client.query(
      'INSERT INTO haulonaut_pilots (game_user_id, current_sector_id) VALUES ($1, $2)',
      [insertResult.insertId, startSector.rows[0].id]
    );
    await markSectorVisited(client, insertResult.insertId, startSector.rows[0].id);

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

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel } = await loadPilotLocation(client, req.params.id);
    const inventory = await loadInventory(client, req.params.id);

    res.json({ character: result.rows[0], currentSector, connectedSectors, features, playersHere, credits, rations, fuel, inventory });
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
      'SELECT current_sector_id, rations, fuel FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });
    const pilot = pilotResult.rows[0];

    const linkCheck = await client.query(
      'SELECT 1 FROM haulonaut_sector_links WHERE from_sector_id = $1 AND to_sector_id = $2',
      [pilot.current_sector_id, toSectorId]
    );
    if (linkCheck.rowCount === 0) return res.status(400).json({ message: 'That sector is not reachable from here' });

    // A warp can't be afforded once either resource has actually hit 0 --
    // checked against the cost (not just > 0) so this stays correct if
    // either cost is ever tuned above 1. The hop that brings a resource
    // down TO 0 is still allowed; it's the next one, starting from 0,
    // that gets rejected here.
    const outOfRations = pilot.rations < WARP_RATIONS_COST;
    const outOfFuel = pilot.fuel < WARP_FUEL_COST;
    if (outOfRations && outOfFuel) {
      return res.status(409).json({ message: 'Out of rations and fuel -- cannot warp' });
    } else if (outOfRations) {
      return res.status(409).json({ message: 'Out of rations -- cannot warp' });
    } else if (outOfFuel) {
      return res.status(409).json({ message: 'Out of fuel -- cannot warp' });
    }

    // Every warp costs a small, fixed amount of rations and fuel (clamped
    // at 0 rather than going negative) -- credits aren't touched by
    // movement, only by whatever the player chooses to spend them on
    // later.
    await client.query(
      `UPDATE haulonaut_pilots
       SET current_sector_id = $1, rations = GREATEST(0, rations - $2), fuel = GREATEST(0, fuel - $3)
       WHERE game_user_id = $4`,
      [toSectorId, WARP_RATIONS_COST, WARP_FUEL_COST, req.params.id]
    );
    await markSectorVisited(client, req.params.id, toSectorId);
    await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [req.params.id]);

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel } = await loadPilotLocation(client, req.params.id);

    res.json({ currentSector, connectedSectors, features, playersHere, credits, rations, fuel });
  } catch (err) {
    console.error('Error navigating:', err);
    res.status(500).json({ message: 'Failed to navigate' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/drift
 * Moves the character exactly one hop toward the nearest planet in the
 * instance (falling back to the nearest trading outpost, then a random
 * adjacent sector, if no planet exists anywhere reachable) -- doesn't
 * touch credits/rations/fuel, since this represents uncontrolled momentum
 * while stranded, not a piloted warp. Rejected if fuel is above 0 (drift
 * only applies while actually out) or the character is already sitting on
 * a planet (nothing left to drift toward).
 *
 * Called once per drift-variance threshold crossing, paced entirely by
 * the client (HaulonautPlayPage.vue), which only ticks that variance
 * while the tab is visible -- there's no server-side scheduler making
 * this happen on its own, matching the requirement that drift movement
 * only occurs while someone is actually watching.
 */
router.post('/:gameKey/characters/:id/drift', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.game_instance_id FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    const instanceId = ownerCheck.rows[0].game_instance_id;

    const pilotResult = await client.query(
      'SELECT current_sector_id, fuel FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });
    if (pilotResult.rows[0].fuel > 0) return res.status(409).json({ message: 'Not out of fuel' });
    const currentSectorId = pilotResult.rows[0].current_sector_id;

    const featuresResult = await client.query(
      `SELECT sf.feature_type, hs.id AS sector_id
       FROM haulonaut_sector_features sf
       JOIN haulonaut_sectors hs ON hs.id = sf.sector_id
       WHERE hs.game_instance_id = $1`,
      [instanceId]
    );
    if (featuresResult.rows.some(f => f.sector_id === currentSectorId && f.feature_type === 'planet')) {
      return res.status(409).json({ message: 'Already at a planet' });
    }

    const distances = await computeSectorDistances(client, instanceId, currentSectorId);

    let target = null;
    for (const type of ['planet', 'trading_outpost']) {
      for (const f of featuresResult.rows) {
        if (f.feature_type !== type || f.sector_id === currentSectorId) continue;
        const d = distances.get(f.sector_id);
        if (d && (!target || d.distance < target.distance)) target = { sectorId: f.sector_id, distance: d.distance };
      }
      if (target) break;
    }
    if (!target) {
      const adjacentResult = await client.query(
        'SELECT to_sector_id FROM haulonaut_sector_links WHERE from_sector_id = $1 ORDER BY RAND() LIMIT 1',
        [currentSectorId]
      );
      if (adjacentResult.rowCount === 0) return res.status(409).json({ message: 'Nowhere to drift' });
      target = { sectorId: adjacentResult.rows[0].to_sector_id };
    }

    // Reconstruct the shortest path back to the current sector and take
    // just the first step -- same walk-back-via-prevSectorId pattern as
    // /route/:sectorId, but only one hop is actually applied here.
    const pathIds = [];
    for (let step = target.sectorId; step !== null; step = distances.get(step).prevSectorId) {
      pathIds.unshift(step);
    }
    const nextSectorId = pathIds.length > 1 ? pathIds[1] : pathIds[0];

    await client.query('UPDATE haulonaut_pilots SET current_sector_id = $1 WHERE game_user_id = $2', [nextSectorId, req.params.id]);
    await markSectorVisited(client, req.params.id, nextSectorId);
    await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [req.params.id]);

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel } = await loadPilotLocation(client, req.params.id);

    res.json({ currentSector, connectedSectors, features, playersHere, credits, rations, fuel });
  } catch (err) {
    console.error('Error drifting:', err);
    res.status(500).json({ message: 'Failed to drift' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/items
 * The full item catalog -- global to the game, not per-instance or
 * per-outpost (see migration 060). Any authenticated user can read it,
 * same as game info itself; it's not tied to a specific character.
 */
router.get('/:gameKey/items', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const gameResult = await client.query('SELECT id FROM games WHERE game_key = $1', [req.params.gameKey]);
    if (gameResult.rowCount === 0) return res.status(404).json({ message: 'Game not found' });

    const itemsResult = await client.query(
      'SELECT id, item_key, name, category, description, base_price FROM haulonaut_items ORDER BY category, base_price'
    );
    res.json({ items: itemsResult.rows });
  } catch (err) {
    console.error('Error loading items:', err);
    res.status(500).json({ message: 'Failed to load items' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/purchase
 * Buy one item from whatever outpost is in the character's current
 * sector. Body: { item_key, quantity } -- quantity optional, defaults to
 * 1, clamped to 1-99. Rejects the purchase unless the character is
 * actually standing in a sector with a trading_outpost feature (re-checked
 * server-side, not trusted from the client), and unless they can afford
 * base_price * quantity in credits.
 *
 * 'rations' and 'fuel' are special cases: they add straight to
 * haulonaut_pilots.rations / .fuel instead of becoming an inventory row,
 * since both are already top-level pilot stats shown in the HUD -- see
 * migrations 060 and 061. Every other item goes into
 * haulonaut_pilot_inventory.
 */
router.post('/:gameKey/characters/:id/purchase', authenticate, async (req, res) => {
  const itemKey = (req.body.item_key || '').trim();
  const quantity = Math.min(99, Math.max(1, parseInt(req.body.quantity, 10) || 1));
  if (!itemKey) return res.status(400).json({ message: 'item_key is required' });

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
      'SELECT current_sector_id, credits FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    const outpostCheck = await client.query(
      `SELECT 1 FROM haulonaut_sector_features WHERE sector_id = $1 AND feature_type = 'trading_outpost'`,
      [pilotResult.rows[0].current_sector_id]
    );
    if (outpostCheck.rowCount === 0) return res.status(409).json({ message: 'No outpost in this sector' });

    const itemResult = await client.query(
      'SELECT id, item_key, name, base_price FROM haulonaut_items WHERE item_key = $1',
      [itemKey]
    );
    if (itemResult.rowCount === 0) return res.status(404).json({ message: 'Item not found' });
    const item = itemResult.rows[0];

    const totalCost = item.base_price * quantity;
    if (pilotResult.rows[0].credits < totalCost) return res.status(400).json({ message: 'Not enough credits' });

    await client.beginTransaction();

    await client.query('UPDATE haulonaut_pilots SET credits = credits - $1 WHERE game_user_id = $2', [totalCost, req.params.id]);

    if (item.item_key === 'rations') {
      await client.query('UPDATE haulonaut_pilots SET rations = rations + $1 WHERE game_user_id = $2', [quantity, req.params.id]);
    } else if (item.item_key === 'fuel') {
      await client.query('UPDATE haulonaut_pilots SET fuel = fuel + $1 WHERE game_user_id = $2', [quantity, req.params.id]);
    } else {
      await client.query(
        `INSERT INTO haulonaut_pilot_inventory (game_user_id, item_id, quantity) VALUES ($1, $2, $3)
         ON DUPLICATE KEY UPDATE quantity = quantity + $3`,
        [req.params.id, item.id, quantity]
      );
    }

    await client.commit();

    const pilotAfter = await client.query('SELECT credits, rations, fuel FROM haulonaut_pilots WHERE game_user_id = $1', [req.params.id]);
    const inventory = await loadInventory(client, req.params.id);

    res.json({
      message: `Purchased ${quantity} ${item.name}`,
      credits: pilotAfter.rows[0].credits,
      rations: pilotAfter.rows[0].rations,
      fuel: pilotAfter.rows[0].fuel,
      inventory
    });
  } catch (err) {
    await client.rollback();
    console.error('Error purchasing item:', err);
    res.status(500).json({ message: 'Failed to purchase item' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/characters/:id/known-locations
 * Every sector feature (planet, trading_outpost, and whatever future types
 * get added) sitting in a sector this character has actually visited --
 * derived from haulonaut_visited_sectors rather than a separate
 * "discovered features" table, since visiting a sector already means its
 * contents were seen (Sector Scan shows them on arrival). Each entry is
 * annotated with its hop-distance from the character's CURRENT sector via
 * BFS, so the list can be sorted nearest-first and the client doesn't need
 * to compute distances itself.
 */
router.get('/:gameKey/characters/:id/known-locations', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.game_instance_id FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    const instanceId = ownerCheck.rows[0].game_instance_id;

    const pilotResult = await client.query(
      'SELECT current_sector_id FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    const featuresResult = await client.query(
      `SELECT sf.id, sf.feature_type, sf.name, sf.description, hs.id AS sector_id, hs.sector_number
       FROM haulonaut_sector_features sf
       JOIN haulonaut_sectors hs ON hs.id = sf.sector_id
       JOIN haulonaut_visited_sectors hvs ON hvs.sector_id = hs.id AND hvs.game_user_id = $1
       WHERE hs.game_instance_id = $2`,
      [req.params.id, instanceId]
    );

    const distances = await computeSectorDistances(client, instanceId, pilotResult.rows[0].current_sector_id);

    const locations = featuresResult.rows
      .map(f => ({
        id: f.id,
        feature_type: f.feature_type,
        name: f.name,
        description: f.description,
        sector_id: f.sector_id,
        sector_number: f.sector_number,
        distance: distances.has(f.sector_id) ? distances.get(f.sector_id).distance : null
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name));

    res.json({ locations });
  } catch (err) {
    console.error('Error loading known locations:', err);
    res.status(500).json({ message: 'Failed to load known locations' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/characters/:id/route/:sectorId
 * The shortest hop-by-hop path from the character's current sector to
 * sectorId, as an ordered list of { id, sector_number } (path[0] is the
 * current sector itself). Read-only -- doesn't move the character or spend
 * anything; the client warps along the returned path one hop at a time via
 * the existing /navigate route, so rations still drain and links are still
 * re-validated exactly like a manual warp.
 */
router.get('/:gameKey/characters/:id/route/:sectorId', authenticate, async (req, res) => {
  const targetSectorId = parseInt(req.params.sectorId, 10);
  if (!targetSectorId) return res.status(400).json({ message: 'Invalid sector' });

  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.game_instance_id FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    const instanceId = ownerCheck.rows[0].game_instance_id;

    const pilotResult = await client.query(
      'SELECT current_sector_id FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    // Confirm the destination actually belongs to this instance -- a
    // sector id from another universe should never leak a route.
    const targetCheck = await client.query(
      'SELECT id FROM haulonaut_sectors WHERE id = $1 AND game_instance_id = $2',
      [targetSectorId, instanceId]
    );
    if (targetCheck.rowCount === 0) return res.status(404).json({ message: 'Sector not found' });

    const distances = await computeSectorDistances(client, instanceId, pilotResult.rows[0].current_sector_id);
    if (!distances.has(targetSectorId)) return res.status(404).json({ message: 'No route to that sector' });

    const pathIds = [];
    for (let step = targetSectorId; step !== null; step = distances.get(step).prevSectorId) {
      pathIds.unshift(step);
    }

    const sectorsResult = await client.query(
      `SELECT id, sector_number FROM haulonaut_sectors WHERE id IN (${pathIds.map((_, i) => `$${i + 1}`).join(',')})`,
      pathIds
    );
    const numberById = new Map(sectorsResult.rows.map(r => [r.id, r.sector_number]));
    const path = pathIds.map(id => ({ id, sector_number: numberById.get(id) }));

    res.json({ path });
  } catch (err) {
    console.error('Error computing route:', err);
    res.status(500).json({ message: 'Failed to compute route' });
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
 * DELETE /api/games/:gameKey/admin/instances/:instanceId
 * Game-admin only: permanently delete a universe -- unlike /end, this
 * removes the game_instances row outright. Every Haulonaut table FKs to it
 * (directly or transitively) with ON DELETE CASCADE, so this single delete
 * also removes the instance's sectors, sector links, sector features,
 * every character (game_users) created in it, and those characters' pilot
 * locations, visited-sector history, and settings. There is no undo.
 *
 * Requires the caller to echo the instance's exact name back in the body
 * as `confirmName` -- a second, server-side check behind whatever
 * confirmation the admin UI already made them type, so this endpoint can't
 * be triggered by a bare click/replay without knowing which universe it's
 * destroying.
 */
router.delete('/:gameKey/admin/instances/:instanceId', authenticate, requireGameAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const instanceResult = await client.query(
      `SELECT gi.id, gi.name,
              (SELECT COUNT(*) FROM haulonaut_sectors hs WHERE hs.game_instance_id = gi.id) AS sector_count,
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id) AS player_count
       FROM game_instances gi
       WHERE gi.id = $1 AND gi.game_id = $2`,
      [req.params.instanceId, req.gameId]
    );
    if (instanceResult.rowCount === 0) return res.status(404).json({ message: 'Instance not found' });
    const instance = instanceResult.rows[0];

    if ((req.body.confirmName || '').trim() !== instance.name) {
      return res.status(400).json({ message: 'Confirmation name does not match' });
    }

    await client.query('DELETE FROM game_instances WHERE id = $1', [instance.id]);

    res.json({
      message: 'Universe deleted',
      deleted: { name: instance.name, sectorCount: instance.sector_count, playerCount: instance.player_count }
    });
  } catch (err) {
    console.error('Error deleting universe:', err);
    res.status(500).json({ message: 'Failed to delete universe' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/admin/universe
 * Game-admin only: generate a fresh universe for this game, alongside any
 * other instances currently active (does not end anything -- use
 * /admin/instances/:instanceId/end for that separately). Body: { name,
 * sectors, min_links, max_links, avg_degree, planet_chance, outpost_chance }
 * -- all optional, defaulting to the same values the CLI generator script
 * uses. planet_chance/outpost_chance are per-sector independent
 * probabilities (0-1) -- exposed here so a future admin UI for tuning them
 * has somewhere to send values, even though today's form doesn't surface
 * them yet.
 */
router.post('/:gameKey/admin/universe', authenticate, requireGameAdmin, async (req, res) => {
  const name = (req.body.name || `Haulonaut Universe ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`).trim();
  const sectorCount = parseInt(req.body.sectors, 10) || 1000;
  const minLinks = parseInt(req.body.min_links, 10) || 1;
  const maxLinks = parseInt(req.body.max_links, 10) || 6;
  const avgDegree = parseFloat(req.body.avg_degree) || 3.5;
  const planetChance = req.body.planet_chance !== undefined ? parseFloat(req.body.planet_chance) : 0.05;
  const outpostChance = req.body.outpost_chance !== undefined ? parseFloat(req.body.outpost_chance) : 0.10;

  if (sectorCount < 10 || sectorCount > 5000) {
    return res.status(400).json({ message: 'sectors must be between 10 and 5000' });
  }
  if (planetChance < 0 || planetChance > 1 || outpostChance < 0 || outpostChance > 1) {
    return res.status(400).json({ message: 'planet_chance and outpost_chance must be between 0 and 1' });
  }

  let graph;
  let content;
  try {
    graph = buildUniverseGraph(sectorCount, minLinks, maxLinks, avgDegree);
    content = generateSectorContent(sectorCount, { planetChance, outpostChance });
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
    for (let n = 1; n <= sectorCount; n++) sectorRows.push([instanceId, n, content[n - 1].description]);
    const SECTOR_BATCH = 500;
    for (let i = 0; i < sectorRows.length; i += SECTOR_BATCH) {
      const { sql, params } = buildBulkInsertQuery(
        'haulonaut_sectors', ['game_instance_id', 'sector_number', 'description'], sectorRows.slice(i, i + SECTOR_BATCH)
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

    const featureRows = [];
    content.forEach((sc, i) => {
      const sectorId = idByIndex[i];
      for (const f of sc.features) featureRows.push([sectorId, f.feature_type, f.name, f.description]);
    });
    const FEATURE_BATCH = 300;
    for (let i = 0; i < featureRows.length; i += FEATURE_BATCH) {
      const { sql, params } = buildBulkInsertQuery(
        'haulonaut_sector_features', ['sector_id', 'feature_type', 'name', 'description'], featureRows.slice(i, i + FEATURE_BATCH)
      );
      await client.query(sql, params);
    }

    await client.query(`UPDATE game_instances SET status = 'active', started_at = NOW() WHERE id = $1`, [instanceId]);

    await client.commit();

    res.status(201).json({
      instance: { id: instanceId, name },
      sectorCount: sectorRows.length,
      linkCount: linkRows.length,
      planetCount: featureRows.filter(r => r[1] === 'planet').length,
      outpostCount: featureRows.filter(r => r[1] === 'trading_outpost').length,
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
