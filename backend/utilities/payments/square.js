// Square adapter -- implements the common PaymentProcessor shape (see
// docs/multi-processor-payments-architecture.md) over the existing
// utilities/square.js / utilities/squareConnect.js / utilities/token-crypto.js code.
// This file is a pure extraction from routes/billing.js and routes/storefront.js --
// no behavior change from what those routes did inline before this refactor.

const crypto = require('crypto');
const { SquareError } = require('square');
const { getSquare, getSquareClientForToken } = require('../square');
const { getValidAccessToken, checkConnectionStatus: checkSquareConnectionStatus } = require('../squareConnect');
const { ProcessorAuthError } = require('./errors');

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

// Get or create a Square customer ID for this user. user_payment_customers has one row
// per user_id+processor -- a stale row for this user under a different processor is
// untouched, and a stale Square row (e.g. sandbox->production switch, 404 from Square)
// is discarded and recreated.
async function getOrCreateCustomer(userId, handle, client) {
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

// paymentToken here is what routes/billing.js calls a "sourceId" -- a card tokenized
// client-side via the Square Web Payments SDK.
async function createSubscription({ customerId, paymentToken }) {
  const { card } = await getSquare().cards.create({
    idempotencyKey: crypto.randomUUID(),
    sourceId: paymentToken,
    card: { customerId }
  });

  const { subscription } = await getSquare().subscriptions.create({
    idempotencyKey: crypto.randomUUID(),
    locationId: process.env.SQUARE_LOCATION_ID,
    planVariationId: process.env.SQUARE_PRO_PLAN_VARIATION_ID,
    customerId,
    cardId: card.id
  });

  return { subscriptionId: subscription.id, status: subscription.status };
}

// Square schedules cancellation for the end of the current billing period rather than
// terminating immediately -- caller sets expires_at to this and leaves status as-is,
// matching how Apple/Google subscriptions already represent "access until a future
// date" in the same table.
async function cancelSubscription(subscriptionId) {
  const { subscription } = await getSquare().subscriptions.cancel({ subscriptionId });
  const expiresAt = subscription.chargedThroughDate || subscription.canceledDate || null;
  return { expiresAt };
}

async function updatePaymentMethod({ subscriptionId, customerId, paymentToken }) {
  const { subscription: currentSub } = await getSquare().subscriptions.get({ subscriptionId });
  const oldCardId = currentSub.cardId;

  const { card: newCard } = await getSquare().cards.create({
    idempotencyKey: crypto.randomUUID(),
    sourceId: paymentToken,
    card: { customerId }
  });

  await getSquare().subscriptions.update({
    subscriptionId,
    subscription: { cardId: newCard.id }
  });

  // Best-effort cleanup -- don't fail the request over a stale card that couldn't be
  // disabled (e.g. already removed).
  if (oldCardId && oldCardId !== newCard.id) {
    await getSquare().cards.disable({ cardId: oldCardId }).catch(() => {});
  }
}

function getConnectAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APPLICATION_ID,
    scope: SQUARE_OAUTH_SCOPES.join(' '),
    session: 'false',
    state
  });
  return `${SQUARE_OAUTH_BASE_URL}/oauth2/authorize?${params.toString()}`;
}

async function exchangeConnectCode(code) {
  const tokenResponse = await getSquare().oAuth.obtainToken({
    clientId: process.env.SQUARE_APPLICATION_ID,
    clientSecret: process.env.SQUARE_APPLICATION_SECRET,
    code,
    grantType: 'authorization_code'
  });

  const { accessToken, refreshToken, expiresAt, merchantId } = tokenResponse;
  return { accountId: merchantId, accessToken, refreshToken, expiresAt };
}

async function checkConnectionStatus(userId) {
  return checkSquareConnectionStatus(userId);
}

// Must run with the SELLER's own OAuth token, not the platform's -- Square identifies
// which merchant account receives the funds (minus the app fee) from whichever access
// token makes the call. location_id is the seller's own location too, fetched via
// their Merchant profile's mainLocationId.
async function createPayment({ sellerUserId, sellerAccountId, amountCents, feeCents, paymentToken, referenceId }) {
  try {
    const { accessToken } = await getValidAccessToken(sellerUserId);
    const sellerClient = getSquareClientForToken(accessToken);

    const { merchant } = await sellerClient.merchants.get({ merchantId: sellerAccountId });
    const sellerLocationId = merchant.mainLocationId;

    const { payment } = await sellerClient.payments.create({
      sourceId: paymentToken,
      idempotencyKey: crypto.randomUUID(),
      amountMoney: { amount: BigInt(amountCents), currency: 'USD' },
      appFeeMoney: { amount: BigInt(feeCents), currency: 'USD' },
      locationId: sellerLocationId,
      autocomplete: true,
      referenceId: String(referenceId)
    });

    return { paymentId: payment.id, status: payment.status };
  } catch (err) {
    if (err instanceof SquareError && (err.statusCode === 401 || err.statusCode === 403)) {
      throw new ProcessorAuthError(`Square connection revoked for user ${sellerUserId}`);
    }
    throw err;
  }
}

async function verifyWebhookSignature(rawBody, headers) {
  const { WebhooksHelper } = require('square');
  return WebhooksHelper.verifySignature({
    requestBody: rawBody,
    signatureHeader: headers['x-square-hmacsha256-signature'],
    signatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    notificationUrl: process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
  });
}

// Scope is narrower than a full webhook could be: CreatePayment completes
// synchronously in the checkout endpoint, so there's no payment-succeeded/failed
// equivalent needed here. subscription.updated is the one genuinely necessary gap --
// Square bills renewals automatically and retries/pauses/cancels on its own schedule.
async function handleWebhookEvent(event, client) {
  if (event.type !== 'subscription.updated') return;
  const subscription = event.data?.object?.subscription;
  if (!subscription) return;

  // PAUSED (e.g. card decline mid-retry) loses Pro access immediately but isn't a full
  // cancellation -- 'grace_period' is the existing status value for this. ACTIVE clears
  // any previously scheduled expiration (e.g. a dashboard-side resume).
  // CANCELED/DEACTIVATED/COMPLETED: leave status='active' and set expires_at to the
  // paid-through date, same as cancelSubscription() -- covers cancellation initiated
  // outside our own /cancel endpoint (e.g. directly in the Square merchant dashboard).
  let status = 'active';
  let expiresAt = null;
  if (subscription.status === 'PAUSED') {
    status = 'grace_period';
  } else if (['CANCELED', 'DEACTIVATED', 'COMPLETED'].includes(subscription.status)) {
    expiresAt = subscription.chargedThroughDate || subscription.canceledDate || new Date();
  }

  await client.query(
    `UPDATE user_subscriptions SET status = $1, expires_at = $2, updated_at = NOW()
     WHERE platform_subscription_id = $3 AND platform = 'square'`,
    [status, expiresAt, subscription.id]
  );
}

module.exports = {
  name: 'square',
  displayName: 'Square',
  getOrCreateCustomer,
  createSubscription,
  cancelSubscription,
  updatePaymentMethod,
  getConnectAuthorizeUrl,
  exchangeConnectCode,
  checkConnectionStatus,
  createPayment,
  verifyWebhookSignature,
  handleWebhookEvent
};
