// Pure universe-graph generation for Haulonaut, shared between the CLI
// script (backend/scripts/generate-haulonaut-universe.js) and the game-admin
// "generate a new universe" API route (backend/routes/games.js). Deliberately
// has no DB code -- the two call sites persist the result differently (raw
// mysql2 vs the app's db.js wrapper), so only the algorithm is shared.
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
          `raise maxLinks (currently ${maxDegree}) or reduce sector count.`
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

// Builds a full universe graph over sectorCount sectors (0-indexed). Returns
// { edges: [[a,b], ...] (undirected pairs), degree: [n], stats }.
function buildUniverseGraph(sectorCount, minLinks, maxLinks, avgDegree) {
  if (minLinks < 1) throw new Error('minLinks must be at least 1 (a spanning tree gives every sector at least 1 connection)');
  if (maxLinks < minLinks) throw new Error('maxLinks must be >= minLinks');

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

module.exports = { buildUniverseGraph };
