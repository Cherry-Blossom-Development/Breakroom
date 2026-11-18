const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { ensureGreywireUser } = require('../utilities/greywire');

const SECRET_KEY = process.env.SECRET_KEY;

// API paths on the Greywire site that anyone can reach, signed in or not:
// signing in and up, membership and claiming, the EULA, and public share links.
const OPEN_PATHS = [
  /^\/api\/auth\//,
  /^\/api\/greywire\//,
  /^\/api\/eula\//,
  /^\/api\/uploads\//,
  /^\/api\/sessions\/\d+\/public(\/stream)?$/,
  /^\/api\/band-page\//,
];
const OPEN_GET_PATHS = [
  /^\/api\/bands\/invite\/[^/]+$/,
];

function isOpenPath(req) {
  return OPEN_PATHS.some(re => re.test(req.path))
    || (req.method === 'GET' && OPEN_GET_PATHS.some(re => re.test(req.path)));
}

/**
 * Express middleware for the Greywire site (Prosaurus requests pass straight
 * through). Greywire is open to any full account, members or not (migration
 * 097); free-tier limits are enforced by the routes themselves.
 *
 * - Every signed-in request records the account as a Greywire user
 *   (ensureGreywireUser), so it shows up in Greywire friends, search and
 *   profiles, and joins the default rooms the first time.
 * - Outside the open paths, a request needs a signed-in, non-guest account.
 *   Guests get a 403 with code GREYWIRE_MEMBERSHIP_REQUIRED, which the web
 *   front end already handles by sending them to the claim page, where guests
 *   are told to sign up for a full account.
 */
async function greywireAccess(req, res, next) {
  if (req.site !== 'greywire' || !req.path.startsWith('/api/')) return next();
  const open = isOpenPath(req);

  const token = extractToken(req);
  let payload = null;
  if (token) {
    try {
      payload = jwt.verify(token, SECRET_KEY);
    } catch {
      payload = null;
    }
  }
  if (!payload) {
    if (open) return next();
    return res.status(401).json({ message: token ? 'Invalid token' : 'Not authenticated' });
  }

  let client;
  try {
    client = await getClient();
    const user = await client.query('SELECT id FROM users WHERE handle = $1', [payload.username]);
    if (user.rowCount === 0) {
      return open ? next() : res.status(401).json({ message: 'User not found' });
    }
    const allowed = await ensureGreywireUser(client, user.rows[0].id);
    if (!allowed && !open) {
      return res.status(403).json({
        message: "Guest accounts can't use the Greywire community. Sign up for a full account.",
        code: 'GREYWIRE_MEMBERSHIP_REQUIRED',
      });
    }
    next();
  } catch (err) {
    console.error('Greywire access check error:', err);
    // Open paths don't depend on the check, so don't let it break sign-in
    if (open) return next();
    res.status(500).json({ message: 'Access check failed' });
  } finally {
    if (client) client.release();
  }
}

module.exports = greywireAccess;
