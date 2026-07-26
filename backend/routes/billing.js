const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { SquareError } = require('square');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { sendMail } = require('../utilities/aws-ses-email');
const tokenCrypto = require('../utilities/token-crypto');
const { getSquare } = require('../utilities/square');
const { checkConnectionStatus } = require('../utilities/squareConnect');

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

// Get or create a Square customer ID for this user. Note: user_payment_customers has a
// single row per user_id (not per user_id+processor) -- consistent with the hard-cutover
// decision, a stale Stripe-processor row for this user (if any) gets overwritten by the
// upsert below rather than causing a duplicate-key conflict.
async function getOrCreateSquareCustomer(userId, handle, client) {
  const existing = await client.query(
    'SELECT processor_customer_id FROM user_payment_customers WHERE user_id = $1 AND processor = $2',
    [userId, 'square']
  );

  if (existing.rowCount > 0) {
    const customerId = existing.rows[0].processor_customer_id;
    try {
      await getSquare().customers.get({ customerId });
      return customerId;
    } catch (err) {
      if (err instanceof SquareError && err.statusCode === 404) {
        // Stale ID (e.g. sandbox→production switch) — discard it and fall through to create
        await client.query('DELETE FROM user_payment_customers WHERE user_id = $1 AND processor = $2', [userId, 'square']);
      } else {
        throw err;
      }
    }
  }

  const userResult = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = userResult.rows[0]?.email;

  const { customer } = await getSquare().customers.create({
    emailAddress: email,
    nickname: handle,
    referenceId: String(userId)
  });

  await client.query(
    `INSERT INTO user_payment_customers (user_id, processor, processor_customer_id)
     VALUES ($1, 'square', $2)
     ON DUPLICATE KEY UPDATE processor = 'square', processor_customer_id = VALUES(processor_customer_id)`,
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

// POST /api/billing/subscribe — create the Square Pro subscription for this user.
// Unlike Stripe Checkout Sessions, Square has no hosted checkout page: the frontend must
// tokenize the card first (Web Payments SDK, Phase 4) and pass the resulting `sourceId`
// here. Response is the resulting subscription status directly, not a redirect `url`.
router.post('/subscribe', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();

    // Don't let already-active subscribers start a new subscription
    const feePercent = await getFeePercent(req.user.id, client);
    if (feePercent === 0) {
      return res.json({ already_subscribed: true });
    }

    const { sourceId } = req.body;
    if (!sourceId) {
      return res.status(400).json({ message: 'Missing sourceId (tokenized card)' });
    }

    const customerId = await getOrCreateSquareCustomer(req.user.id, req.user.handle, client);

    const { card } = await getSquare().cards.create({
      idempotencyKey: crypto.randomUUID(),
      sourceId,
      card: { customerId }
    });

    const { subscription } = await getSquare().subscriptions.create({
      idempotencyKey: crypto.randomUUID(),
      locationId: process.env.SQUARE_LOCATION_ID,
      planVariationId: process.env.SQUARE_PRO_PLAN_VARIATION_ID,
      customerId,
      cardId: card.id
    });

    await client.query(
      `INSERT INTO user_subscriptions (user_id, platform, platform_subscription_id, status, expires_at)
       VALUES ($1, 'square', $2, 'active', NULL)
       ON DUPLICATE KEY UPDATE
         platform = 'square',
         platform_subscription_id = VALUES(platform_subscription_id),
         status = 'active',
         expires_at = NULL`,
      [req.user.id, subscription.id]
    );

    res.json({ subscribed: true, status: subscription.status });
  } catch (err) {
    console.error('Failed to create Square subscription:', err);
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

// ─── Square Connect (OAuth) routes ───────────────────────────────────────────

const SQUARE_OAUTH_BASE_URL = process.env.SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

// PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS is required specifically for CreatePayment calls
// that include an app_fee_money split (our platform-commission model) -- PAYMENTS_WRITE
// alone is not sufficient for that. See docs/stripe-to-square-migration.md.
const SQUARE_OAUTH_SCOPES = [
  'PAYMENTS_WRITE',
  'PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS',
  'MERCHANT_PROFILE_READ'
];

// GET /api/billing/connect/status
router.get('/connect/status', authenticate, async (req, res) => {
  try {
    const status = await checkConnectionStatus(req.user.id);
    res.json({ status });
  } catch (err) {
    console.error('Failed to get connect status:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/billing/connect/start
// Generates the Square OAuth authorize URL for the frontend to redirect the seller to.
// The actual account linking happens in the GET /connect/callback endpoint below, which
// exchanges the returned `code` for access/refresh tokens.
router.post('/connect/start', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT onboarding_complete FROM user_payment_connect WHERE user_id = $1 AND processor = $2',
      [req.user.id, 'square']
    );

    if (result.rowCount > 0 && result.rows[0].onboarding_complete) {
      return res.json({ status: 'active' });
    }

    // Short-lived signed state param: identifies the user on callback and prevents CSRF
    // (Square's redirect echoes this back verbatim).
    const state = jwt.sign({ userId: req.user.id }, SECRET_KEY, { expiresIn: '10m' });

    const params = new URLSearchParams({
      client_id: process.env.SQUARE_APPLICATION_ID,
      scope: SQUARE_OAUTH_SCOPES.join(' '),
      session: 'false',
      state
    });

    res.json({ url: `${SQUARE_OAUTH_BASE_URL}/oauth2/authorize?${params.toString()}` });
  } catch (err) {
    console.error('Failed to start Square connect:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/billing/connect/callback
// Square redirects the seller's browser here after they approve (or deny) access. Not
// behind `authenticate` — the state param (signed in /connect/start) is what identifies
// the user, since this is a raw browser redirect from squareup.com, not an API call from
// our own frontend.
router.get('/connect/callback', async (req, res) => {
  const redirectBase = `${process.env.CORS_ORIGIN}/collections/payment-setup`;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${redirectBase}?square=denied`);
  }

  let userId;
  try {
    userId = jwt.verify(state, SECRET_KEY).userId;
  } catch (err) {
    return res.redirect(`${redirectBase}?square=error`);
  }

  let client;
  try {
    const tokenResponse = await getSquare().oAuth.obtainToken({
      clientId: process.env.SQUARE_APPLICATION_ID,
      clientSecret: process.env.SQUARE_APPLICATION_SECRET,
      code,
      grantType: 'authorization_code'
    });

    const { accessToken, refreshToken, expiresAt, merchantId } = tokenResponse;

    client = await getClient();
    await client.query(
      `INSERT INTO user_payment_connect
         (user_id, processor, processor_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, onboarding_complete)
       VALUES ($1, 'square', $2, $3, $4, $5, 1)
       ON DUPLICATE KEY UPDATE
         processor = 'square',
         processor_account_id = VALUES(processor_account_id),
         access_token_encrypted = VALUES(access_token_encrypted),
         refresh_token_encrypted = VALUES(refresh_token_encrypted),
         token_expires_at = VALUES(token_expires_at),
         onboarding_complete = 1`,
      [
        userId,
        merchantId,
        tokenCrypto.encrypt(accessToken),
        tokenCrypto.encrypt(refreshToken),
        new Date(expiresAt)
      ]
    );

    // Square OAuth success implies the seller already has a working Square account
    // capable of accepting payments (unlike Stripe Express, there's no separate identity-
    // verification step exposed here) -- so onboarding_complete = 1 immediately. The
    // TODO on GET /connect/status still applies: a real MERCHANT_PROFILE_READ check would
    // be a stronger source of truth than trusting this assumption.
    res.redirect(`${redirectBase}?square=complete`);
  } catch (err) {
    console.error('Square OAuth callback failed:', err);
    res.redirect(`${redirectBase}?square=error`);
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

    else if (event.type === 'payment_intent.succeeded') {
      client = await getClient();
      const orderResult = await client.query(
        `SELECT o.*, ci.name AS item_name,
                u.email AS seller_email, u.first_name AS seller_first
         FROM orders o
         JOIN collection_items ci ON o.collection_item_id = ci.id
         JOIN users u ON o.seller_user_id = u.id
         WHERE o.stripe_payment_intent_id = $1`,
        [data.id]
      );
      if (orderResult.rowCount === 0) return;
      const order = orderResult.rows[0];

      await client.query(
        `UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1`,
        [order.id]
      );
      await client.query(
        `UPDATE collection_items SET is_available = 0 WHERE id = $1`,
        [order.collection_item_id]
      );

      const fmt = cents => `$${(cents / 100).toFixed(2)}`;
      const addr = `${order.ship_to_address1}${order.ship_to_address2 ? ', ' + order.ship_to_address2 : ''}, ${order.ship_to_city}, ${order.ship_to_state} ${order.ship_to_zip}, ${order.ship_to_country}`;

      await sendMail(
        order.seller_email,
        'noreply@prosaurus.com',
        `New order: ${order.item_name}`,
        `<p>Hi ${order.seller_first || 'there'},</p>
         <p>You have a new order on Prosaurus!</p>
         <table style="border-collapse:collapse;width:100%;max-width:480px">
           <tr><td style="padding:6px 0;color:#666">Item</td><td><strong>${order.item_name}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Amount</td><td>${fmt(order.item_price_cents)} + ${fmt(order.shipping_cost_cents)} shipping</td></tr>
           <tr><td style="padding:6px 0;color:#666">Buyer</td><td>${order.buyer_name} &lt;${order.buyer_email}&gt;</td></tr>
           <tr><td style="padding:6px 0;color:#666">Ship to</td><td>${order.ship_to_name}<br>${addr}</td></tr>
         </table>
         <p>Log in to <a href="https://www.prosaurus.com/collections/orders">Prosaurus</a> to manage this order.</p>
         <p>— Prosaurus</p>`
      );

      await sendMail(
        order.buyer_email,
        'noreply@prosaurus.com',
        `Order confirmed: ${order.item_name}`,
        `<p>Hi ${order.buyer_name},</p>
         <p>Your order has been confirmed. Here's a summary:</p>
         <table style="border-collapse:collapse;width:100%;max-width:480px">
           <tr><td style="padding:6px 0;color:#666">Item</td><td><strong>${order.item_name}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Item price</td><td>${fmt(order.item_price_cents)}</td></tr>
           <tr><td style="padding:6px 0;color:#666">Shipping</td><td>${fmt(order.shipping_cost_cents)}</td></tr>
           <tr><td style="padding:6px 0;color:#666;font-weight:bold">Total</td><td><strong>${fmt(order.total_cents)}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Ship to</td><td>${order.ship_to_name}<br>${addr}</td></tr>
         </table>
         <p>The seller will ship your item and you'll receive a tracking number by email.</p>
         <p>— Prosaurus</p>`
      );
    }

    else if (event.type === 'payment_intent.payment_failed') {
      client = await getClient();
      await client.query(
        `UPDATE orders SET status = 'cancelled', updated_at = NOW()
         WHERE stripe_payment_intent_id = $1 AND status = 'pending_payment'`,
        [data.id]
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
