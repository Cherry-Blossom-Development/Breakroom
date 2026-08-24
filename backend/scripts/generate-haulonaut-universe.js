// Generates a new Haulonaut universe: creates a game_instances row, then
// procedurally builds N sectors where every sector has between minLinks and
// maxLinks connections to other sectors, with the whole map guaranteed
// reachable from any sector (no isolated pockets).
//
// Usage:
//   node generate-haulonaut-universe.js [--name "Universe Name"] [--sectors 1000]
//     [--min-links 1] [--max-links 6] [--avg-degree 3.5]
//
// Algorithm:
//   1. Build a random spanning tree over all sectors (a random permutation,
//      each sector after the first attaches to a random already-connected
//      sector), never letting any sector exceed maxLinks connections. This
//      guarantees the whole map is reachable from any sector using the
//      minimum possible number of edges, and gives every sector at least 1
//      connection.
//   2. Add random extra edges on top -- sampled uniformly across all sectors
//      rather than topped up per-sector -- until the average degree reaches
//      avgDegree, respecting maxLinks on both endpoints. This keeps the map
//      sparse and varied (a few well-connected hub sectors, most sectors
//      modestly connected) instead of saturating everything toward the cap.
//   3. Insert sectors, then insert each undirected connection as two
//      directed rows (A->B and B->A) so "sectors reachable from here" is a
//      single indexed lookup.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const mysql = require('mysql2/promise');

