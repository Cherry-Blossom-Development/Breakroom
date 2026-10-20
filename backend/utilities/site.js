/**
 * Which site a request belongs to. One backend serves Prosaurus and the
 * Greywire Studio community (community.greywirestudio.com); accounts are
 * shared, but each site keeps its own rooms, sessions and bands.
 *
 * Browsers are identified by the Host header (nginx passes it through).
 * Native apps have no host of their own, so they send X-Site instead.
 */

const SITES = {
  prosaurus: {
    name: 'Prosaurus',
    origins: ['https://prosaurus.com', 'https://www.prosaurus.com'],
  },
  greywire: {
    name: 'Greywire Studio',
    hosts: ['community.greywirestudio.com', 'local.greywirestudio.com'],
    origins: ['https://community.greywirestudio.com'],
  },
};

const DEFAULT_SITE = 'prosaurus';

function siteFromHost(hostname) {
  const host = (hostname || '').toLowerCase();
  for (const [key, site] of Object.entries(SITES)) {
    if (site.hosts && site.hosts.includes(host)) return key;
  }
  return DEFAULT_SITE;
}

/**
 * Returns the site key ('prosaurus' or 'greywire') for a request.
 * X-Site wins when it names a known site; otherwise the host decides, and
 * anything unrecognized (including custom domains) is Prosaurus.
 */
function getSite(req) {
  const header = (req.headers['x-site'] || '').toLowerCase();
  if (SITES[header]) return header;
  return siteFromHost(req.hostname);
}

// Express middleware: sets req.site for every request.
function attachSite(req, res, next) {
  req.site = getSite(req);
  next();
}

/**
 * Domain for the jwtToken cookie. In production, Prosaurus hosts share one
 * cookie across prosaurus.com and its subdomains. Every other host (Greywire,
 * local development) gets a host-only cookie, since a browser rejects a cookie
 * whose domain doesn't match the address it's on.
 */
function authCookieDomain(req) {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const host = (req.hostname || '').toLowerCase();
  if (host === 'prosaurus.com' || host.endsWith('.prosaurus.com')) return '.prosaurus.com';
  return undefined;
}

// Origins of every site, for the CORS and Socket.IO allowlist.
const siteOrigins = Object.values(SITES).flatMap(site => site.origins);

module.exports = { SITES, DEFAULT_SITE, getSite, attachSite, authCookieDomain, siteOrigins };
