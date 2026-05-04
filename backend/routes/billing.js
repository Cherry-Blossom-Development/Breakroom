const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Lazy init — avoids crashing the server at startup if the key is missing
let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const RETURN_URL = `${process.env.CORS_ORIGIN}/collections/payment-setup?stripe=complete`;
const REFRESH_URL = `${process.env.CORS_ORIGIN}/collections/payment-setup?stripe=refresh`;

// GET /api/billing/connect/status
// Returns the user's Stripe Connect status: not_connected | pending | active
router.get('/connect/status', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT stripe_account_id, onboarding_complete FROM user_stripe_connect WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.json({ status: 'not_connected' });
    }

    const { stripe_account_id, onboarding_complete } = result.rows[0];

    // If we already have it flagged as complete, trust the DB
    if (onboarding_complete) {
      return res.json({ status: 'active', stripe_account_id });
    }

    // Otherwise ask Stripe for the current state
    const account = await getStripe().accounts.retrieve(stripe_account_id);
    const isComplete = account.details_submitted && account.charges_enabled;

    if (isComplete) {
      await client.query(
        'UPDATE user_stripe_connect SET onboarding_complete = 1 WHERE user_id = $1',
        [req.user.id]
      );
    }

    res.json({
      status: isComplete ? 'active' : 'pending',
      stripe_account_id
    });
  } catch (err) {
    console.error('Failed to get connect status:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/billing/connect/start
// Creates (or retrieves) the Stripe Express account and returns an onboarding URL
router.post('/connect/start', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT stripe_account_id, onboarding_complete FROM user_stripe_connect WHERE user_id = $1',
      [req.user.id]
    );

    let stripeAccountId;

    if (result.rowCount === 0) {
      // Create a new Express account
      const account = await getStripe().accounts.create({ type: 'express' });
      stripeAccountId = account.id;
      await client.query(
        'INSERT INTO user_stripe_connect (user_id, stripe_account_id) VALUES ($1, $2)',
        [req.user.id, stripeAccountId]
      );
    } else {
      stripeAccountId = result.rows[0].stripe_account_id;
      // Already fully set up — no need to re-onboard
      if (result.rows[0].onboarding_complete) {
        return res.json({ status: 'active' });
      }
    }

    // Generate an Account Link for onboarding
    const accountLink = await getStripe().accountLinks.create({
      account: stripeAccountId,
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error('Failed to start connect:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
