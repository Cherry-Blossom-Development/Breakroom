// Generates a new Haulonaut universe: creates a game_instances row, then
// procedurally builds N sectors where every sector has between minLinks and
// maxLinks connections to other sectors, with the whole map guaranteed
// reachable from any sector (no isolated pockets). The graph algorithm
// itself lives in utilities/haulonautUniverse.js, shared with the
// game-admin "generate a new universe" API route -- this script just wires
// it up for standalone CLI use.
//
// Usage:
//   node generate-haulonaut-universe.js [--name "Universe Name"] [--sectors 1000]
//     [--min-links 1] [--max-links 6] [--avg-degree 3.5]
//
// Insert sectors, then insert each undirected connection as two directed
// rows (A->B and B->A) so "sectors reachable from here" is a single indexed
// lookup. Multiple instances can be active for the same game at once --
// this script only ever adds one, alongside whatever else is running; end
// an instance explicitly via the game-admin page if you want to retire it.

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });

const mysql = require('mysql2/promise');
const { buildUniverseGraph } = require('../utilities/haulonautUniverse');

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
