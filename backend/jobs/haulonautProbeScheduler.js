// Resolves deployed Haulonaut probes (see migration 074,
// haulonaut_probe_missions and the /probes routes in routes/games.js).
// Runs on its own 5-minute interval matching haulonautNpcScheduler.js's
// cadence (not the same setInterval -- probes and NPCs are independent
// concerns, this just reuses the same tick length) so a mission's
// ticksToComplete (rolled at deploy time) reads in minutes the same way
// NPC turns do.
//
// Each tick just increments ticks_elapsed for every still-active mission,
// then resolves whichever ones just reached ticks_to_complete: 'explore'
// and 'search' both pick the nearest sector (BFS hop count from the
// mission's origin_sector_id) matching what they're after that this pilot
// hasn't already visited, and mark it visited (so it shows up in Star
// Charts same as if the pilot had flown there); 'traders' looks for the
// nearest other active human pilot in the same universe. Any of the three
// can come back empty (the whole reachable map already charted, nobody
// else playing, etc.) -- that's a 'failed' mission, not an error, with its
// own narrated result_summary.
const { getClient } = require('../utilities/db');
const { emitToUser } = require('../utilities/socket');
const { computeSectorDistances, markSectorVisited } = require('../routes/games').internals;

const TICK_MS = 5 * 60 * 1000;

const FEATURE_LABELS = { planet: 'Planet', trading_outpost: 'Trading Outpost' };

async function resolveExplore(client, mission) {
  const distances = await computeSectorDistances(client, mission.game_instance_id, mission.origin_sector_id);
  const visitedResult = await client.query(
    'SELECT sector_id FROM haulonaut_visited_sectors WHERE game_user_id = $1',
    [mission.game_user_id]
  );
  const visited = new Set(visitedResult.rows.map(r => r.sector_id));

  const candidates = [...distances.entries()]
    .filter(([sectorId]) => !visited.has(sectorId))
    .sort((a, b) => a[1].distance - b[1].distance);

  if (candidates.length === 0) {
    return { status: 'failed', resultSectorId: null, summary: "The probe searched every reachable sector and found nothing you haven't already charted." };
  }

  const [sectorId] = candidates[0];
  await markSectorVisited(client, mission.game_user_id, sectorId);

  const sectorResult = await client.query('SELECT sector_number FROM haulonaut_sectors WHERE id = $1', [sectorId]);
  const featuresResult = await client.query('SELECT feature_type, name FROM haulonaut_sector_features WHERE sector_id = $1', [sectorId]);
  const featureText = featuresResult.rows.length > 0
    ? ` It found: ${featuresResult.rows.map(f => `${f.name} (${FEATURE_LABELS[f.feature_type] || f.feature_type})`).join(', ')}.`
    : '';

  return {
    status: 'completed',
    resultSectorId: sectorId,
    summary: `Probe charted sector ${sectorResult.rows[0].sector_number}.${featureText} Added to your Star Charts.`
  };
}

async function resolveSearch(client, mission) {
  const itemResult = await client.query('SELECT item_key, name FROM haulonaut_items WHERE id = $1', [mission.search_item_id]);
  const item = itemResult.rows[0];
  if (!item) return { status: 'failed', resultSectorId: null, summary: 'The probe lost track of what it was looking for.' };

  const distances = await computeSectorDistances(client, mission.game_instance_id, mission.origin_sector_id);
  const visitedResult = await client.query(
    'SELECT sector_id FROM haulonaut_visited_sectors WHERE game_user_id = $1',
    [mission.game_user_id]
  );
  const visited = new Set(visitedResult.rows.map(r => r.sector_id));

  const featuresResult = await client.query(
    `SELECT sector_id, feature_type, name, sells_probe FROM haulonaut_sector_features
     WHERE feature_type IN ('trading_outpost', 'planet')`
  );

  // Every trading_outpost/planet sells the full global catalog (see
  // migration 060) except probes, which are restricted to sells_probe
  // features (migration 074) -- so searching for a probe filters by that
  // flag, and searching for anything else just needs an unvisited market.
  let best = null;
  for (const f of featuresResult.rows) {
    if (visited.has(f.sector_id)) continue;
    if (item.item_key === 'probe' && !f.sells_probe) continue;
    const info = distances.get(f.sector_id);
    if (!info) continue;
    if (!best || info.distance < best.distance) best = { sectorId: f.sector_id, distance: info.distance, feature: f };
  }

  if (!best) {
    return { status: 'failed', resultSectorId: null, summary: `The probe couldn't locate anywhere new selling ${item.name}.` };
  }

  await markSectorVisited(client, mission.game_user_id, best.sectorId);
  const sectorResult = await client.query('SELECT sector_number FROM haulonaut_sectors WHERE id = $1', [best.sectorId]);

  return {
    status: 'completed',
    resultSectorId: best.sectorId,
    summary: `Probe located ${best.feature.name} in sector ${sectorResult.rows[0].sector_number} (${best.distance} hop${best.distance === 1 ? '' : 's'} away), stocking ${item.name}. Added to your Star Charts.`
  };
}

