const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { getPlatform } = require('../utilities/platform');
const { checkPermission } = require('../middleware/checkPermission');

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;

const PLATFORMS = ['web', 'android', 'ios'];

// Supported summary/daily time ranges. `sql` is a fixed, non-user-derived
// fragment (req.query.range only ever selects a key here, never gets
// interpolated itself), and `days` bounds how many rows /daily returns.
const RANGES = {
  today: { days: 1, sql: 'CURDATE()' },
  '7d': { days: 7, sql: 'NOW() - INTERVAL 7 DAY' },
  '30d': { days: 30, sql: 'NOW() - INTERVAL 30 DAY' },
  year: { days: 365, sql: 'NOW() - INTERVAL 1 YEAR' },
};

function resolveRange(key) {
  return RANGES[key] || RANGES['30d'];
}

// Known bot/crawler User-Agent patterns (case-insensitive matching)
const BOT_PATTERNS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'yandexbot', 'sogou', 'exabot', 'facebot', 'ia_archiver',
  'mj12bot', 'ahrefsbot', 'semrushbot', 'dotbot', 'rogerbot',
  'seznambot', 'petalbot', 'bytespider', 'applebot', 'twitterbot',
  'linkedinbot', 'slackbot', 'telegrambot', 'whatsapp', 'discordbot',
  'crawler', 'spider', 'scraper', 'bot/', 'headless', 'phantom',
  'python-requests', 'python-urllib', 'axios/', 'node-fetch', 'go-http-client',
  'curl/', 'wget/', 'httpie/', 'postman', 'insomnia',
];

/**
 * Returns true if the request appears to be from a bot/crawler.
 * Checks User-Agent against known bot patterns.
 */
function isBot(req) {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  if (!userAgent) return true; // No UA = likely bot
  return BOT_PATTERNS.some(pattern => userAgent.includes(pattern));
}

const authenticate = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Resolves a user id from the request's token, if any. Never rejects —
// visits are recorded for anonymous traffic too.
async function resolveUserId(req, client) {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const result = await client.query('SELECT id FROM users WHERE handle = $1', [payload.username]);
    return result.rowCount > 0 ? result.rows[0].id : null;
  } catch {
    return null;
  }
}

// Folds platform-grouped rows (one row per platform, with total and
// optionally unique_count columns) into a single { total, unique?, byPlatform }
// shape for one time range.
function foldPlatformRows(rows, { withUnique } = {}) {
  const byPlatform = {};
  for (const p of PLATFORMS) byPlatform[p] = withUnique ? { total: 0, unique: 0 } : { total: 0 };
  const result = withUnique ? { total: 0, unique: 0, byPlatform } : { total: 0, byPlatform };
  for (const row of rows) {
    const platform = PLATFORMS.includes(row.platform) ? row.platform : 'web';
    const total = Number(row.total) || 0;
    result.total += total;
    result.byPlatform[platform].total = total;
    if (withUnique) {
      const unique = Number(row.unique_count) || 0;
      result.unique += unique;
      result.byPlatform[platform].unique = unique;
    }
  }
  return result;
}

/**
 * POST /api/analytics/visit
 * Public — records one visit (anonymous or authenticated). Fired once per
 * client session by web/Android/iOS. Bot traffic is silently ignored.
 */
