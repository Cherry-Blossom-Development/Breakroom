// PayPal adapter -- implements the common PaymentProcessor shape (see
// docs/multi-processor-payments-architecture.md) for the parts that don't require
// PPCP partner approval yet (Phase 3: Subscriptions, per
// docs/paypal-integration-plan.md). Connect/checkout/webhooks are stubbed until that
// approval comes through -- see the "not yet available" errors below.
//
// Structural note vs. Square (confirmed against PayPal docs 2026-07-30, not guessed):
// PayPal Subscriptions have no equivalent to Square's "backend creates the
// subscription after a card is tokenized" flow. The buyer approves the subscription
// directly with PayPal via the JS SDK's Buttons component (createSubscription +
// onApprove), and the subscription already exists/is ACTIVE on PayPal's side by the
// time the frontend calls our backend. So `paymentToken` here carries the
// already-approved PayPal subscription ID, not a card token -- createSubscription's
// real job is to *confirm* that ID is genuine and active, not create anything.

const { paypalRequest, PayPalApiError } = require('../paypal');

// Deliberately NOT ProcessorAuthError -- that type signals "a previously-working
// seller connection just got revoked, clear the stale DB row" (see storefront.js's
// checkout catch block). Nothing has ever worked here to revoke, so a plain error
// (surfaced as a normal 4xx) is the correct signal, not the self-healing path.
function notYetAvailable() {
  const err = new Error('PayPal seller Connect/checkout is not yet available -- pending PPCP partner approval (see docs/paypal-integration-plan.md Phase 0/2/4).');
  err.statusCode = 400;
  return err;
}

// PayPal has no pre-created-customer concept for the Subscriptions flow the way Square
// does -- the payer is established during the buyer's own approval with PayPal.
// Intentionally a no-op; does not touch user_payment_customers.
async function getOrCreateCustomer() {
  return null;
}

// paymentToken carries the PayPal subscription ID the buyer already approved via the
// frontend's PayPal Buttons `onApprove` callback (see Phase 5 in the plan doc).
async function createSubscription({ paymentToken }) {
  if (!paymentToken) {
    const err = new Error('Missing PayPal subscription ID (paymentToken)');
    err.statusCode = 400;
    throw err;
  }

  let subscription;
  try {
    subscription = await paypalRequest('GET', `/v1/billing/subscriptions/${paymentToken}`);
  } catch (err) {
    // Any 4xx here means the ID we were handed doesn't resolve to a real, fetchable
    // PayPal subscription -- could be a genuine 404, or a 400 INVALID_PARAMETER_SYNTAX
    // if it's not even shaped like a PayPal subscription ID (confirmed via testing: a
    // malformed ID comes back as 400, not 404). Either way, normalize to a clean
    // client-facing message rather than leaking PayPal's raw error body (debug_id,
    // internal field names, etc.) straight through to our own API response.
    if (err instanceof PayPalApiError && err.statusCode >= 400 && err.statusCode < 500) {
      const notFound = new Error('PayPal subscription not found or invalid');
      notFound.statusCode = 400;
      throw notFound;
    }
    throw err;
  }

  if (subscription.plan_id !== process.env.PAYPAL_PRO_PLAN_ID) {
    const err = new Error('PayPal subscription does not match the expected plan');
    err.statusCode = 400;
    throw err;
  }

  if (subscription.status !== 'ACTIVE') {
    const err = new Error(`PayPal subscription is not active (status: ${subscription.status})`);
    err.statusCode = 400;
    throw err;
  }

  return { subscriptionId: subscription.id, status: subscription.status };
}

// Confirmed 2026-07-30: PayPal's cancel endpoint (POST .../cancel, 204 No Content) has
// no "cancel at period end" concept the way Square does -- the subscription moves to
// CANCELLED immediately. Unlike Square, there's no chargedThroughDate to fall back on,
// so expiresAt is "now" rather than a future date. NOTE: this immediate-cancellation
// behavior is documented PayPal behavior but has not yet been exercised against a real
// sandbox subscription (that requires a real buyer-approval flow first) -- treat as
// high-confidence but unverified until Phase 8 sandbox testing confirms it.
async function cancelSubscription(subscriptionId) {
  await paypalRequest('POST', `/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    reason: 'Cancelled by subscriber via Prosaurus'
  });
  return { expiresAt: new Date() };
}

// Confirmed 2026-07-30: PayPal has no API to swap a subscription's payment source.
// The only revise endpoint (POST .../revise) changes plan_id/quantity, nothing else.
// Changing payment method genuinely requires the buyer to re-approve (effectively a
// new subscription) -- this is a real UX difference from Square, not a gap to paper
// over. Surfacing a clear error here rather than silently no-op'ing; Phase 5 frontend
// work needs its own "cancel and resubscribe" story for PayPal instead of reusing
// Square's update-payment-method modal.
async function updatePaymentMethod() {
  const err = new Error('PayPal subscriptions do not support in-place payment method updates -- cancel and resubscribe instead.');
  err.statusCode = 400;
  throw err;
}

function getConnectAuthorizeUrl() {
  throw notYetAvailable();
}

async function exchangeConnectCode() {
  throw notYetAvailable();
}

async function checkConnectionStatus() {
  return 'not_connected';
}

async function createPayment() {
  throw notYetAvailable();
}

async function verifyWebhookSignature() {
  throw new Error('PayPal webhook handling not yet implemented (Phase 6, see docs/paypal-integration-plan.md).');
}

async function handleWebhookEvent() {
  throw new Error('PayPal webhook handling not yet implemented (Phase 6, see docs/paypal-integration-plan.md).');
}

module.exports = {
  name: 'paypal',
  displayName: 'PayPal',
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
