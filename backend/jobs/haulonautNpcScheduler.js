// Drives every Haulonaut NPC pilot's movement -- system-controlled
// game_users rows (is_npc = 1, see migration 069) that are otherwise
// ordinary characters: same haulonaut_pilots row, same cycles/fuel/rations/
// health rules a human warp obeys (reused from routes/games.js's exported
// `internals` rather than re-implemented here). Each tick gives every
// active NPC one shot at one action, so a bot can't out-travel the cycle
// economy a human is bound by.
const { getClient } = require('../utilities/db');
const { emitHaulonautSectorArrival } = require('../utilities/socket');
const {
  replenishCycles,
  spendCycles,
  applyWarpHealth,
  markSectorVisited,
  computeSectorDistances,
  randomMagnetTurns,
  WARP_CYCLE_COST,
  WARP_FUEL_COST,
  WARP_RATIONS_COST
} = require('../routes/games').internals;

const TICK_MS = 5 * 60 * 1000; // one action opportunity per NPC every 5 minutes

// Restock threshold/quantity for an NPC sitting at a trading_outpost or
// planet -- keeps a bot from permanently stranding itself the first time
// fuel or rations run low, mirroring what a human player would do at a
// market rather than giving NPCs a separate economy.
const RESTOCK_THRESHOLD = 20;
const RESTOCK_QUANTITY = 20;

// "Magnet" NPCs (is_magnet, see migration 072 and the admin NPC-spawn
// route's `magnet` flag): every ~5 turns (magnet_turns_remaining, reseeded
// via randomMagnetTurns on each pull) they abandon the random walk for one
// hop toward their tracked pilot's CURRENT sector instead -- re-resolved
// fresh on every pull, since the target may have moved since the last one.
// Returns the next sector to warp to, or null if there's nothing to pull
// toward this tick (no target, target unresolvable/gone, already arrived,
// or unreachable) -- the caller falls back to the normal random walk.
// Same shortest-path-then-take-the-first-step reconstruction /drift uses in
// routes/games.js.
async function resolveMagnetHop(client, npc) {
  if (!npc.magnet_target_game_user_id) return null;

  const targetResult = await client.query(
    `SELECT hp.current_sector_id FROM haulonaut_pilots hp
     JOIN game_users gu ON gu.id = hp.game_user_id
     WHERE gu.id = $1 AND gu.status = 'active'`,
    [npc.magnet_target_game_user_id]
  );
  if (targetResult.rowCount === 0) return null; // target's character is gone/dead -- nothing to home toward

  const targetSectorId = targetResult.rows[0].current_sector_id;
  if (targetSectorId === npc.current_sector_id) return null; // already caught up

  const distances = await computeSectorDistances(client, npc.game_instance_id, npc.current_sector_id);
  const targetInfo = distances.get(targetSectorId);
  if (!targetInfo) return null; // unreachable in this instance's graph

  const pathIds = [];
  for (let step = targetSectorId; step !== null; step = distances.get(step).prevSectorId) {
    pathIds.unshift(step);
  }
  return pathIds.length > 1 ? pathIds[1] : null;
}