async function resolveTraders(client, mission) {
  const distances = await computeSectorDistances(client, mission.game_instance_id, mission.origin_sector_id);

  const tradersResult = await client.query(
    `SELECT gu.id, gu.display_name, hp.current_sector_id
     FROM game_users gu
     JOIN haulonaut_pilots hp ON hp.game_user_id = gu.id
     WHERE gu.game_instance_id = $1 AND gu.is_npc = 0 AND gu.status = 'active' AND gu.id != $2`,
    [mission.game_instance_id, mission.game_user_id]
  );

  let best = null;
  for (const trader of tradersResult.rows) {
    const info = distances.get(trader.current_sector_id);
    if (!info) continue;
    if (!best || info.distance < best.distance) best = { trader, distance: info.distance };
  }

  if (!best) {
    return { status: 'failed', resultSectorId: null, summary: 'The probe detected no other traders in range.' };
  }

  const sectorResult = await client.query('SELECT sector_number FROM haulonaut_sectors WHERE id = $1', [best.trader.current_sector_id]);
  return {
    status: 'completed',
    resultSectorId: best.trader.current_sector_id,
    summary: `Probe detected ${best.trader.display_name} operating out of sector ${sectorResult.rows[0].sector_number} (${best.distance} hop${best.distance === 1 ? '' : 's'} away at time of contact).`
  };
}

async function resolveMission(client, mission) {
  if (mission.mission_type === 'explore') return resolveExplore(client, mission);
  if (mission.mission_type === 'search') return resolveSearch(client, mission);
  return resolveTraders(client, mission);
}

async function tickMission(client, mission) {
  const ticksElapsed = mission.ticks_elapsed + 1;
  if (ticksElapsed < mission.ticks_to_complete) {
    await client.query('UPDATE haulonaut_probe_missions SET ticks_elapsed = $1 WHERE id = $2', [ticksElapsed, mission.id]);
    return;
  }

  const resolution = await resolveMission(client, mission);
  await client.query(
    `UPDATE haulonaut_probe_missions
     SET ticks_elapsed = $1, status = $2, result_sector_id = $3, result_summary = $4, completed_at = NOW()
     WHERE id = $5`,
    [ticksElapsed, resolution.status, resolution.resultSectorId, resolution.summary, mission.id]
  );

  // Live push for whoever's online right now; GET /probes covers the
  // offline case the same way haulonaut_trade_offers already does for
  // trade offers -- the row itself is the catch-up mechanism.
  if (mission.user_id) {
    emitToUser(mission.user_id, 'haulonaut_probe_report', {
      missionId: mission.id,
      missionType: mission.mission_type,
      status: resolution.status,
      summary: resolution.summary
    });
  }
}

async function tick() {
  const client = await getClient();
  try {
    const missionsResult = await client.query(
      `SELECT m.id, m.game_user_id, m.mission_type, m.search_item_id, m.origin_sector_id,
              m.ticks_elapsed, m.ticks_to_complete,
              gu.game_instance_id, gu.user_id
       FROM haulonaut_probe_missions m
       JOIN game_users gu ON gu.id = m.game_user_id
       WHERE m.status = 'active'`
    );

    for (const mission of missionsResult.rows) {
      try {
        await tickMission(client, mission);
      } catch (err) {
        console.error(`[HaulonautProbe] Error ticking mission ${mission.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[HaulonautProbe] Tick error:', err);
  } finally {
    client.release();
  }
}

function startHaulonautProbeScheduler() {
  console.log('[HaulonautProbe] Started (5 min interval)');
  tick().catch(err => console.error('[HaulonautProbe] Initial tick error:', err));
  setInterval(() => {
    tick().catch(err => console.error('[HaulonautProbe] Tick error:', err));
  }, TICK_MS);
}

module.exports = { startHaulonautProbeScheduler };
