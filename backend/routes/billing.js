const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const tokenCrypto = require('../utilities/token-crypto');
const { getProcessor } = require('../utilities/payments');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

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

// POST /api/billing/subscribe — create a Pro subscription for this user via the
// chosen processor (defaults to 'square' -- the frontend doesn't send `processor` yet,
// only Square exists as an option so far). The frontend must tokenize the card client-
// side first and pass the resulting token as `sourceId` (kept as the field name the
// frontend already sends -- Square calls this a "source id"). Response is the
// resulting subscription status directly, not a redirect `url` (no processor here has
// a hosted checkout page).
router.post('/subscribe', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();

    // Don't let already-active subscribers start a new subscription
    const feePercent = await getFeePercent(req.user.id, client);
    if (feePercent === 0) {
      return res.json({ already_subscribed: true });
    }

    const { sourceId, processor: processorName = 'square' } = req.body || {};
    if (!sourceId) {
      return res.status(400).json({ message: 'Missing sourceId (tokenized card)' });
    }

    const processor = getProcessor(processorName);
    const customerId = await processor.getOrCreateCustomer(req.user.id, req.user.handle, client);
    const { subscriptionId, status } = await processor.createSubscription({ customerId, paymentToken: sourceId });

    await client.query(
      `INSERT INTO user_subscriptions (user_id, platform, platform_subscription_id, status, expires_at)
       VALUES ($1, $2, $3, 'active', NULL)
       ON DUPLICATE KEY UPDATE
         platform = $2,
         platform_subscription_id = VALUES(platform_subscription_id),
         status = 'active',
         expires_at = NULL`,
      [req.user.id, processorName, subscriptionId]
    );

    res.json({ subscribed: true, status });
  } catch (err) {
    console.error('Failed to create subscription:', err);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// Square has no hosted Customer Portal equivalent to Stripe's billingPortal, so "manage
// subscription" becomes two custom endpoints instead of one portal redirect.

// Resolves the processor for this user's current subscription row, or null if they
// have none / it's not processor-backed (e.g. platform is 'apple'/'google'/'promo',
// which aren't managed through these endpoints at all).
function resolveSubscriptionProcessor(row) {
  if (!row) return null;
  try {
    return getProcessor(row.platform);
  } catch {
    return null;
  }
}

// POST /api/billing/cancel — cancel the user's subscription via whichever processor
// it was created with.
router.post('/cancel', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT platform, platform_subscription_id FROM user_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    const row = result.rows[0];
    const processor = resolveSubscriptionProcessor(row);
    if (!processor) {
      return res.status(404).json({ message: 'No active subscription found' });
    }

    const { expiresAt } = await processor.cancelSubscription(row.platform_subscription_id);

    await client.query(
      `UPDATE user_subscriptions SET expires_at = $1 WHERE user_id = $2 AND platform = $3`,
      [expiresAt, req.user.id, row.platform]
    );

    res.json({ cancelled: true, expires_at: expiresAt });
  } catch (err) {
    console.error('Failed to cancel subscription:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/billing/update-payment-method — swap the payment method charged for the
// subscription. Accepts { sourceId } (a freshly tokenized card from the frontend),
// same field name /subscribe uses.
router.post('/update-payment-method', authenticate, async (req, res) => {
  let client;
  try {
    const { sourceId } = req.body || {};
    if (!sourceId) {
      return res.status(400).json({ message: 'Missing sourceId (tokenized card)' });
    }

    client = await getClient();
    const subResult = await client.query(
      `SELECT platform, platform_subscription_id FROM user_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    const subRow = subResult.rows[0];
    const processor = resolveSubscriptionProcessor(subRow);
    if (!processor) {
      return res.status(404).json({ message: 'No active subscription found' });
    }

    const custResult = await client.query(
      `SELECT processor_customer_id FROM user_payment_customers WHERE user_id = $1 AND processor = $2`,
      [req.user.id, processor.name]
    );
    if (custResult.rowCount === 0) {
      return res.status(404).json({ message: 'No active subscription found' });
    }

    await processor.updatePaymentMethod({
      subscriptionId: subRow.platform_subscription_id,
      customerId: custResult.rows[0].processor_customer_id,
      paymentToken: sourceId
    });

    res.json({ updated: true });
  } catch (err) {
    console.error('Failed to update payment method:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// ─── Payment processor Connect (OAuth-style seller onboarding) routes ────────
// Processor-agnostic dispatch -- see docs/multi-processor-payments-architecture.md.
// `processor` defaults to 'square' since that's the only one the frontend sends today;
// a seller can have a connected row per processor (user_payment_connect's uniqueness
// is on user_id+processor, not just user_id).

// GET /api/billing/connect/status?processor=square
router.get('/connect/status', authenticate, async (req, res) => {
  try {
    const processor = getProcessor(req.query.processor || 'square');
    const status = await processor.checkConnectionStatus(req.user.id);
    res.json({ status });
  } catch (err) {
    console.error('Failed to get connect status:', err);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Server error' });
  }
});

// POST /api/billing/connect/start
// Generates the processor's OAuth-style authorize URL for the frontend to redirect the
// seller to. The actual account linking happens in the GET /connect/callback endpoint
// below, which exchanges the returned `code` for access/refresh tokens.
router.post('/connect/start', authenticate, async (req, res) => {
  let client;
  try {
    const processorName = (req.body || {}).processor || 'square';
    const processor = getProcessor(processorName);

    client = await getClient();
    const result = await client.query(
      'SELECT onboarding_complete FROM user_payment_connect WHERE user_id = $1 AND processor = $2',
      [req.user.id, processorName]
    );

    if (result.rowCount > 0 && result.rows[0].onboarding_complete) {
      return res.json({ status: 'active' });
    }

    // Short-lived signed state param: identifies the user (and which processor) on
    // callback, and prevents CSRF (the processor's redirect echoes it back verbatim).
    const state = jwt.sign({ userId: req.user.id, processor: processorName }, SECRET_KEY, { expiresIn: '10m' });

    res.json({ url: processor.getConnectAuthorizeUrl(state) });
  } catch (err) {
    console.error('Failed to start connect:', err);
    res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/billing/connect/callback
// The processor redirects the seller's browser here after they approve (or deny)
// access. Not behind `authenticate` — the state param (signed in /connect/start) is
// what identifies the user, since this is a raw browser redirect, not an API call from
// our own frontend. Redirect query param stays `?square=...` regardless of which
// processor was used -- the frontend only knows about Square so far (Phase 5 of
// docs/paypal-integration-plan.md generalizes this once a processor chooser UI exists).
router.get('/connect/callback', async (req, res) => {
  const redirectBase = `${process.env.CORS_ORIGIN}/collections/payment-setup`;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${redirectBase}?square=denied`);
  }

  let userId, processorName;
  try {
    const payload = jwt.verify(state, SECRET_KEY);
    userId = payload.userId;
    processorName = payload.processor || 'square';
  } catch (err) {
    return res.redirect(`${redirectBase}?square=error`);
  }

  let client;
  try {
    const processor = getProcessor(processorName);
    const { accountId, accessToken, refreshToken, expiresAt } = await processor.exchangeConnectCode(code);

    client = await getClient();
    await client.query(
      `INSERT INTO user_payment_connect
         (user_id, processor, processor_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, onboarding_complete)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       ON DUPLICATE KEY UPDATE
         processor = $2,
         processor_account_id = VALUES(processor_account_id),
         access_token_encrypted = VALUES(access_token_encrypted),
         refresh_token_encrypted = VALUES(refresh_token_encrypted),
         token_expires_at = VALUES(token_expires_at),
         onboarding_complete = 1`,
      [
        userId,
        processorName,
        accountId,
        tokenCrypto.encrypt(accessToken),
        tokenCrypto.encrypt(refreshToken),
        new Date(expiresAt)
      ]
    );

    // OAuth success implies the seller already has a working account capable of
    // accepting payments -- so onboarding_complete = 1 immediately. The TODO on
    // GET /connect/status still applies: a real merchant-profile check is a stronger
    // source of truth than trusting this assumption (checkConnectionStatus does that).
    res.redirect(`${redirectBase}?square=complete`);
  } catch (err) {
    console.error('Connect callback failed:', err);
    res.redirect(`${redirectBase}?square=error`);
  } finally {
    if (client) client.release();
  }
});

// ─── Square webhook (mounted in index.js before express.json) ───────────────
//
// Scope is narrower than a full webhook could be: CreatePayment completes
// synchronously in the checkout endpoint (routes/storefront.js), so there's no
// payment-succeeded/failed equivalent needed here. subscription.updated is the one
// genuinely necessary gap: Square bills renewals automatically and retries/pauses/
// cancels on its own schedule, and without this handler a failed renewal would leave
// the local row at status='active' with expires_at=NULL forever (looking permanently
// subscribed). Thin wrapper now -- signature verification and event handling both live
// in the square processor adapter (utilities/payments/square.js) so a future PayPal
// webhook route can follow the identical shape.
async function handleSquareWebhook(req, res) {
  const rawBody = req.body.toString('utf8');
  const processor = getProcessor('square');

  let isValid;
  try {
    isValid = await processor.verifyWebhookSignature(rawBody, req.headers);
  } catch (err) {
    console.error('Square webhook signature verification error:', err.message);
    return res.status(500).end();
  }

  if (!isValid) {
    console.error('Square webhook signature verification failed');
    return res.status(401).end();
  }

  // Acknowledge immediately — Square retries on non-2xx
  res.status(200).end();

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('Square webhook: failed to parse body:', err.message);
    return;
  }

  let client;
  try {
    client = await getClient();
    await processor.handleWebhookEvent(event, client);
  } catch (err) {
    console.error('Square webhook processing error:', err);
  } finally {
    if (client) client.release();
  }
}

module.exports = router;
module.exports.handleSquareWebhook = handleSquareWebhook;
