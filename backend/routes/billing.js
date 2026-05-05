const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Lazy Stripe init — avoids crashing the server at startup if the key is missing
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

const RETURN_URL  = `${process.env.CORS_ORIGIN}/collections/payment-setup?stripe=complete`;
const REFRESH_URL = `${process.env.CORS_ORIGIN}/collections/payment-setup?stripe=refresh`;

// ─── Helpers ────────────────────────────────────────────────────────────────

// Returns 0 (Pro) or 5 (Free) — used here and exported for future checkout route
async function getFeePercent(userId, client) {
  const result = await client.query(
    `SELECT status, expires_at FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (result.rowCount === 0) return 5;
  const sub = result.rows[0];
  const active = sub.status === 'active' &&
    (!sub.expires_at || new Date(sub.expires_at) > new Date());
  return active ? 0 : 5;
}

// Get or create a Stripe customer ID for this user
async function getOrCreateStripeCustomer(userId, handle, client) {
  const existing = await client.query(
    'SELECT stripe_customer_id FROM user_stripe_customers WHERE user_id = $1',
    [userId]
  );
  if (existing.rowCount > 0) return existing.rows[0].stripe_customer_id;

  // Fetch email for the customer record
  const userResult = await client.query(
    'SELECT email FROM users WHERE id = $1',
    [userId]
  );
  const email = userResult.rows[0]?.email;

  const customer = await getStripe().customers.create({
    email,
    metadata: { user_id: String(userId), handle }
  });

  await client.query(
    'INSERT INTO user_stripe_customers (user_id, stripe_customer_id) VALUES ($1, $2)',
    [userId, customer.id]
  );

  return customer.id;
}

// ─── Plan / fee routes ───────────────────────────────────────────────────────

// GET /api/billing/plan — current subscription tier and application fee rate
router.get('/plan', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT platform, status, expires_at FROM user_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.json({ subscribed: false, platform: null, status: null, expires_at: null, fee_percent: 5 });
    }
    const sub = result.rows[0];
    const active = sub.status === 'active' &&
      (!sub.expires_at || new Date(sub.expires_at) > new Date());
    res.json({
      subscribed: active,
      platform: sub.platform,
      status: sub.status,
      expires_at: sub.expires_at,
      fee_percent: active ? 0 : 5
    });
  } catch (err) {
    console.error('Failed to get plan:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/billing/subscribe — create a Stripe Checkout session for the web Pro subscription
router.post('/subscribe', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();

    // Don't let already-active subscribers start a new checkout
    const feePercent = await getFeePercent(req.user.id, client);
    if (feePercent === 0) {
      return res.json({ already_subscribed: true });
    }

    const customerId = await getOrCreateStripeCustomer(req.user.id, req.user.handle, client);
    const baseUrl = process.env.CORS_ORIGIN;

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Prosaurus Pro',
            description: 'Waives the 5% platform fee on all artwork sales'
          },
          unit_amount: 399,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      success_url: `${baseUrl}/collections/payment-setup?stripe=subscribed`,
      cancel_url:  `${baseUrl}/collections/payment-setup`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Failed to create subscribe session:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/billing/portal — Stripe Customer Portal (manage/cancel web subscription)
router.post('/portal', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const existing = await client.query(
      'SELECT stripe_customer_id FROM user_stripe_customers WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'No billing account found' });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: existing.rows[0].stripe_customer_id,
      return_url: `${process.env.CORS_ORIGIN}/collections/payment-setup`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Failed to create portal session:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// ─── Stripe Connect routes ───────────────────────────────────────────────────

// GET /api/billing/connect/status
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

    if (onboarding_complete) {
      return res.json({ status: 'active', stripe_account_id });
    }

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
      const account = await getStripe().accounts.create({ type: 'express' });
      stripeAccountId = account.id;
      await client.query(
        'INSERT INTO user_stripe_connect (user_id, stripe_account_id) VALUES ($1, $2)',
        [req.user.id, stripeAccountId]
      );
    } else {
      stripeAccountId = result.rows[0].stripe_account_id;
      if (result.rows[0].onboarding_complete) {
        return res.json({ status: 'active' });
      }
    }

    const accountLink = await getStripe().accountLinks.create({
      account: stripeAccountId,
      refresh_url: REFRESH_URL,
      return_url:  RETURN_URL,
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

// ─── Stripe webhook (mounted in index.js before express.json) ────────────────

async function handleStripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Acknowledge immediately — Stripe retries on non-2xx
  res.status(200).end();

  const data = event.data.object;
  let client;

  try {
    if (event.type === 'checkout.session.completed' && data.mode === 'subscription') {
      // New web subscription purchased
      const customerId   = data.customer;
      const subscriptionId = data.subscription;

      const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
      const expiresAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;

      client = await getClient();
      const customerRow = await client.query(
        'SELECT user_id FROM user_stripe_customers WHERE stripe_customer_id = $1',
        [customerId]
      );
      if (customerRow.rowCount === 0) return;

      const userId = customerRow.rows[0].user_id;
      await client.query(
        `INSERT INTO user_subscriptions
           (user_id, platform, platform_subscription_id, status, expires_at)
         VALUES ($1, 'stripe', $2, 'active', $3)
         ON DUPLICATE KEY UPDATE
           platform = 'stripe',
           platform_subscription_id = $2,
           status = 'active',
           expires_at = $3,
           updated_at = NOW()`,
        [userId, subscriptionId, expiresAt]
      );
    }

    else if (event.type === 'customer.subscription.updated') {
      const stripeStatus = data.status;
      const statusMap = {
        active:               'active',
        trialing:             'active',
        past_due:             'grace_period',
        canceled:             'cancelled',
        unpaid:               'cancelled',
        incomplete:           'cancelled',
        incomplete_expired:   'expired',
        paused:               'cancelled'
      };
      const newStatus = statusMap[stripeStatus] || 'expired';
      const expiresAt = data.current_period_end
        ? new Date(data.current_period_end * 1000)
        : null;

      client = await getClient();
      await client.query(
        `UPDATE user_subscriptions
         SET status = $1, expires_at = $2, updated_at = NOW()
         WHERE platform_subscription_id = $3 AND platform = 'stripe'`,
        [newStatus, expiresAt, data.id]
      );
    }

    else if (event.type === 'customer.subscription.deleted') {
      const expiresAt = data.current_period_end
        ? new Date(data.current_period_end * 1000)
        : null;

      client = await getClient();
      await client.query(
        `UPDATE user_subscriptions
         SET status = 'expired', expires_at = $1, updated_at = NOW()
         WHERE platform_subscription_id = $2 AND platform = 'stripe'`,
        [expiresAt, data.id]
      );
    }
  } catch (err) {
    console.error('Stripe webhook processing error:', err);
  } finally {
    if (client) client.release();
  }
}

module.exports = router;
module.exports.handleStripeWebhook = handleStripeWebhook;
