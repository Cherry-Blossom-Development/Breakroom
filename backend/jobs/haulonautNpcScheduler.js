// Drives every Haulonaut NPC pilot's movement -- system-controlled
// game_users rows (is_npc = 1, see migration 069) that are otherwise
// ordinary characters: same haulonaut_pilots row, same cycles/fuel/rations/
// health rules a human warp obeys (reused from routes/games.js's exported
// `internals` rather than re-implemented here). Each tick gives every
// active NPC one shot at one action, so a bot can't out-travel the cycle
// economy a human is bound by.
const { getClient } = require('../utilities/db');
const {
  replenishCycles,
  spendCycles,
  applyWarpHealth,
  markSectorVisited,
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

// One NPC's turn: restock if low and standing somewhere tradeable,
// otherwise warp to a random sector linked from wherever it already is.
// Silently no-ops (no action this tick) if it's out of cycles, out of fuel
// with nowhere to restock, or docked/on the surface -- NPCs don't land or
// drive the buggy in this first pass, they only crew the ship.
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

  const linkResult = await client.query(
    'SELECT to_sector_id FROM haulonaut_sector_links WHERE from_sector_id = $1 ORDER BY RAND() LIMIT 1',
    [npc.current_sector_id]
  );
  if (linkResult.rowCount === 0) return;
  const toSectorId = linkResult.rows[0].to_sector_id;

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
  await applyWarpHealth(client, npc.game_user_id, hadRations);
}

async function tick() {
  const client = await getClient();
  try {
    const npcsResult = await client.query(
      `SELECT gu.id AS game_user_id, hp.current_sector_id, hp.fuel, hp.rations, hp.credits,
              hp.on_surface, hp.docked_feature_id
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