function parseArgs(argv) {
  const args = { name: null, sectors: 1000, minLinks: 1, maxLinks: 6, avgDegree: 3.5 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--name': args.name = argv[++i]; break;
      case '--sectors': args.sectors = parseInt(argv[++i], 10); break;
      case '--min-links': args.minLinks = parseInt(argv[++i], 10); break;
      case '--max-links': args.maxLinks = parseInt(argv[++i], 10); break;
      case '--avg-degree': args.avgDegree = parseFloat(argv[++i]); break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// Builds a random spanning tree over sectors 0..n-1, where no sector exceeds
// maxDegree connections. Returns { edges: [[a,b], ...], degree: [n] }.
function buildSpanningTree(n, maxDegree) {
  const order = shuffle([...Array(n).keys()]);
  const degree = new Array(n).fill(0);
  const edges = [];
  const connected = [order[0]];

  for (let i = 1; i < n; i++) {
    const node = order[i];
    let parent = null;

    // Fast path: a few random guesses.
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = connected[Math.floor(Math.random() * connected.length)];
      if (degree[candidate] < maxDegree) { parent = candidate; break; }
    }
    // Fallback: guaranteed to find one if capacity allows (it always should
    // at maxDegree >= 2, since capacity vastly exceeds the n-1 edges needed).
    if (parent === null) {
      const eligible = connected.filter(c => degree[c] < maxDegree);
      if (eligible.length === 0) {
        throw new Error(
          `Ran out of spanning-tree capacity at sector ${i}/${n} -- ` +
          `raise --max-links (currently ${maxDegree}) or reduce --sectors.`
        );
      }
      parent = eligible[Math.floor(Math.random() * eligible.length)];
    }

    edges.push([parent, node]);
    degree[parent]++;
    degree[node]++;
    connected.push(node);
  }

  return { edges, degree };
}

// Adds up to `budget` random extra edges on top of the spanning tree,
// respecting maxDegree on both endpoints and never duplicating an existing
// edge. Uses uniform random sampling across the whole sector set (rather
// than trying to top every sector up toward maxDegree) so the result is a
// sparse, varied map with a handful of high-connectivity hub sectors --
// not a universe where most sectors sit at the degree cap.
function addExtraEdges(n, degree, existingEdges, maxDegree, budget) {
  const extra = [];
  const maxAttempts = Math.max(budget * 20, 200);
  let attempts = 0;

  while (extra.length < budget && attempts < maxAttempts) {
    attempts++;
    const i = Math.floor(Math.random() * n);
    const j = Math.floor(Math.random() * n);
    if (i === j || degree[i] >= maxDegree || degree[j] >= maxDegree) continue;
    const key = edgeKey(i, j);
    if (existingEdges.has(key)) continue;
    existingEdges.add(key);
    degree[i]++;
    degree[j]++;
    extra.push([i, j]);
  }

  return extra;
}

function buildUniverseGraph(sectorCount, minLinks, maxLinks, avgDegree) {
  if (minLinks < 1) throw new Error('--min-links must be at least 1 (a spanning tree gives every sector at least 1 connection)');
  if (maxLinks < minLinks) throw new Error('--max-links must be >= --min-links');

  const { edges: treeEdges, degree } = buildSpanningTree(sectorCount, maxLinks);
  const existingEdges = new Set(treeEdges.map(([a, b]) => edgeKey(a, b)));

  // The spanning tree alone already gives an average degree of ~2 (it has
  // sectorCount - 1 edges). Only add enough extra edges to reach the
  // requested average, rather than greedily maximizing every sector.
  const targetTotalEdges = Math.round((sectorCount * avgDegree) / 2);
  const extraBudget = Math.max(0, targetTotalEdges - treeEdges.length);
  const extraEdges = addExtraEdges(sectorCount, degree, existingEdges, maxLinks, extraBudget);

  const allEdges = [...treeEdges, ...extraEdges];

  const min = Math.min(...degree);
  const max = Math.max(...degree);
  const avg = degree.reduce((a, b) => a + b, 0) / degree.length;

  return { edges: allEdges, degree, stats: { min, max, avg, edgeCount: allEdges.length } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const instanceName = args.name || `Haulonaut Universe ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

  console.log(`Connecting to: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  try {
    const [gameRows] = await conn.query('SELECT id FROM games WHERE game_key = ?', ['haulonaut']);
    if (gameRows.length === 0) {
      throw new Error("No 'haulonaut' row in games -- run migration 054 first.");
    }
    const gameId = gameRows[0].id;

    console.log(`Generating universe graph: ${args.sectors} sectors, ${args.minLinks}-${args.maxLinks} links each...`);
    const { edges, stats } = buildUniverseGraph(args.sectors, args.minLinks, args.maxLinks, args.avgDegree);
    console.log(`Graph built: ${stats.edgeCount} connections, degree min=${stats.min} max=${stats.max} avg=${stats.avg.toFixed(2)}`);

    await conn.beginTransaction();

    const [instanceResult] = await conn.query(
      'INSERT INTO game_instances (game_id, name, status) VALUES (?, ?, ?)',
      [gameId, instanceName, 'setup']
    );
    const instanceId = instanceResult.insertId;

    // Insert sectors 1..N in batches.
    const sectorRows = [];
    for (let n = 1; n <= args.sectors; n++) sectorRows.push([instanceId, n]);
    const SECTOR_BATCH = 500;
    for (let i = 0; i < sectorRows.length; i += SECTOR_BATCH) {
      const batch = sectorRows.slice(i, i + SECTOR_BATCH);
      await conn.query('INSERT INTO haulonaut_sectors (game_instance_id, sector_number) VALUES ?', [batch]);
    }

    // Map sector_number (0-indexed in the graph) -> DB id.
    const [sectorIdRows] = await conn.query(
      'SELECT id, sector_number FROM haulonaut_sectors WHERE game_instance_id = ? ORDER BY sector_number',
      [instanceId]
    );
    const idByIndex = sectorIdRows.map(r => r.id); // index i -> sector_number i+1's DB id

    // Every undirected edge becomes two directed rows.
    const linkRows = [];
    for (const [a, b] of edges) {
      linkRows.push([instanceId, idByIndex[a], idByIndex[b]]);
      linkRows.push([instanceId, idByIndex[b], idByIndex[a]]);
    }
    const LINK_BATCH = 1000;
    for (let i = 0; i < linkRows.length; i += LINK_BATCH) {
      const batch = linkRows.slice(i, i + LINK_BATCH);
      await conn.query(
        'INSERT INTO haulonaut_sector_links (game_instance_id, from_sector_id, to_sector_id) VALUES ?',
        [batch]
      );
    }

    await conn.query(
      "UPDATE game_instances SET status = 'active', started_at = NOW() WHERE id = ?",
      [instanceId]
    );

    await conn.commit();

    console.log(`\nUniverse "${instanceName}" created: game_instances.id = ${instanceId}`);
    console.log(`${sectorRows.length} sectors, ${linkRows.length} directed links (${stats.edgeCount} undirected connections).`);
  } catch (err) {
    await conn.rollback();
    console.error('Generation failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
