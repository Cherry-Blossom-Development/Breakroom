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

// Folds platform-grouped rows (one row per platform, with total_today/total_7d/total_30d
// and optionally unique_today/unique_7d/unique_30d columns) into a { today, "7d", "30d" }
// shape, each with a total (+ unique, if present) and a byPlatform breakdown.
function foldPlatformRows(rows, { withUnique } = {}) {
  const windows = ['today', '7d', '30d'];
  const suffix = { today: 'today', '7d': '7d', '30d': '30d' };
  const result = {};
  for (const w of windows) {
    const byPlatform = {};
    for (const p of PLATFORMS) byPlatform[p] = withUnique ? { total: 0, unique: 0 } : { total: 0 };
    result[w] = withUnique
      ? { total: 0, unique: 0, byPlatform }
      : { total: 0, byPlatform };
  }
  for (const row of rows) {
    const platform = PLATFORMS.includes(row.platform) ? row.platform : 'web';
    for (const w of windows) {
      const total = Number(row[`total_${suffix[w]}`]) || 0;
      result[w].total += total;
      result[w].byPlatform[platform].total = total;
      if (withUnique) {
        const unique = Number(row[`unique_${suffix[w]}`]) || 0;
        result[w].unique += unique;
        result[w].byPlatform[platform].unique = unique;
      }
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
 * GET /api/analytics/summary
 * Marketing-only. Today / 7-day / 30-day totals for visits, logins, and
 * signups, each broken down by platform. Internal users are excluded.
 */
router.get('/summary', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const client = await getClient();
  try {
    const visitsResult = await client.query(`
      SELECT
        v.platform,
        COUNT(*) AS total_30d,
        COUNT(DISTINCT v.visitor_id) AS unique_30d,
        SUM(CASE WHEN v.created_at >= CURDATE() THEN 1 ELSE 0 END) AS total_today,
        COUNT(DISTINCT CASE WHEN v.created_at >= CURDATE() THEN v.visitor_id END) AS unique_today,
        SUM(CASE WHEN v.created_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS total_7d,
        COUNT(DISTINCT CASE WHEN v.created_at >= NOW() - INTERVAL 7 DAY THEN v.visitor_id END) AS unique_7d
      FROM analytics_visits v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.created_at >= NOW() - INTERVAL 30 DAY
        AND (v.user_id IS NULL OR u.is_internal = FALSE)
      GROUP BY v.platform
    `);

    const loginsResult = await client.query(`
      SELECT
        l.platform,
        COUNT(*) AS total_30d,
        SUM(CASE WHEN l.created_at >= CURDATE() THEN 1 ELSE 0 END) AS total_today,
        SUM(CASE WHEN l.created_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS total_7d
      FROM analytics_logins l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= NOW() - INTERVAL 30 DAY
        AND u.is_internal = FALSE
      GROUP BY l.platform
    `);

    const signupsResult = await client.query(`
      SELECT
        signup_platform AS platform,
        COUNT(*) AS total_30d,
        SUM(CASE WHEN created_at >= CURDATE() THEN 1 ELSE 0 END) AS total_today,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS total_7d
      FROM users
      WHERE created_at >= NOW() - INTERVAL 30 DAY
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
 * GET /api/analytics/daily
 * Marketing-only. Last 30 days, one row per day: visit count (+ unique
 * visitors), login count, signup count. Internal users are excluded.
 */
router.get('/daily', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const client = await getClient();
  try {
    const visitsResult = await client.query(`
      SELECT DATE(v.created_at) AS day, COUNT(*) AS total, COUNT(DISTINCT v.visitor_id) AS unique_count
      FROM analytics_visits v
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.created_at >= CURDATE() - INTERVAL 29 DAY
        AND (v.user_id IS NULL OR u.is_internal = FALSE)
      GROUP BY DATE(v.created_at)
    `);

    const loginsResult = await client.query(`
      SELECT DATE(l.created_at) AS day, COUNT(*) AS total
      FROM analytics_logins l
      JOIN users u ON u.id = l.user_id
      WHERE l.created_at >= CURDATE() - INTERVAL 29 DAY
        AND u.is_internal = FALSE
      GROUP BY DATE(l.created_at)
    `);

    const signupsResult = await client.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS total
      FROM users
      WHERE created_at >= CURDATE() - INTERVAL 29 DAY
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

    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({
        date: key,
        visits: Number(visitsByDay[key]?.total) || 0,
        uniqueVisitors: Number(visitsByDay[key]?.unique_count) || 0,
        logins: Number(loginsByDay[key]?.total) || 0,
        signups: Number(signupsByDay[key]?.total) || 0,
      });
    }

    res.status(200).json({ days });
  } catch (err) {
    console.error('Error fetching daily analytics:', err);
    res.status(500).json({ message: 'Failed to fetch daily analytics' });
  } finally {
    client.release();
  }
});

module.exports = router;
