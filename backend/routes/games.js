const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { buildUniverseGraph, generateSectorContent, randomNpcName } = require('../utilities/haulonautUniverse');
const { rollLandingEvent } = require('../utilities/haulonautLandingEvents');
const { emitToUser, getIO } = require('../utilities/socket');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// A new pilot's starting stake, and what a single warp costs -- must stay
// in sync with the haulonaut_pilots column defaults in migrations 059,
// 061, and 067, since both the self-heal spawn path and character creation
// insert a pilot row without specifying credits/rations/fuel/health and
// rely on those defaults matching these numbers. Rations and fuel both
// drain on warp (a ship needs to feed its crew and burn reaction mass
// regardless of distance); credits aren't touched by movement at all --
// they'll only ever be spent on something the player actually chooses to
// buy. Rations and fuel are clamped at 0 in the /navigate UPDATE rather
// than going negative -- ways to replenish them are a separate follow-up.
const STARTING_CREDITS = 1000;
const STARTING_RATIONS = 100;
const STARTING_FUEL = 100;
const WARP_RATIONS_COST = 1;
const WARP_FUEL_COST = 1;

// Crew health (see migration 067). Rations no longer block a warp -- fuel
// and cycles do -- but each warp feeds the crew from that warp's rations
// draw or, if rations were already empty, starves them. Health hitting 0
// kills the character (game_users.status -> 'dead'). STARTING_HEALTH /
// MAX_HEALTH must match the haulonaut_pilots.health column default (100),
// for the same self-heal-spawn / character-creation reason as the stats
// above.
const STARTING_HEALTH = 100;
const MAX_HEALTH = 100;
const WARP_HEALTH_REGEN = 3;
const WARP_STARVATION_DAMAGE = 15;

// Cycles -- a wall-clock action budget (see migrations 066 and 068). A
// pilot holds at most MAX_CYCLES and regains one every
// CYCLE_REPLENISH_SECONDS of real time, whether online or not
// (replenishCycles below does this lazily on read). STARTING_CYCLES /
// MAX_CYCLES must match the haulonaut_pilots.cycles column default in
// migration 068 (120) -- the self-heal spawn and character creation paths
// insert a pilot row without naming cycles and rely on that default.
//
// Only piloted travel spends cycles, and not all of it at the same rate:
// warping to another sector and landing on a planet are the big maneuvers
// (WARP/DOCK_CYCLE_COST), while nudging the buggy one surface cell is cheap
// local exploration (BUGGY_CYCLE_COST). Trading, course plotting,
// launching, exiting the craft, and passive drift cost nothing.
//
// The 5x jump from the original 24/1-per-hour/1-per-action economy (see
// migration 066) keeps a warp exactly as scarce as it was -- 5 of 120, one
// warp's worth regained every hour -- while making a buggy move a fifth as
// costly in relative terms, so surface exploration stops competing with
// interstellar travel for the same tight budget.
const MAX_CYCLES = 120;
const STARTING_CYCLES = 120;
const CYCLE_REPLENISH_SECONDS = 720; // one cycle per 12 min -> 5/hour; full 120 bar in 24h
const WARP_CYCLE_COST = 5;
const DOCK_CYCLE_COST = 5;
const BUGGY_CYCLE_COST = 1;

// Combat -- open PvP, health-only stakes (see /attack below): no consent
// needed to attack another active, non-NPC character in the same sector,
// and losing costs health rather than credits/cargo, reusing the exact
// death mechanic starvation already uses (health to 0 -> game_users.status
// = 'dead'). Requires owning a laser_cannon (see haulonaut_items, migration
// 060) rather than a separate "combat power" stat -- your ship needs a
// mounted weapon to fight, and the item already existed in the catalog
// unused. ATTACK_CYCLE_COST is cheaper than a warp/dock (the big
// maneuvers) but still draws from the same scarce budget, which is what
// actually throttles how often anyone can fight -- there's no separate
// combat cooldown. Damage is randomized within a range comparable to a
// single starved warp (WARP_STARVATION_DAMAGE), so a fight plays out over
// several hits rather than one-shotting from full health.
const ATTACK_CYCLE_COST = 3;
const ATTACK_MIN_DAMAGE = 15;
const ATTACK_MAX_DAMAGE = 30;
const ATTACK_WEAPON_ITEM_KEY = 'laser_cannon';

// A planet surface's exploration grid -- low-res and small on purpose (see
// haulonaut_surface_maps in migration 063). Reveal radius 1 means a 3x3
// block (the cell moved onto, plus its immediate neighbors) is uncovered
// per stop, including the very first reveal around the ship's own landing
// point -- genuinely starts mostly black and takes real exploration to
// uncover, rather than showing most of the map on arrival. Buggy movement
// is free (no rations/fuel cost, unlike warping) -- it's exploration on an
// already-parked ship, not another form of travel.
const SURFACE_MAP_GRID_WIDTH = 12;
const SURFACE_MAP_GRID_HEIGHT = 8;
const SURFACE_MAP_REVEAL_RADIUS = 1;
const SURFACE_MAP_DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle, is_guest FROM users WHERE handle = $1', [payload.username]);
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

// Lazily accrues replenished cycles from wall-clock time elapsed since
// cycles_updated_at -- one per CYCLE_REPLENISH_SECONDS, capped at
// MAX_CYCLES -- so replenishment is identical whether the player is online,
// backgrounded, or logged out (see migration 066). The anchor advances by
// whole intervals actually consumed, never straight to "now", so progress
// toward the next cycle survives across calls. While the pilot is at the
// cap the anchor is pulled up to "now" instead, so a long-idle full bar
// never banks overflow. Returns { cycles, cyclesUpdatedAt } with
// cyclesUpdatedAt as epoch seconds (what the client's own countdown needs).
// FROM_UNIXTIME/UNIX_TIMESTAMP are exact inverses under a stable session
// timezone, so the epoch round-trip here is timezone-independent.
async function replenishCycles(client, gameUserId) {
  const result = await client.query(
    `SELECT cycles,
            UNIX_TIMESTAMP(cycles_updated_at) AS anchor,
            UNIX_TIMESTAMP() AS now_ts
     FROM haulonaut_pilots WHERE game_user_id = $1`,
    [gameUserId]
  );
  if (result.rowCount === 0) return { cycles: 0, cyclesUpdatedAt: 0 };

  const cycles = Number(result.rows[0].cycles);
  const anchor = Number(result.rows[0].anchor);
  const now = Number(result.rows[0].now_ts);

  if (cycles >= MAX_CYCLES) {
    // Keep the accrual clock parked at "now" while full -- but only touch
    // the row if it's actually drifted, to avoid a pointless write (and an
    // updated_at bump) on every read of an already-current full bar.
    if (anchor < now) {
      await client.query(
        'UPDATE haulonaut_pilots SET cycles_updated_at = FROM_UNIXTIME($1) WHERE game_user_id = $2',
        [now, gameUserId]
      );
    }
    return { cycles: MAX_CYCLES, cyclesUpdatedAt: now };
  }

  const earned = Math.floor((now - anchor) / CYCLE_REPLENISH_SECONDS);
  if (earned <= 0) return { cycles, cyclesUpdatedAt: anchor };

  const newCycles = Math.min(MAX_CYCLES, cycles + earned);
  const newAnchor = newCycles >= MAX_CYCLES ? now : anchor + earned * CYCLE_REPLENISH_SECONDS;
  await client.query(
    'UPDATE haulonaut_pilots SET cycles = $1, cycles_updated_at = FROM_UNIXTIME($2) WHERE game_user_id = $3',
    [newCycles, newAnchor, gameUserId]
  );
  return { cycles: newCycles, cyclesUpdatedAt: newAnchor };
}

