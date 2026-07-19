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

// Feature-usage registry. Each key is one "major feature" a member can use,
// fired once per browser session per feature by the frontend router (see
// frontend/src/router/index.js). `monetized: true` marks features that lead
// to a payment flow (Stripe Connect marketplace sales, Prosaurus Pro), so
// they can be reported on separately from free-to-use tools.
const FEATURES = {
  blog: { label: 'Blog', monetized: false },
  chat: { label: 'Chat', monetized: false },
  friends: { label: 'Friends', monetized: false },
  lyrics: { label: 'Lyric Lab', monetized: false },
  sessions: { label: 'Sessions', monetized: true },
  art_gallery: { label: 'Art Gallery', monetized: false },
  artist_showcase: { label: 'Artist Showcase', monetized: true },
  kanban: { label: 'Kanban', monetized: false },
  tool_shed: { label: 'Tool Shed', monetized: false },
  company_portal: { label: 'Company Portal', monetized: false },
  band_pages: { label: 'Band Pages', monetized: false },
};

// Public marketing-page registry (the /explore pages a logged-out visitor can
// browse before signing up). Kept separate from FEATURES -- these track
// anonymous pre-signup interest, not authenticated in-app usage. `monetized`
// marks the pages promoting the two paid-adjacent features.
const MARKETING_PAGES = {
  explore_hub: { label: 'Explore Hub', monetized: false },
  explore_blog: { label: 'Blog', monetized: false },
  explore_chat: { label: 'Chat', monetized: false },
  explore_friends: { label: 'Friends', monetized: false },
  explore_lyrics: { label: 'Lyric Lab', monetized: false },
  explore_sessions: { label: 'Sessions', monetized: true },
  explore_art_gallery: { label: 'Art Gallery', monetized: false },
  explore_artist_showcase: { label: 'Artist Showcase', monetized: true },
  explore_kanban: { label: 'Kanban', monetized: false },
  explore_company_portal: { label: 'Company Portal', monetized: false },
  explore_band_pages: { label: 'Band Pages', monetized: false },
};

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
 * POST /api/analytics/feature
 * Public — records one feature-usage touch (anonymous or authenticated).
 * Fired once per client session per feature by web/Android/iOS. Bot traffic
 * is silently ignored. `feature` must be one of the known FEATURES keys.
 */
