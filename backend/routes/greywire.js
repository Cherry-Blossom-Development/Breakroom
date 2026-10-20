const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { getMembership, normalizeSerial } = require('../utilities/greywire');

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;

// Membership itself is checked by middleware/greywireAccess.js; these routes
// are how a signed-in user sees their status and claims a pedal to get in.
// They work from either site, so a Prosaurus user can claim too.

const authenticate = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle, is_guest FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Coarse in-memory guard against guessing serials: at most
// CLAIM_MAX_FAILURES failed claims per user per CLAIM_WINDOW_MS. Flash chip IDs
// can be partly predictable (lot and wafer numbers), so don't allow free tries.
const CLAIM_WINDOW_MS = 60 * 60 * 1000;
const CLAIM_MAX_FAILURES = 10;
const claimFailures = new Map(); // userId -> number[] (timestamps)

function recentFailures(userId) {
  const now = Date.now();
  const hits = (claimFailures.get(userId) || []).filter(t => now - t < CLAIM_WINDOW_MS);
  claimFailures.set(userId, hits);
  return hits;
}

/**
 * GET /api/greywire/membership
 * The current user's membership: { member, grantedAt, pedals: [...] }.
 */
router.get('/membership', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    res.json(await getMembership(client, req.user.id));
  } catch (err) {
    console.error('Error loading Greywire membership:', err);
    res.status(500).json({ message: 'Failed to load membership' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/greywire/claim  { serial }
 * Claims a registered pedal for the current user, which makes them a member.
 * Each serial can be claimed once; a second-hand pedal is moved by an admin.
 */
router.post('/claim', authenticate, async (req, res) => {
  if (req.user.is_guest) {
    return res.status(403).json({ message: 'Guest accounts cannot claim pedals. Sign up first.' });
  }
  if (recentFailures(req.user.id).length >= CLAIM_MAX_FAILURES) {
    return res.status(429).json({ message: 'Too many attempts. Try again in an hour.' });
  }

  const serial = normalizeSerial(req.body?.serial);
  if (!serial) {
    return res.status(400).json({ message: 'A serial is 16 characters, 0-9 and A-F' });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();
    const pedal = await client.query(
      'SELECT id, claimed_by FROM greywire_pedals WHERE serial = $1 FOR UPDATE',
      [serial]
    );

    if (pedal.rowCount === 0) {
      await client.rollback();
      claimFailures.get(req.user.id).push(Date.now());
      return res.status(404).json({ message: "We don't have a pedal with that serial on record" });
    }

    const { id, claimed_by } = pedal.rows[0];
    if (claimed_by === req.user.id) {
      await client.rollback();
      return res.json({ message: 'This pedal is already yours', membership: await getMembership(client, req.user.id) });
    }
    if (claimed_by !== null) {
      await client.rollback();
      claimFailures.get(req.user.id).push(Date.now());
      return res.status(409).json({
        message: 'This pedal has already been claimed. If you bought it second-hand, contact support to move it to your account.',
      });
    }

    await client.query(
      'UPDATE greywire_pedals SET claimed_by = $1, claimed_at = NOW() WHERE id = $2',
      [req.user.id, id]
    );
    await client.query(
      `INSERT INTO greywire_pedal_events (pedal_id, event, to_user_id, by_user_id)
       VALUES ($1, 'claimed', $2, $2)`,
      [id, req.user.id]
    );
    await client.commit();

    res.status(201).json({ message: 'Pedal claimed', membership: await getMembership(client, req.user.id) });
  } catch (err) {
    await client.rollback().catch(() => {});
    console.error('Error claiming Greywire pedal:', err);
    res.status(500).json({ message: 'Failed to claim pedal' });
  } finally {
    client.release();
  }
});

module.exports = router;