// One NPC's turn: restock if low and standing somewhere tradeable,
// otherwise warp -- toward its magnet target if one is due and resolvable,
// else to a random sector linked from wherever it already is. Silently
// no-ops (no action this tick) if it's out of cycles, out of fuel with
// nowhere to restock, or docked/on the surface -- NPCs don't land or drive
// the buggy in this first pass, they only crew the ship.
async function tickNpc(client, npc) {
  if (npc.on_surface || npc.docked_feature_id) return;

  // Magnet countdown ticks down on every turn this NPC is even eligible to
  // act (not gated on whether it actually ends up moving this tick), so a
  // stretch of restocks or a cycle-starved lull still counts toward the
  // next pull. Resolved before the cycles/restock checks below since it
  // only affects WHICH sector a warp heads to, not whether one happens.
  let magnetHopTarget = null;
  if (npc.is_magnet) {
    const turnsRemaining = (npc.magnet_turns_remaining ?? 1) - 1;
    if (turnsRemaining <= 0) {
      magnetHopTarget = await resolveMagnetHop(client, npc);
      await client.query(
        'UPDATE haulonaut_pilots SET magnet_turns_remaining = $1 WHERE game_user_id = $2',
        [randomMagnetTurns(), npc.game_user_id]
      );
    } else {
      await client.query(
        'UPDATE haulonaut_pilots SET magnet_turns_remaining = $1 WHERE game_user_id = $2',
        [turnsRemaining, npc.game_user_id]
      );
    }
  }

  const { cycles } = await replenishCycles(client, npc.game_user_id);
  if (cycles < WARP_CYCLE_COST) return;

  const tradeCheck = await client.query(
    `SELECT 1 FROM haulonaut_sector_features WHERE sector_id = $1 AND feature_type IN ('trading_outpost', 'planet')`,
    [npc.current_sector_id]
  );

  if (tradeCheck.rowCount > 0 && (npc.fuel < RESTOCK_THRESHOLD || npc.rations < RESTOCK_THRESHOLD)) {
    const lowKey = npc.fuel <= npc.rations ? 'fuel' : 'rations';
    const itemResult = await client.query('SELECT base_price FROM haulonaut_items WHERE item_key = $1', [lowKey]);
    if (itemResult.rowCount > 0) {
      const cost = itemResult.rows[0].base_price * RESTOCK_QUANTITY;
      if (npc.credits >= cost) {
        await client.query(
          `UPDATE haulonaut_pilots SET credits = credits - $1, ${lowKey} = ${lowKey} + $2 WHERE game_user_id = $3`,
          [cost, RESTOCK_QUANTITY, npc.game_user_id]
        );
        return; // restocking is this tick's action -- travel resumes next tick
      }
    }
  }

  if (npc.fuel < WARP_FUEL_COST) return; // stranded until restocked (or an admin tops it up)

  let toSectorId = magnetHopTarget;
  if (!toSectorId) {
    const linkResult = await client.query(
      'SELECT to_sector_id FROM haulonaut_sector_links WHERE from_sector_id = $1 ORDER BY RAND() LIMIT 1',
      [npc.current_sector_id]
    );
    if (linkResult.rowCount === 0) return;
    toSectorId = linkResult.rows[0].to_sector_id;
  }

  const spent = await spendCycles(client, npc.game_user_id, WARP_CYCLE_COST);
  if (!spent.ok) return;

  const hadRations = npc.rations >= WARP_RATIONS_COST;
  await client.query(
    `UPDATE haulonaut_pilots
     SET current_sector_id = $1, rations = GREATEST(0, rations - $2), fuel = GREATEST(0, fuel - $3)
     WHERE game_user_id = $4`,
    [toSectorId, WARP_RATIONS_COST, WARP_FUEL_COST, npc.game_user_id]
  );
  await markSectorVisited(client, npc.game_user_id, toSectorId);
  await client.query('UPDATE game_users SET last_played_at = NOW() WHERE id = $1', [npc.game_user_id]);
  const { died } = await applyWarpHealth(client, npc.game_user_id, hadRations);
  // Same broadcast /navigate and /drift send for human movement -- lets
  // anyone already sitting in toSectorId see the NPC show up live. Skipped
  // if this very warp starved the NPC to death -- it's not a live arrival,
  // and a client would otherwise add a phantom entry to playersHere for a
  // character that no longer shows up in any sector scan.
  if (!died) {
    emitHaulonautSectorArrival(toSectorId, { id: npc.game_user_id, display_name: npc.display_name, is_npc: true });
  }
}

async function tick() {
  const client = await getClient();
  try {
    const npcsResult = await client.query(
      `SELECT gu.id AS game_user_id, gu.display_name, gu.game_instance_id,
              hp.current_sector_id, hp.fuel, hp.rations, hp.credits,
              hp.on_surface, hp.docked_feature_id,
              hp.is_magnet, hp.magnet_target_game_user_id, hp.magnet_turns_remaining
       FROM game_users gu
       JOIN haulonaut_pilots hp ON hp.game_user_id = gu.id
       WHERE gu.is_npc = 1 AND gu.status = 'active'`
    );

    for (const npc of npcsResult.rows) {
      try {
        await tickNpc(client, npc);
      } catch (err) {
        console.error(`[HaulonautNPC] Error ticking NPC ${npc.game_user_id}:`, err);
      }
    }
  } catch (err) {
    console.error('[HaulonautNPC] Tick error:', err);
  } finally {
    client.release();
  }
}

function startHaulonautNpcScheduler() {
  console.log('[HaulonautNPC] Started (5 min interval)');
  tick().catch(err => console.error('[HaulonautNPC] Initial tick error:', err));
  setInterval(() => {
    tick().catch(err => console.error('[HaulonautNPC] Tick error:', err));
  }, TICK_MS);
}

module.exports = { startHaulonautNpcScheduler };
