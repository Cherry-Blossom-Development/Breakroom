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
  MAGNET_RANDOM_TURNS,
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

// "Magnet" NPCs (is_magnet, see migrations 072/073 and the admin NPC-spawn
// route's `magnet` flag) run a two-phase state machine, tracked by
// magnet_homing:
//   - wandering (magnet_homing = false): a normal random walk, same as any
//     other NPC, but counted -- MAGNET_RANDOM_TURNS successful random hops
//     flips it into homing.
//   - homing (magnet_homing = true): every turn it re-resolves its target's
//     CURRENT sector (they may have moved) and takes one shortest-path hop
//     toward it -- an actual beeline, not a periodic pull -- until it lands
//     in the same sector, at which point it stops, sits still for that tick,
//     and drops back into a fresh wander phase.
//
// resolveMagnetHop reports which of those applies this tick:
//   { status: 'hop', sectorId } -- take this hop, still homing
//   { status: 'arrived' }       -- already in the target's sector
//   { status: 'no-target' }     -- target unresolvable (dead/gone) or unreachable
// Same shortest-path-then-take-the-first-step reconstruction /drift uses in
// routes/games.js.
async function resolveMagnetHop(client, npc) {
  if (!npc.magnet_target_game_user_id) return { status: 'no-target' };

  const targetResult = await client.query(
    `SELECT hp.current_sector_id FROM haulonaut_pilots hp
     JOIN game_users gu ON gu.id = hp.game_user_id
     WHERE gu.id = $1 AND gu.status = 'active'`,
    [npc.magnet_target_game_user_id]
  );
  if (targetResult.rowCount === 0) return { status: 'no-target' }; // target's character is gone/dead

  const targetSectorId = targetResult.rows[0].current_sector_id;
  if (targetSectorId === npc.current_sector_id) return { status: 'arrived' };

  const distances = await computeSectorDistances(client, npc.game_instance_id, npc.current_sector_id);
  const targetInfo = distances.get(targetSectorId);
  if (!targetInfo) return { status: 'no-target' }; // unreachable in this instance's graph

  const pathIds = [];
  for (let step = targetSectorId; step !== null; step = distances.get(step).prevSectorId) {
    pathIds.unshift(step);
  }
  const nextHop = pathIds.length > 1 ? pathIds[1] : null;
  return nextHop ? { status: 'hop', sectorId: nextHop } : { status: 'arrived' };
}

// One NPC's turn: restock if low and standing somewhere tradeable,
// otherwise warp -- beelining toward its magnet target while homing, else to
// a random sector linked from wherever it already is. Silently no-ops (no
// action this tick) if it's out of cycles, out of fuel with nowhere to
// restock, or docked/on the surface -- NPCs don't land or drive the buggy in
// this first pass, they only crew the ship.
async function tickNpc(client, npc) {
  if (npc.on_surface || npc.docked_feature_id) return;

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

  // Whether THIS tick's hop, if it ends up being a plain random one, should
  // count toward the wander-phase threshold -- true only when the NPC
  // started this tick already wandering (not homing, and not a transition
  // hop right after dropping out of homing below).
  const countsAsWander = npc.is_magnet && !npc.magnet_homing;

  let toSectorId = null;
  if (npc.is_magnet && npc.magnet_homing) {
    const result = await resolveMagnetHop(client, npc);
    if (result.status === 'hop') {
      toSectorId = result.sectorId;
    } else {
      // Arrived, or nothing left to home toward -- drop out of homing and
      // start a fresh wander phase either way.
      await client.query(
        'UPDATE haulonaut_pilots SET magnet_homing = FALSE, magnet_turns_remaining = $1 WHERE game_user_id = $2',
        [MAGNET_RANDOM_TURNS, npc.game_user_id]
      );
      // On 'arrived' specifically, take NO action this tick -- it's exactly
      // where it needs to be; let it actually sit there for a moment rather
      // than immediately wandering off again in the same breath. 'no-target'
      // falls through to a normal random hop below (uncounted -- the fresh
      // wander phase starts counting from the NEXT tick).
      if (result.status === 'arrived') return;
    }
  }

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

  // A genuine wander-phase hop counts toward MAGNET_RANDOM_TURNS -- once it
  // reaches 0, the NEXT tick commits to homing (checked at the top). Homing
  // hops and the post-homing transition hop are deliberately excluded (see
  // countsAsWander above).
  if (countsAsWander) {
    const turnsRemaining = (npc.magnet_turns_remaining ?? MAGNET_RANDOM_TURNS) - 1;
    if (turnsRemaining <= 0) {
      await client.query('UPDATE haulonaut_pilots SET magnet_homing = TRUE, magnet_turns_remaining = 0 WHERE game_user_id = $1', [npc.game_user_id]);
    } else {
      await client.query('UPDATE haulonaut_pilots SET magnet_turns_remaining = $1 WHERE game_user_id = $2', [turnsRemaining, npc.game_user_id]);
    }
  }

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
              hp.is_magnet, hp.magnet_target_game_user_id, hp.magnet_turns_remaining, hp.magnet_homing
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
