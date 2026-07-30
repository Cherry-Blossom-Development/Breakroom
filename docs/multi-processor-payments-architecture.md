# Multi-Processor Payments Architecture

**Status**: Design, not yet implemented.
**Created**: 2026-07-30
**Owner**: Dallas

## Background

Square is now the sole payment processor (see `docs/stripe-to-square-migration.md`),
having replaced Stripe after Stripe cut off processing for this account with no warning.
That single-point-of-failure experience is the reason for this doc: rather than being
one processor's outage away from another full-scramble migration, the goal is to let
**buyers and sellers choose among multiple processors**, starting with adding PayPal
alongside Square, and structured so a third/fourth processor is a bounded, mechanical
addition rather than another repo-wide migration.

This is web-only, same as the Stripe→Square migration — App Store/Play Store in-app
billing (Apple StoreKit, Google Play Billing) are separate systems, unaffected.

## What already works in our favor

The Square migration's DB decision (`docs/stripe-to-square-migration.md`, "Open
decisions" #2) already renamed everything to processor-agnostic names: `processor` /
`payment_processor` ENUM columns, `user_payment_connect` / `user_payment_customers`
(not `user_square_*`), `orders.payment_intent_id` (not `square_payment_intent_id`).
Adding a processor to the DB layer is therefore just **adding a new enum value** —
no new tables needed for the same shape of data Square already uses (OAuth
access/refresh tokens, a processor customer ID, a processor account ID).

What's *not* generic yet: the **route handlers**. `backend/routes/billing.js` and
`backend/routes/storefront.js` currently hardcode `processor = 'square'` and call the
Square SDK directly inline (e.g. `storefront.js` line ~338 queries
`WHERE processor = 'square'`, line ~362 inserts `'square'` literally, and the checkout
handler calls `getSquareClientForToken`/`sellerClient.payments.create` directly). This
doc's core proposal is extracting that into a common interface so the routes become
processor-dispatching instead of processor-specific.

## Design: a `PaymentProcessor` interface + registry

New directory `backend/utilities/payments/`:

```
backend/utilities/payments/
  index.js          — registry: getProcessor(name), listEnabledProcessors()
  square.js         — Square implementation of the interface (wraps existing
                       utilities/square.js + squareConnect.js — those files don't move,
                       this is a thin adapter over them)
  paypal.js         — PayPal implementation (new)
  types.js          — JSDoc typedefs for the interface shape (this is a JS codebase,
                       no TS — JSDoc gives editor hints without a build-step change)
```

Every processor module implements the same shape:

```js
{
  name: 'square' | 'paypal',           // matches the DB enum value exactly
  displayName: 'Square' | 'PayPal',    // for UI

  // Customers (Pro subscription billing)
  async getOrCreateCustomer(userId, handle, email, client) -> processorCustomerId
  async createSubscription({ customerId, paymentToken }) -> { subscriptionId, status }
  async cancelSubscription(subscriptionId) -> { expiresAt }
  async updatePaymentMethod({ subscriptionId, customerId, paymentToken }) -> void

  // Connect (seller payouts)
  getConnectAuthorizeUrl(state) -> url
  async exchangeConnectCode(code) -> { accountId, accessToken, refreshToken, expiresAt }
  async checkConnectionStatus(userId) -> 'active' | 'pending' | 'not_connected'

  // Storefront checkout
  async createPayment({ sellerUserId, sellerAccountId, amountCents, feeCents, paymentToken }) 
       -> { paymentId, status }

  // Webhooks (each processor still gets its own mounted route + signature scheme --
  // these are NOT unified into one endpoint, just a common dispatch shape once verified)
  async verifyWebhookSignature(rawBody, headers) -> boolean
  async handleWebhookEvent(event, client) -> void
}
```

`paymentToken` is the generic name for "whatever the client-side SDK produced" — Square
calls it a `sourceId` (from Web Payments SDK tokenization), PayPal's equivalent is an
order/subscription approval ID from its JS SDK. The interface doesn't care which; each
processor module knows how to use its own.

### Route changes

`billing.js`/`storefront.js` handlers become thin dispatchers:

```js
router.post('/subscribe', authenticate, async (req, res) => {
  const { processor: processorName, paymentToken } = req.body;
  const processor = getProcessor(processorName); // throws/400s on unknown/disabled name
  const client = await getClient();
  const customerId = await processor.getOrCreateCustomer(req.user.id, req.user.handle, email, client);
  const { subscriptionId, status } = await processor.createSubscription({ customerId, paymentToken });
  // ...same upsert into user_subscriptions, just platform = processorName instead of a
  // hardcoded 'square' literal
});
```

Same pattern for `/cancel`, `/update-payment-method`, `/connect/start`,
`/connect/callback`, and the storefront checkout endpoint. The SQL stays almost
identical — it's already using the generic `processor`/`platform` columns — just swap
the hardcoded `'square'` literals for the `processorName` variable.

**A seller can connect more than one processor.** `user_payment_connect` already has
`processor` as part of its identity, not a singleton per user — a seller can have both
a Square row and a PayPal row. At checkout, a buyer picks any processor the *specific
seller* has connected (not just any enabled processor platform-wide) — the storefront
checkout endpoint should list which processors work for a given item by checking which
rows exist in `user_payment_connect` for that seller.

### Frontend changes

`frontend/src/utilities/payments/` — one file per processor (`squarePayments.js`
already exists in roughly this shape, just move/rename; add `paypalPayments.js`
alongside it). A small `GET /api/billing/processors` endpoint returns which processors
are currently enabled platform-wide (derived from which `*_ACCESS_TOKEN`-shaped env vars
are actually set — same "enabled if configured" pattern already implicit in how Square
was added). The frontend uses that list to decide which payment buttons to render,
rather than hardcoding "Square only" — this is what makes adding a third processor
later not require a frontend code change to the *choice* UI, only a new SDK integration
file.

