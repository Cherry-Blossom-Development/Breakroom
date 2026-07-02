const { getClient } = require('./db');

const REFRESH_MS = 60_000;

let activeDomains = new Set();

async function refresh() {
  let client;
  try {
    client = await getClient();
    const result = await client.query(`SELECT domain FROM custom_domains WHERE status = 'active'`);
    activeDomains = new Set(result.rows.map(r => r.domain));
  } catch (err) {
    // Leave the previous cache in place on failure — never let a DB hiccup wipe out
    // already-known-good custom domains from CORS.
    console.error('[CustomDomainCache] refresh failed:', err.message);
  } finally {
    if (client) client.release();
  }
}

function isActiveCustomDomain(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return activeDomains.has(host);
}

function startCustomDomainCache() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}

module.exports = { startCustomDomainCache, isActiveCustomDomain, refresh };