// Replenishes first (so time-accrued cycles are spendable), then deducts
// `cost` if the pilot can afford it. The deduction is guarded with
// "AND cycles >= cost" so two racing requests can't drive it negative --
// the loser comes back ok:false. Returns { ok, cycles, cyclesUpdatedAt };
// on ok:false nothing was deducted and `cycles` is the current balance
// (for the "out of cycles" message).
async function spendCycles(client, gameUserId, cost) {
  const { cycles, cyclesUpdatedAt } = await replenishCycles(client, gameUserId);
  if (cycles < cost) return { ok: false, cycles, cyclesUpdatedAt };
  const upd = await client.query(
    'UPDATE haulonaut_pilots SET cycles = cycles - $1 WHERE game_user_id = $2 AND cycles >= $1',
    [cost, gameUserId]
  );
  if (!upd.affectedRows) return { ok: false, cycles, cyclesUpdatedAt };
  return { ok: true, cycles: cycles - cost, cyclesUpdatedAt };
}

// Whether a character is still playable. Health hitting 0 on a starved warp
// (see applyWarpHealth) flips game_users.status to 'dead'; every mutating
// action rechecks this so a lost pilot can't keep warping, trading, or
// driving the buggy. The GET character endpoint deliberately does NOT gate
// on this -- the play page still needs to load to show the "lost" screen.
async function isAlive(client, gameUserId) {
  const r = await client.query('SELECT status FROM game_users WHERE id = $1', [gameUserId]);
  return r.rowCount > 0 && r.rows[0].status === 'active';
}