Checkout/subscribe UI becomes a small chooser (e.g. two buttons: "Pay with Square" /
"Pay with PayPal") instead of Square's card form being the only option.

### DB migration

One new additive migration, e.g. `046-paypal-payment-processor.sql`:

```sql
ALTER TABLE user_payment_connect   MODIFY COLUMN processor ENUM('stripe','square','paypal') NOT NULL;
ALTER TABLE user_payment_customers MODIFY COLUMN processor ENUM('stripe','square','paypal') NOT NULL;
ALTER TABLE orders                 MODIFY COLUMN payment_processor ENUM('stripe','square','paypal') NOT NULL DEFAULT 'stripe';
ALTER TABLE user_subscriptions     MODIFY COLUMN platform ENUM('google','apple','promo','stripe','square','paypal') NOT NULL;
```

No renames, no data migration — purely additive. Safe to run against production
immediately, independent of whether PayPal code exists yet.

## Real mechanical differences to design around (not just "swap the SDK")

Learned the hard way during the Square migration that "just replace the SDK calls"
undersells the actual work — same caution applies here. Known PayPal-specific gotchas
to plan for during implementation (verify current docs before building, these are
well-known PayPal API shapes but confirm specifics):

1. **Connect-equivalent uses a different trust/consent model.** Square Connect is
   OAuth (`oauth2/authorize` → `ObtainToken`). PayPal's marketplace/platform equivalent
   is **Partner Referrals API** (`POST /v2/customer/partner-referrals`) — conceptually
   similar (redirect seller to PayPal, they approve, you get an account reference back)
   but a different endpoint shape and a different concept of scopes (PayPal calls them
   "operations"/"products" — e.g. `PPCP` for the commerce platform, plus
   `EXPRESS_CHECKOUT` capabilities). The returned identifier is a PayPal **merchant ID**,
   analogous to Square's but obtained differently.
2. **Checkout fee-splitting is called with the platform's token, not the seller's.**
   This is the *opposite* of Square's model (Square requires the seller's own OAuth
   token to make the `CreatePayment` call; Stripe's old destination-charge model also
   used the platform's key). PayPal Orders API v2's `purchase_units[].payee` +
   `payment_instruction.platform_fees` are set by the **platform's own** API call,
   specifying which connected seller account receives the funds minus the fee. Worth
   double-checking against current docs before implementing — this determines whether
   `getValidAccessToken(sellerUserId)`-style per-seller token plumbing is even needed
   for checkout (it still is needed for Connect onboarding itself, just maybe not for
   the payment-capture call the way it is for Square).
3. **Subscriptions have a different buyer-approval shape.** PayPal Subscriptions API
   has its own Products + Billing Plans setup (roughly analogous to Square's Catalog
   Pro-plan setup script), but the buyer-facing flow is normally the **PayPal JS SDK's
   Buttons component with a `createSubscription`/`onApprove` callback** — closer to a
   popup/approval flow than Square Web Payments SDK's "tokenize a card, POST a
   `sourceId`" pattern. Don't assume the existing `{ sourceId }`-shaped request bodies
   port directly; the PayPal frontend integration will look different from Square's,
   not just reskinned.
4. **Webhook verification is API-call-based, not local HMAC.** Square's webhook
   verification is a local HMAC-SHA256 computation (`WebhooksHelper.verifySignature`).
   PayPal's is normally **`POST /v1/notifications/verify-webhook-signature`** — an API
   call back to PayPal per incoming webhook, not a local crypto check. Different
   latency/failure-mode profile (a PayPal API outage could affect webhook processing
   in a way a local HMAC check never could) — worth a short-circuit/retry policy
   decision when implementing.
5. **No hosted customer portal here either** — same situation as Square, PayPal doesn't
   provide a customer-facing "manage subscription" UI for platform integrations. The
   existing custom cancel/update-payment-method endpoints and modal UI (built for
   Square) are the right pattern to extend, not rebuild.

## Rollout approach: additive, not a cutover

Unlike Stripe→Square (a forced hard cutover because Stripe was already dead), adding
PayPal is purely additive — Square keeps working the entire time. Suggested order:

1. **Refactor Square behind the new interface first**, with zero behavior change
   (pure extraction — `getProcessor('square')` returns an adapter over the existing
   `utilities/square.js`/`squareConnect.js` code, routes call through it instead of
   inline). Verify nothing regresses (re-run the same sandbox smoke checks used during
   the Square migration) before adding PayPal at all. This de-risks the refactor
   separately from the new integration.
2. Add PayPal following the same phase structure that worked for Square (see
   `docs/paypal-integration-plan.md`): Connect/onboarding → Subscriptions →
   Storefront checkout → Frontend → Webhooks → DB migration → sandbox verification →
   production credentials.
3. No forced migration of existing Square subscribers/sellers — PayPal is offered
   as an additional choice going forward. Existing rows keep working unchanged.

## Open questions for whoever picks this up

- Should the seller onboarding UI *require* connecting at least one processor (current
  behavior, implicitly Square-only) or allow listing an item for sale before any
  processor is connected, with checkout simply hidden until one exists?
- Fee percent (`getFeePercent`/`getSellerFeePercent`, 0% Pro / 5% Free) is currently
  processor-agnostic business logic already — no change needed there regardless of how
  many processors exist.
- Do we want a "preferred processor" concept per seller (ordering when multiple are
  connected), or just show all connected options with no default ordering?