router.post('/feature', async (req, res) => {
  const { feature, visitorId } = req.body;
  if (!feature || !Object.prototype.hasOwnProperty.call(FEATURES, feature)) {
    return res.status(400).json({ message: 'Unknown feature' });
  }
  if (!visitorId) {
    return res.status(400).json({ message: 'visitorId is required' });
  }

  if (isBot(req)) {
    return res.status(201).json({ message: 'Feature usage recorded' });
  }

  const platform = getPlatform(req);
  const client = await getClient();
  try {
    const userId = await resolveUserId(req, client);
    await client.query(
      'INSERT INTO analytics_feature_usage (feature, visitor_id, user_id, platform) VALUES ($1, $2, $3, $4)',
      [feature, visitorId, userId, platform]
    );
    res.status(201).json({ message: 'Feature usage recorded' });
  } catch (err) {
    console.error('Error recording feature usage:', err);
    res.status(500).json({ message: 'Failed to record feature usage' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/analytics/marketing-pageview
 * Public — records one touch of a public /explore marketing page (anonymous
 * pre-signup interest). Fired once per client session per page by the
 * frontend router, only while logged out. Bot traffic is silently ignored.
 * `page` must be one of the known MARKETING_PAGES keys.
 */
router.post('/marketing-pageview', async (req, res) => {
  const { page, visitorId } = req.body;
  if (!page || !Object.prototype.hasOwnProperty.call(MARKETING_PAGES, page)) {
    return res.status(400).json({ message: 'Unknown page' });
  }
  if (!visitorId) {
    return res.status(400).json({ message: 'visitorId is required' });
  }

  if (isBot(req)) {
    return res.status(201).json({ message: 'Pageview recorded' });
  }

  const client = await getClient();
  try {
    await client.query(
      'INSERT INTO analytics_marketing_pageviews (page, visitor_id) VALUES ($1, $2)',
      [page, visitorId]
    );
    res.status(201).json({ message: 'Pageview recorded' });
  } catch (err) {
    console.error('Error recording marketing pageview:', err);
    res.status(500).json({ message: 'Failed to record pageview' });
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

/**
 * GET /api/analytics/features?range=today|7d|30d|year
 * Marketing-only. Usage totals per major feature over the given range
 * (defaults to 30d). Every known feature is included even with zero usage,
 * so the frontend doesn't have to reconcile against the FEATURES registry
 * itself. Internal users are excluded.
 */
router.get('/features', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const range = resolveRange(req.query.range);
  const client = await getClient();
  try {
    const result = await client.query(`
      SELECT f.feature, COUNT(*) AS total, COUNT(DISTINCT f.visitor_id) AS unique_count
      FROM analytics_feature_usage f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.created_at >= ${range.sql}
        AND (f.user_id IS NULL OR u.is_internal = FALSE)
      GROUP BY f.feature
    `);

    const byFeature = Object.fromEntries(result.rows.map(r => [r.feature, r]));

    const features = Object.entries(FEATURES).map(([key, def]) => ({
      key,
      label: def.label,
      monetized: def.monetized,
      total: Number(byFeature[key]?.total) || 0,
      unique: Number(byFeature[key]?.unique_count) || 0,
    })).sort((a, b) => b.total - a.total);

    res.status(200).json({ features });
  } catch (err) {
    console.error('Error fetching feature usage:', err);
    res.status(500).json({ message: 'Failed to fetch feature usage' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/analytics/registration-paths?range=today|7d|30d|year
 * Marketing-only. For every registration in the given range (defaults to
 * 30d, filtered by the user's created_at -- this is about registration
 * outcomes, not pageview timing), reconstructs the distinct sequence of
 * /explore pages that visitor touched pre-signup (in first-touch order,
 * repeats collapsed) and groups registrations by identical path. Signups
 * with no tracked touches (direct link, invite, mobile signups that never
 * send a visitorId, etc.) bucket into "Direct / No Tracked Path". Ranked
 * by count descending; only the top 10 distinct paths are broken out, the
 * rest roll up into "Other combinations".
 */
router.get('/registration-paths', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const range = resolveRange(req.query.range);
  const TOP_N = 10;
  const client = await getClient();
  try {
    const usersResult = await client.query(`
      SELECT signup_visitor_id AS visitor_id
      FROM users
      WHERE created_at >= ${range.sql}
        AND is_internal = FALSE
    `);
    const registrants = usersResult.rows;
    const totalRegistrations = registrants.length;

    const visitorIds = [...new Set(registrants.map(r => r.visitor_id).filter(Boolean))];

    const touchesByVisitor = {};
    if (visitorIds.length > 0) {
      const placeholders = visitorIds.map((_, i) => `$${i + 1}`).join(', ');
      const touchesResult = await client.query(
        `SELECT visitor_id, page FROM analytics_marketing_pageviews
         WHERE visitor_id IN (${placeholders}) ORDER BY visitor_id, created_at`,
        visitorIds
      );
      for (const row of touchesResult.rows) {
        if (!touchesByVisitor[row.visitor_id]) touchesByVisitor[row.visitor_id] = [];
        touchesByVisitor[row.visitor_id].push(row.page);
      }
    }

    const pathCounts = new Map();
    for (const r of registrants) {
      const rawTouches = r.visitor_id ? (touchesByVisitor[r.visitor_id] || []) : [];
      const seen = new Set();
      const pages = [];
      for (const page of rawTouches) {
        if (!seen.has(page)) {
          seen.add(page);
          pages.push(page);
        }
      }
      const key = pages.length ? pages.join(',') : '__direct__';
      if (!pathCounts.has(key)) pathCounts.set(key, { pages, count: 0 });
      pathCounts.get(key).count += 1;
    }

    const ranked = [...pathCounts.values()].sort((a, b) => b.count - a.count);
    const top = ranked.slice(0, TOP_N);
    const otherCount = ranked.slice(TOP_N).reduce((sum, p) => sum + p.count, 0);

    const toLabel = (pages) => pages.length
      ? pages.map(p => MARKETING_PAGES[p]?.label || p).join(' → ')
      : 'Direct / No Tracked Path';
    const toPercent = (count) => totalRegistrations ? Math.round((count / totalRegistrations) * 100) : 0;

    const paths = top.map(p => ({
      key: p.pages.length ? p.pages.join(',') : '__direct__',
      label: toLabel(p.pages),
      count: p.count,
      percent: toPercent(p.count),
    }));

    if (otherCount > 0) {
      paths.push({ key: '__other__', label: 'Other combinations', count: otherCount, percent: toPercent(otherCount) });
    }

    res.status(200).json({ totalRegistrations, paths });
  } catch (err) {
    console.error('Error fetching registration paths:', err);
    res.status(500).json({ message: 'Failed to fetch registration paths' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/analytics/marketing-pages?range=today|7d|30d|year
 * Marketing-only. Views, unique visitors, and signup conversions per public
 * /explore page over the given range (defaults to 30d). A "conversion" is a
 * distinct visitor who viewed that page in-range and whose visitor_id later
 * shows up as some user's signup_visitor_id -- the signup itself doesn't
 * have to fall inside the range, only the pageview does.
 */
router.get('/marketing-pages', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const range = resolveRange(req.query.range);
  const client = await getClient();
  try {
    const result = await client.query(`
      SELECT m.page,
        COUNT(*) AS views,
        COUNT(DISTINCT m.visitor_id) AS unique_count,
        COUNT(DISTINCT CASE WHEN u.id IS NOT NULL THEN m.visitor_id END) AS conversions
      FROM analytics_marketing_pageviews m
      LEFT JOIN users u ON u.signup_visitor_id = m.visitor_id
      WHERE m.created_at >= ${range.sql}
      GROUP BY m.page
    `);

    const byPage = Object.fromEntries(result.rows.map(r => [r.page, r]));

    const pages = Object.entries(MARKETING_PAGES).map(([key, def]) => ({
      key,
      label: def.label,
      monetized: def.monetized,
      views: Number(byPage[key]?.views) || 0,
      unique: Number(byPage[key]?.unique_count) || 0,
      conversions: Number(byPage[key]?.conversions) || 0,
    })).sort((a, b) => b.views - a.views);

    res.status(200).json({ pages });
  } catch (err) {
    console.error('Error fetching marketing page stats:', err);
    res.status(500).json({ message: 'Failed to fetch marketing page stats' });
  } finally {
    client.release();
  }
});

const SUBSCRIPTION_PLATFORMS = {
  stripe: 'Web (Stripe)',
  apple: 'Apple',
  google: 'Android',
};

/**
 * GET /api/analytics/paying-customers?range=today|7d|30d|year
 * Marketing-only. New paying customers over the given range (defaults to
 * 30d), broken out by monetization path:
 *  - Subscriptions (Stripe web, Apple, Google) -- counted by first-ever
 *    user_subscriptions.created_at falling in range. platform='promo' rows
 *    are comped accounts granted by an admin, not revenue, and excluded.
 *  - Storefront -- orders that reached a paid status in range. Buyers
 *    aren't linked to user accounts (guest checkout), so this is reported
 *    as revenue + order count rather than a customer count.
 * Internal users/sellers are excluded.
 */
router.get('/paying-customers', authenticate, checkPermission('marketing_access'), async (req, res) => {
  const range = resolveRange(req.query.range);
  const client = await getClient();
  try {
    const subsResult = await client.query(`
      SELECT s.platform, COUNT(*) AS total
      FROM user_subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.created_at >= ${range.sql}
        AND s.platform != 'promo'
        AND u.is_internal = FALSE
      GROUP BY s.platform
    `);
    const byPlatform = Object.fromEntries(subsResult.rows.map(r => [r.platform, r.total]));
    const subscriptions = Object.entries(SUBSCRIPTION_PLATFORMS).map(([key, label]) => ({
      key,
      label,
      count: Number(byPlatform[key]) || 0,
    }));

    const storefrontResult = await client.query(`
      SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS revenue_cents
      FROM orders o
      JOIN users u ON u.id = o.seller_user_id
      WHERE o.created_at >= ${range.sql}
        AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
        AND u.is_internal = FALSE
    `);
    const storefrontRow = storefrontResult.rows[0] || {};

    res.status(200).json({
      subscriptions,
      totalNewSubscribers: subscriptions.reduce((sum, s) => sum + s.count, 0),
      storefront: {
        orders: Number(storefrontRow.orders) || 0,
        revenueCents: Number(storefrontRow.revenue_cents) || 0,
      },
    });
  } catch (err) {
    console.error('Error fetching paying customer stats:', err);
    res.status(500).json({ message: 'Failed to fetch paying customer stats' });
  } finally {
    client.release();
  }
});

module.exports = router;
