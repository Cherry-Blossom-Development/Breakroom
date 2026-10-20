const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { memberSql } = require('../utilities/greywire');

const SECRET_KEY = process.env.SECRET_KEY;

// API paths on the Greywire site that don't need membership: signing in and
// up, checking or claiming membership, and public share links.
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

/**
 * Express middleware: on the Greywire site, every other API request needs a
 * signed-in Greywire member (see utilities/greywire.js). Non-members get a 403
 * with code GREYWIRE_MEMBERSHIP_REQUIRED so the front end can send them to the
 * claim page. Prosaurus requests pass straight through.
 */
async function greywireAccess(req, res, next) {
  if (req.site !== 'greywire' || !req.path.startsWith('/api/')) return next();
  if (OPEN_PATHS.some(re => re.test(req.path))) return next();
  if (req.method === 'GET' && OPEN_GET_PATHS.some(re => re.test(req.path))) return next();

  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  let payload;
  try {
    payload = jwt.verify(token, SECRET_KEY);
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }

  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT ${memberSql('u')} AS member FROM users u WHERE u.handle = $1`,
      [payload.username]
    );
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    if (!result.rows[0].member) {
      return res.status(403).json({
        message: 'The Greywire community is for Greywire pedal owners',
        code: 'GREYWIRE_MEMBERSHIP_REQUIRED',
      });
    }
    next();
  } catch (err) {
    console.error('Greywire access check error:', err);
    res.status(500).json({ message: 'Access check failed' });
  } finally {
    if (client) client.release();
  }
}

module.exports = greywireAccess;