// Applies one warp's effect on crew health and returns the new value plus
// whether that warp just killed the character. `hadRations` is whether the
// pilot had at least WARP_RATIONS_COST in stock *before* this warp's draw:
// if so the crew eats and health ticks back up toward MAX_HEALTH; if not
// the crew goes hungry and health drops by WARP_STARVATION_DAMAGE. Health
// reaching 0 sets game_users.status = 'dead' / died_at (guarded on the row
// still being 'active' so a racing second warp can't re-stamp died_at).
async function applyWarpHealth(client, gameUserId, hadRations) {
  if (hadRations) {
    await client.query(
      'UPDATE haulonaut_pilots SET health = LEAST($1, health + $2) WHERE game_user_id = $3',
      [MAX_HEALTH, WARP_HEALTH_REGEN, gameUserId]
    );
  } else {
    await client.query(
      'UPDATE haulonaut_pilots SET health = GREATEST(0, health - $1) WHERE game_user_id = $2',
      [WARP_STARVATION_DAMAGE, gameUserId]
    );
  }
  const r = await client.query('SELECT health FROM haulonaut_pilots WHERE game_user_id = $1', [gameUserId]);
  const health = Number(r.rows[0].health);
  let died = false;
  if (health <= 0) {
    const upd = await client.query(
      "UPDATE game_users SET status = 'dead', died_at = NOW() WHERE id = $1 AND status = 'active'",
      [gameUserId]
    );
    died = upd.affectedRows > 0;
  }
  return { health, died };
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
    `SELECT hs.id, hs.sector_number, hs.description, hp.credits, hp.rations, hp.fuel, hp.health
     FROM haulonaut_pilots hp
     JOIN haulonaut_sectors hs ON hs.id = hp.current_sector_id
     WHERE hp.game_user_id = $1`,
    [gameUserId]
  );

  if (pilotResult.rowCount === 0) {
    const spawned = await spawnPilotAtRandomSector(client, gameUserId);
    if (!spawned) return { currentSector: null, connectedSectors: [], features: [], playersHere: [], credits: 0, rations: 0, fuel: 0, health: 0, cycles: 0, cyclesUpdatedAt: 0 };
    pilotResult = { rows: [spawned] };
  }

  const { credits, rations, fuel, health, ...currentSector } = pilotResult.rows[0];
  const { cycles, cyclesUpdatedAt } = await replenishCycles(client, gameUserId);

  const linksResult = await client.query(
    `SELECT hs.id, hs.sector_number
     FROM haulonaut_sector_links hsl
     JOIN haulonaut_sectors hs ON hs.id = hsl.to_sector_id
     WHERE hsl.from_sector_id = $1
     ORDER BY hs.sector_number`,
    [currentSector.id]
  );

  // ORDER BY id: makes "which feature is THE planet" deterministic (lowest
  // id) in the schema-permitted but never-yet-generated case of a sector
  // holding more than one -- matches the same tie-break used to pick a
  // planet in /exit-craft below.
  const featuresResult = await client.query(
    'SELECT id, feature_type, name, description FROM haulonaut_sector_features WHERE sector_id = $1 ORDER BY id',
    [currentSector.id]
  );

  const playersResult = await client.query(
    `SELECT gu.id, gu.display_name, gu.is_npc
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
    fuel,
    health,
    cycles,
    cyclesUpdatedAt
  };
}

// Returns a NEW array (doesn't mutate existingIndices) with every cell in
// the radius-sized square centered on (x,y) added, clamped to the grid and
// deduped via a Set. Row-major indexing (index = y * gridWidth + x) matches
// haulonaut_surface_maps.revealed_cells.
function revealAround(existingIndices, x, y, gridWidth, gridHeight, radius) {
  const set = new Set(existingIndices);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) set.add(ny * gridWidth + nx);
    }
  }
  return Array.from(set);
}

// First-ever visit to a given planet feature: creates its
// haulonaut_surface_maps row, parking the ship (and starting the buggy) at
// the grid's center with an initial reveal around that point -- so landing
// doesn't drop the player into total blackness with 0 cells visible. The
// ship's own starting cell is marked visited (not a "new area" to roll an
// event for -- that's where the player just disembarked from).
async function createSurfaceMap(client, gameUserId, featureId) {
  const shipX = Math.floor(SURFACE_MAP_GRID_WIDTH / 2);
  const shipY = Math.floor(SURFACE_MAP_GRID_HEIGHT / 2);
  const revealed = revealAround([], shipX, shipY, SURFACE_MAP_GRID_WIDTH, SURFACE_MAP_GRID_HEIGHT, SURFACE_MAP_REVEAL_RADIUS);
  const visited = [shipY * SURFACE_MAP_GRID_WIDTH + shipX];
  await client.query(
    `INSERT INTO haulonaut_surface_maps
       (game_user_id, feature_id, grid_width, grid_height, ship_x, ship_y, buggy_x, buggy_y, revealed_cells, visited_cells)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8)`,
    [gameUserId, featureId, SURFACE_MAP_GRID_WIDTH, SURFACE_MAP_GRID_HEIGHT, shipX, shipY, JSON.stringify(revealed), JSON.stringify(visited)]
  );
  return { gridWidth: SURFACE_MAP_GRID_WIDTH, gridHeight: SURFACE_MAP_GRID_HEIGHT, shipX, shipY, buggyX: shipX, buggyY: shipY, revealed };
}

// Whether a character has landed at a planet -- docked_feature_id is
// non-null the moment the landing sequence reaches 'docked' (see POST
// /dock), independent of whether they've since stepped out of the ship
// (on_surface). The surface map is only loaded/created once they actually
// have (on_surface = 1) -- no reason to allocate it before it's needed.
// Self-heals like loadPilotLocation does for a missing pilot row:
// on_surface with no matching map row (shouldn't happen via normal flow,
// since /exit-craft creates both together) gets a fresh map rather than a
// broken response.
async function loadSurfaceState(client, gameUserId) {
  const pilotResult = await client.query(
    'SELECT docked_feature_id, on_surface FROM haulonaut_pilots WHERE game_user_id = $1',
    [gameUserId]
  );
  const dockedFeatureId = pilotResult.rowCount > 0 ? pilotResult.rows[0].docked_feature_id : null;
  const onSurface = pilotResult.rowCount > 0 && !!pilotResult.rows[0].on_surface;
  if (!dockedFeatureId || !onSurface) return { dockedFeatureId, onSurface: false, surfaceMap: null };

  const mapResult = await client.query(
    `SELECT grid_width, grid_height, ship_x, ship_y, buggy_x, buggy_y, revealed_cells
     FROM haulonaut_surface_maps WHERE game_user_id = $1 AND feature_id = $2`,
    [gameUserId, dockedFeatureId]
  );
  if (mapResult.rowCount === 0) {
    return { dockedFeatureId, onSurface: true, surfaceMap: await createSurfaceMap(client, gameUserId, dockedFeatureId) };
  }
  const row = mapResult.rows[0];
  return {
    dockedFeatureId,
    onSurface: true,
    surfaceMap: {
      gridWidth: row.grid_width,
      gridHeight: row.grid_height,
      shipX: row.ship_x,
      shipY: row.ship_y,
      buggyX: row.buggy_x,
      buggyY: row.buggy_y,
      revealed: JSON.parse(row.revealed_cells)
    }
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
  return { ...randomSector.rows[0], credits: STARTING_CREDITS, rations: STARTING_RATIONS, fuel: STARTING_FUEL, health: STARTING_HEALTH };
}

// Resolves a gift/trade target: a different, active character currently in
// the same sector as the acting character (self-joins haulonaut_pilots on
// current_sector_id, so "same sector" and "target still active" are both
// checked in one query). Returns null if any of that doesn't hold --
// callers turn that into a single 404/409 rather than distinguishing "no
// such character" from "not here anymore".
async function loadSameSectorTarget(client, actingGameUserId, targetGameUserId) {
  if (!targetGameUserId || Number(targetGameUserId) === Number(actingGameUserId)) return null;
  const result = await client.query(
    `SELECT tgu.id, tgu.user_id, tgu.display_name, tgu.is_npc
     FROM haulonaut_pilots ahp
     JOIN haulonaut_pilots thp ON thp.current_sector_id = ahp.current_sector_id
     JOIN game_users tgu ON tgu.id = thp.game_user_id
     WHERE ahp.game_user_id = $1 AND thp.game_user_id = $2 AND tgu.status = 'active'`,
    [actingGameUserId, targetGameUserId]
  );
  return result.rowCount > 0 ? result.rows[0] : null;
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
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id AND gu.is_npc = 0) AS player_count
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

    // Guests get one captain at a time: a single living character in an active
    // universe. Once it dies (permadeath) or its universe ends they can launch
    // a fresh one, but they can't run a fleet.
    if (req.user.is_guest) {
      const existing = await client.query(
        `SELECT COUNT(*) AS n FROM game_users gu
         JOIN game_instances gi ON gi.id = gu.game_instance_id
         JOIN games g ON g.id = gi.game_id
         WHERE g.game_key = $1 AND gu.user_id = $2
           AND gu.status = 'active' AND gi.status = 'active'`,
        [req.params.gameKey, req.user.id]
      );
      if (Number(existing.rows[0].n) >= 1) {
        return res.status(409).json({ message: 'Guests can only have one captain at a time.' });
      }
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

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, cycles, cyclesUpdatedAt } = await loadPilotLocation(client, req.params.id);
    const inventory = await loadInventory(client, req.params.id);
    const { dockedFeatureId, onSurface, surfaceMap } = await loadSurfaceState(client, req.params.id);

    res.json({ character: result.rows[0], currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, cycles, cyclesUpdatedAt, inventory, dockedFeatureId, onSurface, surfaceMap });
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
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const pilotResult = await client.query(
      'SELECT current_sector_id, on_surface, rations, fuel FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });
    const pilot = pilotResult.rows[0];
    // Not reachable from the ship UI today (no warp controls render on the
    // surface screen), but re-checked server-side anyway -- same posture as
    // the link check just below, which the client also already enforces.
    // Being merely docked (still inside the ship) is fine -- warping away
    // is exactly how undocking happens, see the UPDATE below.
    if (pilot.on_surface) return res.status(409).json({ message: 'Return to ship before warping' });

    const linkCheck = await client.query(
      'SELECT 1 FROM haulonaut_sector_links WHERE from_sector_id = $1 AND to_sector_id = $2',
      [pilot.current_sector_id, toSectorId]
    );
    if (linkCheck.rowCount === 0) return res.status(400).json({ message: 'That sector is not reachable from here' });

    // Fuel is the only consumable that gates a warp (alongside cycles,
    // below) -- checked against the cost (not just > 0) so this stays
    // correct if WARP_FUEL_COST is ever tuned above 1. The hop that brings
    // fuel down TO 0 is still allowed; it's the next one, starting from 0,
    // that gets rejected here. Rations deliberately do NOT block a warp any
    // more: running dry on rations costs crew health instead (see
    // applyWarpHealth after the move below).
    const hadRations = pilot.rations >= WARP_RATIONS_COST;
    if (pilot.fuel < WARP_FUEL_COST) {
      return res.status(409).json({ message: 'Out of fuel -- cannot warp' });
    }

    // A warp costs WARP_CYCLE_COST cycles (the biggest single cycle spend --
    // see the constants block). Checked last, after the move is known to be
    // otherwise valid, so nothing is spent on a warp that would have been
    // rejected anyway. The client blocks this case up front too, but it's
    // re-enforced here like every other movement guard.
    const spent = await spendCycles(client, req.params.id, WARP_CYCLE_COST);
    if (!spent.ok) {
      return res.status(409).json({ message: `Not enough cycles to warp (need ${WARP_CYCLE_COST})`, cycles: spent.cycles, cyclesUpdatedAt: spent.cyclesUpdatedAt });
    }

    // Every warp costs a small, fixed amount of rations and fuel (clamped
    // at 0 rather than going negative) -- credits aren't touched by
    // movement, only by whatever the player chooses to spend them on
    // later. Warping always undocks (docked_feature_id/on_surface both
    // cleared) -- leaving orbit means neither applies any more, whether or
    // not the pilot was actually docked at the old sector's planet.
    await client.query(
      `UPDATE haulonaut_pilots
       SET current_sector_id = $1, rations = GREATEST(0, rations - $2), fuel = GREATEST(0, fuel - $3),
           docked_feature_id = NULL, on_surface = 0
       WHERE game_user_id = $4`,
      [toSectorId, WARP_RATIONS_COST, WARP_FUEL_COST, req.params.id]
    );
    await markSectorVisited(client, req.params.id, toSectorId);
    await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [req.params.id]);

    // The crew eats out of this warp's rations draw, or starves if there
    // was nothing to draw -- and a starved warp can drop health to 0 and
    // kill the character outright. Done after the move: thematically the
    // ship still completes the jump; the crew just may not survive it.
    const { died } = await applyWarpHealth(client, req.params.id, hadRations);

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, cycles, cyclesUpdatedAt } = await loadPilotLocation(client, req.params.id);

    res.json({ currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, died, cycles, cyclesUpdatedAt, dockedFeatureId: null, onSurface: false, surfaceMap: null });
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
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });
    const instanceId = ownerCheck.rows[0].game_instance_id;

    const pilotResult = await client.query(
      'SELECT current_sector_id, on_surface, fuel FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });
    // Not reachable from the surface screen today (drift is paced by the
    // ship UI's own tick, which doesn't run there), but re-checked
    // server-side for the same reason as /navigate's equivalent guard.
    // Redundant with the "Already at a planet" check below in practice
    // (being on the surface implies the current sector has a planet), but
    // cheap and explicit.
    if (pilotResult.rows[0].on_surface) return res.status(409).json({ message: 'Return to ship before drifting' });
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

    const { currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, cycles, cyclesUpdatedAt } = await loadPilotLocation(client, req.params.id);

    res.json({ currentSector, connectedSectors, features, playersHere, credits, rations, fuel, health, cycles, cyclesUpdatedAt });
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
 * Buy one item from whatever trading_outpost or planet is in the
 * character's current sector -- planets trade too (see the Planet
 * Overview "Trade" option), same catalog and prices as an outpost, no
 * separate inventory. Body: { item_key, quantity } -- quantity optional,
 * defaults to 1, clamped to 1-99. Rejects the purchase unless the
 * character is actually standing somewhere tradeable (re-checked
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
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const pilotResult = await client.query(
      'SELECT current_sector_id, credits FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    const tradeCheck = await client.query(
      `SELECT 1 FROM haulonaut_sector_features WHERE sector_id = $1 AND feature_type IN ('trading_outpost', 'planet')`,
      [pilotResult.rows[0].current_sector_id]
    );
    if (tradeCheck.rowCount === 0) return res.status(409).json({ message: 'Nowhere to trade in this sector' });

    const itemResult = await client.query(
      'SELECT id, item_key, name, base_price FROM haulonaut_items WHERE item_key = $1',
      [itemKey]
    );
    if (itemResult.rowCount === 0) return res.status(404).json({ message: 'Item not found' });
    const item = itemResult.rows[0];

    const totalCost = item.base_price * quantity;
    if (pilotResult.rows[0].credits < totalCost) return res.status(400).json({ message: 'Not enough tokens' });

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

    const pilotAfter = await client.query('SELECT credits, rations, fuel, health FROM haulonaut_pilots WHERE game_user_id = $1', [req.params.id]);
    const inventory = await loadInventory(client, req.params.id);
    // Trading never spends a cycle -- this is just so the HUD stays in sync
    // (and picks up any time-based replenishment) after a purchase.
    const { cycles, cyclesUpdatedAt } = await replenishCycles(client, req.params.id);

    res.json({
      message: `Purchased ${quantity} ${item.name}`,
      credits: pilotAfter.rows[0].credits,
      rations: pilotAfter.rows[0].rations,
      fuel: pilotAfter.rows[0].fuel,
      health: pilotAfter.rows[0].health,
      cycles,
      cyclesUpdatedAt,
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
 * POST /api/games/:gameKey/characters/:id/give
 * Instant credit gift to another active character in the same sector -- no
 * acceptance needed (receiving free credits can't hurt anyone), unlike
 * /trade-offers below which moves an item and needs the recipient to agree
 * first. Body: { to_character_id, credits }.
 */
router.post('/:gameKey/characters/:id/give', authenticate, async (req, res) => {
  const toCharacterId = parseInt(req.body.to_character_id, 10);
  const amount = parseInt(req.body.credits, 10);
  if (!toCharacterId) return res.status(400).json({ message: 'to_character_id is required' });
  if (!amount || amount <= 0) return res.status(400).json({ message: 'credits must be a positive number' });

  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.display_name FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const target = await loadSameSectorTarget(client, req.params.id, toCharacterId);
    if (!target) return res.status(404).json({ message: 'That pilot is not in this sector' });

    await client.beginTransaction();
    const spend = await client.query(
      'UPDATE haulonaut_pilots SET credits = credits - $1 WHERE game_user_id = $2 AND credits >= $1',
      [amount, req.params.id]
    );
    if (!spend.affectedRows) {
      await client.rollback();
      return res.status(400).json({ message: 'Not enough tokens' });
    }
    await client.query('UPDATE haulonaut_pilots SET credits = credits + $1 WHERE game_user_id = $2', [amount, toCharacterId]);
    await client.commit();

    const pilotAfter = await client.query('SELECT credits FROM haulonaut_pilots WHERE game_user_id = $1', [req.params.id]);

    if (target.user_id) {
      const targetAfter = await client.query('SELECT credits FROM haulonaut_pilots WHERE game_user_id = $1', [toCharacterId]);
      emitToUser(target.user_id, 'haulonaut_gift_received', {
        fromDisplayName: ownerCheck.rows[0].display_name,
        credits: amount,
        newBalance: targetAfter.rows[0]?.credits
      });
    }

    res.json({ message: `Gave ${amount} Tokens to ${target.display_name}`, credits: pilotAfter.rows[0].credits });
  } catch (err) {
    await client.rollback();
    console.error('Error giving credits:', err);
    res.status(500).json({ message: 'Failed to give credits' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/trade-offers
 * Offers a quantity of one item from this character's own inventory to
 * another active character in the same sector, in exchange for a set
 * amount of credits. Nothing moves yet -- the target has to /accept it
 * (see the route below) before either side's balance changes. Body:
 * { to_character_id, item_key, quantity, credits }.
 */
router.post('/:gameKey/characters/:id/trade-offers', authenticate, async (req, res) => {
  const toCharacterId = parseInt(req.body.to_character_id, 10);
  const itemKey = (req.body.item_key || '').trim();
  const quantity = parseInt(req.body.quantity, 10);
  const credits = parseInt(req.body.credits, 10);
  if (!toCharacterId) return res.status(400).json({ message: 'to_character_id is required' });
  if (!itemKey) return res.status(400).json({ message: 'item_key is required' });
  if (!quantity || quantity <= 0) return res.status(400).json({ message: 'quantity must be a positive number' });
  if (!Number.isInteger(credits) || credits < 0) return res.status(400).json({ message: 'credits must be zero or a positive number' });

  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.display_name FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const target = await loadSameSectorTarget(client, req.params.id, toCharacterId);
    if (!target) return res.status(404).json({ message: 'That pilot is not in this sector' });
    if (target.is_npc) return res.status(400).json({ message: 'NPCs cannot respond to trade offers' });

    const itemResult = await client.query('SELECT id, name FROM haulonaut_items WHERE item_key = $1', [itemKey]);
    if (itemResult.rowCount === 0) return res.status(404).json({ message: 'Item not found' });
    const item = itemResult.rows[0];

    const invResult = await client.query(
      'SELECT quantity FROM haulonaut_pilot_inventory WHERE game_user_id = $1 AND item_id = $2',
      [req.params.id, item.id]
    );
    const owned = invResult.rowCount > 0 ? invResult.rows[0].quantity : 0;
    if (owned < quantity) return res.status(400).json({ message: `You only have ${owned} ${item.name}` });

    const insertResult = await client.query(
      `INSERT INTO haulonaut_trade_offers (from_game_user_id, to_game_user_id, item_id, quantity, credits)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, toCharacterId, item.id, quantity, credits]
    );

    if (target.user_id) {
      emitToUser(target.user_id, 'haulonaut_trade_offer', {
        offerId: insertResult.insertId,
        fromCharacterId: Number(req.params.id),
        fromDisplayName: ownerCheck.rows[0].display_name,
        itemKey,
        itemName: item.name,
        quantity,
        credits
      });
    }

    res.status(201).json({
      message: `Offered ${quantity} ${item.name} to ${target.display_name} for ${credits} Tokens`,
      offerId: insertResult.insertId
    });
  } catch (err) {
    console.error('Error creating trade offer:', err);
    res.status(500).json({ message: 'Failed to create trade offer' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/games/:gameKey/characters/:id/trade-offers
 * Every pending trade offer involving this character, either direction --
 * lets a client that missed the real-time socket notification (was
 * offline, reloaded, ...) catch up on what's waiting for a response.
 */
router.get('/:gameKey/characters/:id/trade-offers', authenticate, async (req, res) => {
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

    const offersResult = await client.query(
      `SELECT o.id, o.from_game_user_id, o.to_game_user_id, o.quantity, o.credits, o.created_at,
              i.item_key, i.name AS item_name,
              fromGu.display_name AS from_display_name, toGu.display_name AS to_display_name
       FROM haulonaut_trade_offers o
       JOIN haulonaut_items i ON i.id = o.item_id
       JOIN game_users fromGu ON fromGu.id = o.from_game_user_id
       JOIN game_users toGu ON toGu.id = o.to_game_user_id
       WHERE o.status = 'pending' AND (o.from_game_user_id = $1 OR o.to_game_user_id = $1)
       ORDER BY o.created_at DESC`,
      [req.params.id]
    );

    res.json({ offers: offersResult.rows });
  } catch (err) {
    console.error('Error loading trade offers:', err);
    res.status(500).json({ message: 'Failed to load trade offers' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/trade-offers/:offerId/accept
 * Completes a pending trade offer -- only the offer's target may accept.
 * Re-validates everything at this moment rather than trusting the state
 * from when the offer was created: the proposer must still be in this
 * sector and still hold enough of the item, and this character must still
 * have enough credits. Either failing declines the offer outright rather
 * than leaving it pending against assumptions that are no longer true.
 */
router.post('/:gameKey/characters/:id/trade-offers/:offerId/accept', authenticate, async (req, res) => {
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
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const offerResult = await client.query(
      `SELECT o.*, i.name AS item_name
       FROM haulonaut_trade_offers o
       JOIN haulonaut_items i ON i.id = o.item_id
       WHERE o.id = $1 AND o.to_game_user_id = $2 AND o.status = 'pending'`,
      [req.params.offerId, req.params.id]
    );
    if (offerResult.rowCount === 0) return res.status(404).json({ message: 'Trade offer not found' });
    const offer = offerResult.rows[0];

    const proposer = await loadSameSectorTarget(client, req.params.id, offer.from_game_user_id);
    if (!proposer) {
      await client.query(`UPDATE haulonaut_trade_offers SET status = 'declined', resolved_at = NOW() WHERE id = $1`, [offer.id]);
      return res.status(409).json({ message: 'They are no longer in this sector' });
    }

    await client.beginTransaction();

    const takeItem = await client.query(
      'UPDATE haulonaut_pilot_inventory SET quantity = quantity - $1 WHERE game_user_id = $2 AND item_id = $3 AND quantity >= $1',
      [offer.quantity, offer.from_game_user_id, offer.item_id]
    );
    if (!takeItem.affectedRows) {
      await client.rollback();
      await client.query(`UPDATE haulonaut_trade_offers SET status = 'declined', resolved_at = NOW() WHERE id = $1`, [offer.id]);
      return res.status(409).json({ message: `They no longer have enough ${offer.item_name}` });
    }

    const takeCredits = await client.query(
      'UPDATE haulonaut_pilots SET credits = credits - $1 WHERE game_user_id = $2 AND credits >= $1',
      [offer.credits, req.params.id]
    );
    if (!takeCredits.affectedRows) {
      await client.rollback();
      return res.status(400).json({ message: 'Not enough tokens' });
    }

    await client.query(
      `INSERT INTO haulonaut_pilot_inventory (game_user_id, item_id, quantity) VALUES ($1, $2, $3)
       ON DUPLICATE KEY UPDATE quantity = quantity + $3`,
      [req.params.id, offer.item_id, offer.quantity]
    );
    await client.query('UPDATE haulonaut_pilots SET credits = credits + $1 WHERE game_user_id = $2', [offer.credits, offer.from_game_user_id]);
    await client.query(`UPDATE haulonaut_trade_offers SET status = 'accepted', resolved_at = NOW() WHERE id = $1`, [offer.id]);

    await client.commit();

    const pilotAfter = await client.query('SELECT credits FROM haulonaut_pilots WHERE game_user_id = $1', [req.params.id]);
    const inventory = await loadInventory(client, req.params.id);

    if (proposer.user_id) {
      const proposerAfter = await client.query('SELECT credits FROM haulonaut_pilots WHERE game_user_id = $1', [offer.from_game_user_id]);
      emitToUser(proposer.user_id, 'haulonaut_trade_resolved', {
        offerId: offer.id,
        accepted: true,
        itemName: offer.item_name,
        quantity: offer.quantity,
        credits: offer.credits,
        newBalance: proposerAfter.rows[0]?.credits
      });
    }

    res.json({
      message: `Trade complete: ${offer.quantity} ${offer.item_name} for ${offer.credits} Tokens`,
      credits: pilotAfter.rows[0].credits,
      inventory
    });
  } catch (err) {
    await client.rollback();
    console.error('Error accepting trade offer:', err);
    res.status(500).json({ message: 'Failed to accept trade offer' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/trade-offers/:offerId/decline
 * Rejects a pending trade offer -- only the offer's target may decline.
 */
router.post('/:gameKey/characters/:id/trade-offers/:offerId/decline', authenticate, async (req, res) => {
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

    const offerResult = await client.query(
      `SELECT o.from_game_user_id, i.name AS item_name, o.quantity, o.credits
       FROM haulonaut_trade_offers o
       JOIN haulonaut_items i ON i.id = o.item_id
       WHERE o.id = $1 AND o.to_game_user_id = $2 AND o.status = 'pending'`,
      [req.params.offerId, req.params.id]
    );
    if (offerResult.rowCount === 0) return res.status(404).json({ message: 'Trade offer not found' });
    const offer = offerResult.rows[0];

    await client.query(`UPDATE haulonaut_trade_offers SET status = 'declined', resolved_at = NOW() WHERE id = $1`, [req.params.offerId]);

    const fromResult = await client.query('SELECT user_id FROM game_users WHERE id = $1', [offer.from_game_user_id]);
    if (fromResult.rows[0]?.user_id) {
      emitToUser(fromResult.rows[0].user_id, 'haulonaut_trade_resolved', {
        offerId: Number(req.params.offerId),
        accepted: false,
        itemName: offer.item_name,
        quantity: offer.quantity,
        credits: offer.credits
      });
    }

    res.json({ message: 'Trade offer declined' });
  } catch (err) {
    console.error('Error declining trade offer:', err);
    res.status(500).json({ message: 'Failed to decline trade offer' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/attack
 * Open PvP -- no consent needed, just a shared sector, an active
 * (non-NPC) target, a mounted weapon, and enough cycles. Deals randomized
 * damage to the target's health and can kill them outright, exactly like a
 * starved warp does (see applyWarpHealth above) -- there's no separate
 * combat-death path. Body: { to_character_id }.
 *
 * Doesn't notify the target directly (no emitToUser here) -- the result is
 * broadcast to the whole sector room instead (haulonaut_combat_event, see
 * utilities/socket.js's haulonaut_join_sector), which reaches the
 * attacker, the target, and any bystanders identically, all already
 * listening there for sector chat. The HTTP response only carries back
 * validation errors; a successful hit's outcome is told to everyone,
 * attacker included, by that one broadcast rather than a duplicated
 * success message.
 */
router.post('/:gameKey/characters/:id/attack', authenticate, async (req, res) => {
  const toCharacterId = parseInt(req.body.to_character_id, 10);
  if (!toCharacterId) return res.status(400).json({ message: 'to_character_id is required' });

  const client = await getClient();
  try {
    const ownerCheck = await client.query(
      `SELECT gu.id, gu.display_name FROM game_users gu
       JOIN game_instances gi ON gi.id = gu.game_instance_id
       JOIN games g ON g.id = gi.game_id
       WHERE gu.id = $1 AND gu.user_id = $2 AND g.game_key = $3`,
      [req.params.id, req.user.id, req.params.gameKey]
    );
    if (ownerCheck.rowCount === 0) return res.status(404).json({ message: 'Character not found' });
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const target = await loadSameSectorTarget(client, req.params.id, toCharacterId);
    if (!target) return res.status(404).json({ message: 'That pilot is not in this sector' });
    if (target.is_npc) return res.status(400).json({ message: 'NPCs cannot be attacked' });

    const weaponResult = await client.query(
      `SELECT hi.quantity FROM haulonaut_pilot_inventory hi
       JOIN haulonaut_items i ON i.id = hi.item_id
       WHERE hi.game_user_id = $1 AND i.item_key = $2`,
      [req.params.id, ATTACK_WEAPON_ITEM_KEY]
    );
    if (!weaponResult.rowCount || weaponResult.rows[0].quantity < 1) {
      return res.status(400).json({ message: 'You need a weapon to attack -- buy a Laser Cannon at a trading outpost.' });
    }

    const pilotResult = await client.query('SELECT current_sector_id FROM haulonaut_pilots WHERE game_user_id = $1', [req.params.id]);
    const sectorId = pilotResult.rows[0].current_sector_id;

    const spent = await spendCycles(client, req.params.id, ATTACK_CYCLE_COST);
    if (!spent.ok) {
      return res.status(409).json({ message: `Not enough cycles to attack (need ${ATTACK_CYCLE_COST})`, cycles: spent.cycles, cyclesUpdatedAt: spent.cyclesUpdatedAt });
    }

    const damage = ATTACK_MIN_DAMAGE + Math.floor(Math.random() * (ATTACK_MAX_DAMAGE - ATTACK_MIN_DAMAGE + 1));
    await client.query('UPDATE haulonaut_pilots SET health = GREATEST(0, health - $1) WHERE game_user_id = $2', [damage, toCharacterId]);
    const healthResult = await client.query('SELECT health FROM haulonaut_pilots WHERE game_user_id = $1', [toCharacterId]);
    const targetHealth = Number(healthResult.rows[0].health);

    let died = false;
    if (targetHealth <= 0) {
      const killUpdate = await client.query(
        "UPDATE game_users SET status = 'dead', died_at = NOW() WHERE id = $1 AND status = 'active'",
        [toCharacterId]
      );
      died = killUpdate.affectedRows > 0;
    }

    const io = getIO();
    if (io) {
      io.to(`haulonaut_sector_${sectorId}`).emit('haulonaut_combat_event', {
        sectorId,
        fromCharacterId: Number(req.params.id),
        fromDisplayName: ownerCheck.rows[0].display_name,
        toCharacterId,
        toDisplayName: target.display_name,
        damage,
        targetHealth,
        died
      });
    }

    res.json({ message: `Hit ${target.display_name} for ${damage} damage.`, damage, targetHealth, died });
  } catch (err) {
    console.error('Error attacking:', err);
    res.status(500).json({ message: 'Failed to attack' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/dock
 * Marks the character as landed at whatever planet is in their current
 * sector -- called the moment the client's landing-sequence animation
 * reaches its 'docked' phase, independent of whether they go on to exit
 * the craft. The planet is derived server-side from current_sector_id
 * (never trusted from the client). Idempotent: landing again while already
 * docked at the same planet just re-confirms it -- and, because it's
 * idempotent, only a landing that actually changes docked_feature_id
 * spends cycles (DOCK_CYCLE_COST -- a big maneuver, same as a warp), so a
 * retried/duplicate call after a network hiccup doesn't double-charge.
 */
router.post('/:gameKey/characters/:id/dock', authenticate, async (req, res) => {
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
    if (!(await isAlive(client, req.params.id))) return res.status(409).json({ message: 'This pilot is lost.' });

    const pilotResult = await client.query(
      'SELECT current_sector_id, docked_feature_id FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0) return res.status(409).json({ message: 'Character has no location' });

    // ORDER BY id LIMIT 1: same deterministic tie-break as
    // loadPilotLocation's featuresResult, for the schema-permitted (but
    // never-yet-generated) case of a sector holding more than one planet.
    const featureResult = await client.query(
      `SELECT id FROM haulonaut_sector_features WHERE sector_id = $1 AND feature_type = 'planet' ORDER BY id LIMIT 1`,
      [pilotResult.rows[0].current_sector_id]
    );
    if (featureResult.rowCount === 0) return res.status(409).json({ message: 'No planet in this sector' });
    const featureId = featureResult.rows[0].id;

    // A genuinely new landing spends DOCK_CYCLE_COST; re-confirming a dock
    // the pilot is already parked at (idempotent retry, or re-boarding then
    // re-landing without launching) spends nothing. The client blocks
    // starting the descent without the cycles to afford it, so hitting the
    // branch below is an edge case -- but it's still enforced, not trusted.
    const alreadyDocked = pilotResult.rows[0].docked_feature_id === featureId;
    let cycleState;
    if (alreadyDocked) {
      cycleState = await replenishCycles(client, req.params.id);
    } else {
      const spent = await spendCycles(client, req.params.id, DOCK_CYCLE_COST);
      if (!spent.ok) {
        return res.status(409).json({ message: `Not enough cycles to land (need ${DOCK_CYCLE_COST})`, cycles: spent.cycles, cyclesUpdatedAt: spent.cyclesUpdatedAt });
      }
      cycleState = spent;
    }

    // on_surface reset to 0 -- a fresh dock always starts back inside the
    // ship; stepping out is a separate, later /exit-craft call.
    await client.query('UPDATE haulonaut_pilots SET docked_feature_id = $1, on_surface = 0 WHERE game_user_id = $2', [featureId, req.params.id]);

    res.json({ dockedFeatureId: featureId, cycles: cycleState.cycles, cyclesUpdatedAt: cycleState.cyclesUpdatedAt });
  } catch (err) {
    console.error('Error docking:', err);
    res.status(500).json({ message: 'Failed to dock' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/launch
 * The undock counterpart to /dock -- clears docked_feature_id (and
 * on_surface, defensively) so the ship shows as back in open space
 * without needing to warp anywhere (see /navigate for the other way this
 * can happen, as a side effect of leaving for a different sector).
 * Requires being back aboard the ship first -- can't launch while the
 * pilot's body is still out on the surface in the buggy.
 */
router.post('/:gameKey/characters/:id/launch', authenticate, async (req, res) => {
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
      'SELECT docked_feature_id, on_surface FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    if (pilotResult.rowCount === 0 || !pilotResult.rows[0].docked_feature_id) {
      return res.status(409).json({ message: 'Not docked at a planet' });
    }
    if (pilotResult.rows[0].on_surface) return res.status(409).json({ message: 'Return to ship before launching' });

    await client.query('UPDATE haulonaut_pilots SET docked_feature_id = NULL, on_surface = 0 WHERE game_user_id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error launching:', err);
    res.status(500).json({ message: 'Failed to launch' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/exit-craft
 * Steps out of an already-docked ship onto its planet's surface (see POST
 * /dock, which must have already run) -- sets on_surface and returns that
 * planet's surface-map state, creating it (see createSurfaceMap) on a
 * character's first-ever visit to this particular planet.
 */
router.post('/:gameKey/characters/:id/exit-craft', authenticate, async (req, res) => {
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
      'SELECT docked_feature_id FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    const featureId = pilotResult.rowCount > 0 ? pilotResult.rows[0].docked_feature_id : null;
    if (!featureId) return res.status(409).json({ message: 'Not docked at a planet' });

    await client.query('UPDATE haulonaut_pilots SET on_surface = 1 WHERE game_user_id = $1', [req.params.id]);

    const existingMap = await client.query(
      'SELECT 1 FROM haulonaut_surface_maps WHERE game_user_id = $1 AND feature_id = $2',
      [req.params.id, featureId]
    );
    const surfaceMap = existingMap.rowCount > 0
      ? (await loadSurfaceState(client, req.params.id)).surfaceMap
      : await createSurfaceMap(client, req.params.id, featureId);

    // Stepping out of the ship costs nothing -- only buggy moves onto new
    // cells do (see /drive-buggy). Returned so the surface HUD opens with a
    // current cycle count.
    const { cycles, cyclesUpdatedAt } = await replenishCycles(client, req.params.id);

    res.json({ dockedFeatureId: featureId, surfaceMap, cycles, cyclesUpdatedAt });
  } catch (err) {
    console.error('Error exiting craft:', err);
    res.status(500).json({ message: 'Failed to exit craft' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/return-to-ship
 * Clears on_surface back to 0 -- docked_feature_id is left alone, since
 * boarding the ship doesn't undock it (see /navigate for the only thing
 * that does). The surface map itself (haulonaut_surface_maps) is also left
 * untouched so it's exactly as explored whenever the surface is visited
 * again. Only allowed once the buggy has actually been driven back to the
 * ship's own cell -- re-checked server-side, since the client only shows
 * this action once it's already true.
 */
router.post('/:gameKey/characters/:id/return-to-ship', authenticate, async (req, res) => {
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
      'SELECT docked_feature_id, on_surface FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    const featureId = pilotResult.rowCount > 0 && pilotResult.rows[0].on_surface ? pilotResult.rows[0].docked_feature_id : null;
    if (!featureId) return res.status(409).json({ message: 'Not on a planet surface' });

    const mapResult = await client.query(
      'SELECT ship_x, ship_y, buggy_x, buggy_y FROM haulonaut_surface_maps WHERE game_user_id = $1 AND feature_id = $2',
      [req.params.id, featureId]
    );
    const map = mapResult.rows[0];
    if (!map || map.buggy_x !== map.ship_x || map.buggy_y !== map.ship_y) {
      return res.status(409).json({ message: 'Drive the buggy back to the ship first' });
    }

    await client.query('UPDATE haulonaut_pilots SET on_surface = 0 WHERE game_user_id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Error returning to ship:', err);
    res.status(500).json({ message: 'Failed to return to ship' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/games/:gameKey/characters/:id/drive-buggy
 * Moves the buggy one cell across the current planet's surface map. Body:
 * { direction: 'up'|'down'|'left'|'right' }. Bumping into the grid's edge
 * is a silent no-op (200, unchanged position), not an error -- low-friction
 * input handling, nothing to punish here.
 *
 * The first time the buggy actually reaches a given cell (tracked by
 * visited_cells, distinct from revealed_cells' wider fog-of-war sight
 * radius), this rolls one narrated landing event -- see
 * utilities/haulonautLandingEvents.js -- the same mechanic the old manual
 * "Explore Surface" button used to trigger, now automatic on arrival
 * instead. Re-visiting an already-visited cell rolls nothing.
 *
 * Every move that actually changes the buggy's cell spends one cycle
 * (whether or not the destination is new). A move that only bumps the grid
 * edge changes nothing and stays a free 200 no-op -- including when the
 * pilot is out of cycles.
 */
router.post('/:gameKey/characters/:id/drive-buggy', authenticate, async (req, res) => {
  const direction = req.body.direction;
  if (!SURFACE_MAP_DIRECTIONS[direction]) return res.status(400).json({ message: 'Invalid direction' });

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
      'SELECT docked_feature_id, on_surface FROM haulonaut_pilots WHERE game_user_id = $1',
      [req.params.id]
    );
    const featureId = pilotResult.rowCount > 0 && pilotResult.rows[0].on_surface ? pilotResult.rows[0].docked_feature_id : null;
    if (!featureId) return res.status(409).json({ message: 'Not on a planet surface' });

    let mapResult = await client.query(
      'SELECT grid_width, grid_height, ship_x, ship_y, buggy_x, buggy_y, revealed_cells, visited_cells FROM haulonaut_surface_maps WHERE game_user_id = $1 AND feature_id = $2',
      [req.params.id, featureId]
    );
    if (mapResult.rowCount === 0) {
      // Shouldn't happen via normal flow (exit-craft always creates this
      // row first) -- self-heal the same way loadSurfaceState does rather
      // than 409ing on a state the player can't fix themselves.
      await createSurfaceMap(client, req.params.id, featureId);
      mapResult = await client.query(
        'SELECT grid_width, grid_height, ship_x, ship_y, buggy_x, buggy_y, revealed_cells, visited_cells FROM haulonaut_surface_maps WHERE game_user_id = $1 AND feature_id = $2',
        [req.params.id, featureId]
      );
    }
    const row = mapResult.rows[0];

    const [dx, dy] = SURFACE_MAP_DIRECTIONS[direction];
    const newX = Math.min(Math.max(row.buggy_x + dx, 0), row.grid_width - 1);
    const newY = Math.min(Math.max(row.buggy_y + dy, 0), row.grid_height - 1);
    const moved = newX !== row.buggy_x || newY !== row.buggy_y;

    // A real move costs a cycle; a grid-edge bump (moved === false) is left
    // as a free no-op below. Spent up front so nothing else is written on a
    // move the pilot can't afford.
    let cycleState;
    if (moved) {
      const spent = await spendCycles(client, req.params.id, BUGGY_CYCLE_COST);
      if (!spent.ok) {
        return res.status(409).json({ message: 'Out of cycles -- wait for replenishment', cycles: spent.cycles, cyclesUpdatedAt: spent.cyclesUpdatedAt });
      }
      cycleState = spent;
    } else {
      cycleState = await replenishCycles(client, req.params.id);
    }

    const revealed = revealAround(JSON.parse(row.revealed_cells), newX, newY, row.grid_width, row.grid_height, SURFACE_MAP_REVEAL_RADIUS);

    const visitedIndices = JSON.parse(row.visited_cells);
    const newIndex = newY * row.grid_width + newX;
    const isNewArea = !visitedIndices.includes(newIndex);
    let narration = null;
    let effects = null;
    let pilotAfter = null;

    if (isNewArea) {
      visitedIndices.push(newIndex);
      ({ narration, effects } = rollLandingEvent());
      await client.query(
        `UPDATE haulonaut_pilots
         SET credits = GREATEST(0, credits + $1),
             rations = GREATEST(0, rations + $2),
             fuel = GREATEST(0, fuel + $3)
         WHERE game_user_id = $4`,
        [effects.credits || 0, effects.rations || 0, effects.fuel || 0, req.params.id]
      );
      const pilotResultAfter = await client.query(
        'SELECT credits, rations, fuel FROM haulonaut_pilots WHERE game_user_id = $1',
        [req.params.id]
      );
      pilotAfter = pilotResultAfter.rows[0];
    }

    await client.query(
      'UPDATE haulonaut_surface_maps SET buggy_x = $1, buggy_y = $2, revealed_cells = $3, visited_cells = $4 WHERE game_user_id = $5 AND feature_id = $6',
      [newX, newY, JSON.stringify(revealed), JSON.stringify(visitedIndices), req.params.id, featureId]
    );

    res.json({
      buggyX: newX,
      buggyY: newY,
      revealed,
      atShip: newX === row.ship_x && newY === row.ship_y,
      narration,
      effects,
      cycles: cycleState.cycles,
      cyclesUpdatedAt: cycleState.cyclesUpdatedAt,
      ...(pilotAfter || {})
    });
  } catch (err) {
    console.error('Error driving buggy:', err);
    res.status(500).json({ message: 'Failed to drive buggy' });
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
 * GET /api/games/:gameKey/characters/:id/cycles
 * The pilot's current cycle balance after time-based replenishment, plus
 * the accrual anchor (cyclesUpdatedAt, epoch seconds) the client's own
 * countdown runs off. Read-only apart from the replenishment write
 * replenishCycles does. The client polls this on a slow timer / on tab
 * refocus to stay in sync with wall-clock replenishment without needing a
 * full character reload; every action endpoint already returns the same
 * two fields.
 */
router.get('/:gameKey/characters/:id/cycles', authenticate, async (req, res) => {
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

    const { cycles, cyclesUpdatedAt } = await replenishCycles(client, req.params.id);
    res.json({ cycles, cyclesUpdatedAt, maxCycles: MAX_CYCLES, replenishSeconds: CYCLE_REPLENISH_SECONDS });
  } catch (err) {
    console.error('Error loading cycles:', err);
    res.status(500).json({ message: 'Failed to load cycles' });
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
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id AND gu.is_npc = 0) AS player_count,
              (SELECT COUNT(*) FROM game_users gu WHERE gu.game_instance_id = gi.id AND gu.is_npc = 1) AS npc_count
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
      `SELECT gu.id, gu.display_name, gu.status, gu.created_at, gu.last_played_at, gu.is_npc, u.handle AS owner_handle
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
 * POST /api/games/:gameKey/admin/instances/:instanceId/npcs
 * Game-admin only: spawn `count` NPC pilots into an active instance. Each
 * is an ordinary game_users row (user_id/visitor_id both NULL, is_npc = 1)
 * with a normal haulonaut_pilots row at a random sector -- same starting
 * credits/rations/fuel/health/cycles as a freshly created human character.
 * jobs/haulonautNpcScheduler.js is what actually moves them from there;
 * this endpoint only creates the roster entries. Body: { count } -- default
 * 1, clamped to 1-50 per call so a fat-fingered number can't flood a
 * universe in one request.
 */
router.post('/:gameKey/admin/instances/:instanceId/npcs', authenticate, requireGameAdmin, async (req, res) => {
  const count = Math.min(50, Math.max(1, parseInt(req.body.count, 10) || 1));
  const client = await getClient();
  try {
    const instanceResult = await client.query(
      `SELECT id FROM game_instances WHERE id = $1 AND game_id = $2 AND status = 'active'`,
      [req.params.instanceId, req.gameId]
    );
    if (instanceResult.rowCount === 0) return res.status(404).json({ message: 'Active instance not found' });

    const created = [];
    for (let i = 0; i < count; i++) {
      const displayName = randomNpcName();
      const insertResult = await client.query(
        `INSERT INTO game_users (game_instance_id, display_name, status, is_npc) VALUES ($1, $2, 'active', 1)`,
        [req.params.instanceId, displayName]
      );
      const spawned = await spawnPilotAtRandomSector(client, insertResult.insertId);
      if (spawned) created.push({ id: insertResult.insertId, display_name: displayName });
    }

    res.status(201).json({ created });
  } catch (err) {
    console.error('Error spawning NPCs:', err);
    res.status(500).json({ message: 'Failed to spawn NPCs' });
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

// Exposed for jobs/haulonautNpcScheduler.js -- NPC movement reuses the same
// warp/cycles/fuel/rations/health rules real players are bound by, rather
// than a second copy of them, so tuning the economy in one place (see the
// constants block up top) stays authoritative for bots too.
module.exports.internals = {
  replenishCycles,
  spendCycles,
  applyWarpHealth,
  markSectorVisited,
  WARP_CYCLE_COST,
  WARP_FUEL_COST,
  WARP_RATIONS_COST
};