router.post('/visit', async (req, res) => {
  const { visitorId } = req.body;
  if (!visitorId) {
    return res.status(400).json({ message: 'visitorId is required' });
  }

  // Silently skip bot traffic (return success to not break anything)
  if (isBot(req)) {
    return res.status(201).json({ message: 'Visit recorded' });
  }

  const platform = getPlatform(req);
  const client = await getClient();
  try {
    const userId = await resolveUserId(req, client);
    await client.query(
      'INSERT INTO analytics_visits (visitor_id, user_id, platform) VALUES ($1, $2, $3)',
      [visitorId, userId, platform]
    );
    res.status(201).json({ message: 'Visit recorded' });
  } catch (err) {
    console.error('Error recording visit:', err);
    res.status(500).json({ message: 'Failed to record visit' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/analytics/summary?range=today|7d|30d|year
 * Marketing-only. Totals for visits, logins, and signups over the given
 * range (defaults to 30d), each broken down by platform. Internal users
 * are excluded.
 */
router.get('/summary', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const range = resolveRange(req.query.range);
  const client = await getClient();
  try {
    const visitsResult = await client.query(`
      SELECT v.platform, COUNT(*) AS total, COUNT(DISTINCT v.visitor_id) AS unique_count
      FROM analytics_visits v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.created_at >= ${range.sql}
        AND (v.user_id IS NULL OR u.is_internal = FALSE)
      GROUP BY v.platform
    `);

    const loginsResult = await client.query(`
      SELECT l.platform, COUNT(*) AS total
      FROM analytics_logins l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= ${range.sql}
        AND u.is_internal = FALSE
      GROUP BY l.platform
    `);

    const signupsResult = await client.query(`
      SELECT signup_platform AS platform, COUNT(*) AS total
      FROM users
      WHERE created_at >= ${range.sql}
        AND is_internal = FALSE
      GROUP BY signup_platform
    `);

    res.status(200).json({
      visits: foldPlatformRows(visitsResult.rows, { withUnique: true }),
      logins: foldPlatformRows(loginsResult.rows),
      signups: foldPlatformRows(signupsResult.rows),
    });
  } catch (err) {
    console.error('Error fetching analytics summary:', err);
    res.status(500).json({ message: 'Failed to fetch analytics summary' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/analytics/daily?range=today|7d|30d|year
 * Marketing-only. One row per day covering the given range (defaults to
 * 30d): visit count (+ unique visitors), login count, signup count.
 * Internal users are excluded.
 */
router.get('/daily', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const { days } = resolveRange(req.query.range);
  const lookback = days - 1;
  const client = await getClient();
  try {
    const visitsResult = await client.query(`
      SELECT DATE(v.created_at) AS day, COUNT(*) AS total, COUNT(DISTINCT v.visitor_id) AS unique_count
      FROM analytics_visits v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.created_at >= CURDATE() - INTERVAL ${lookback} DAY
        AND (v.user_id IS NULL OR u.is_internal = FALSE)
      GROUP BY DATE(v.created_at)
    `);

    const loginsResult = await client.query(`
      SELECT DATE(l.created_at) AS day, COUNT(*) AS total
      FROM analytics_logins l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= CURDATE() - INTERVAL ${lookback} DAY
        AND u.is_internal = FALSE
      GROUP BY DATE(l.created_at)
    `);

    const signupsResult = await client.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS total
      FROM users
      WHERE created_at >= CURDATE() - INTERVAL ${lookback} DAY
        AND is_internal = FALSE
      GROUP BY DATE(created_at)
    `);

    const toDateKey = (d) => {
      const date = d instanceof Date ? d : new Date(d);
      return date.toISOString().slice(0, 10);
    };

    const visitsByDay = Object.fromEntries(visitsResult.rows.map(r => [toDateKey(r.day), r]));
    const loginsByDay = Object.fromEntries(loginsResult.rows.map(r => [toDateKey(r.day), r]));
    const signupsByDay = Object.fromEntries(signupsResult.rows.map(r => [toDateKey(r.day), r]));

    const daysOut = [];
    for (let i = lookback; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      daysOut.push({
        date: key,
        visits: Number(visitsByDay[key]?.total) || 0,
        uniqueVisitors: Number(visitsByDay[key]?.unique_count) || 0,
        logins: Number(loginsByDay[key]?.total) || 0,
        signups: Number(signupsByDay[key]?.total) || 0,
      });
    }

    res.status(200).json({ days: daysOut });
  } catch (err) {
    console.error('Error fetching daily analytics:', err);
    res.status(500).json({ message: 'Failed to fetch daily analytics' });
  } finally {
    client.release();
  }
});

module.exports = router;
