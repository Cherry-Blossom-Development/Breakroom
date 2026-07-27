# Stripe → Square Payment Processing Migration

**Status**: NOT STARTED
**Started**: 2026-07-24 (planning only)
**Owner**: Dallas

## Background

Stripe has turned off payment processing for this account. Dallas has already tried to
resolve it directly with Stripe support and they are not budging — not worth further time
arguing with them. Decision: migrate all Stripe-related payment processing to **Square**.

This does **not** affect App Store / Play Store in-app billing (Apple StoreKit, Google
Play Billing) — those are separate systems and are out of scope for this migration
entirely. This is only about the web-side payment processing: Stripe Connect (artist/seller
payouts), the $3.99/mo Pro subscription, and one-off art/product purchases on the public
storefront.

**This repo (Breakroom: Vue frontend + Express backend) is where ~100% of the actual work
happens.** The Android and iPhone apps are thin clients that only call this backend's
`/api/billing/*` endpoints and open whatever URL the backend hands back — they have no
Stripe SDK, no publishable keys, and no Stripe-shaped data models beyond the literal string
`"stripe"` in one field. Each mobile app has its own much shorter migration doc:
- Android: `STRIPE_TO_SQUARE_MIGRATION.md` at the root of the Android repo
- iPhone: `stripe-to-square-migration.md` at the root of the iPhone repo

**Do not start the mobile app changes until this backend migration has shipped** the new
`platform` value (`"square"` instead of/alongside `"stripe"`) and the new endpoints are
live in production. The mobile changes are trivial (a string check, a hardcoded URL, some
UI copy) and should be done last, in whatever order is convenient, on whatever machine.

---

## Current State — where Stripe lives today

### Backend (`backend/routes/billing.js`, `backend/routes/storefront.js`)

**Connect / marketplace payouts** — `routes/billing.js` lines 208-322
- `GET /connect/status` (~L232): `stripe.accounts.retrieve()`, checks `details_submitted && charges_enabled`
- `POST /connect/start` (~L273-309): `stripe.accounts.create({type:'express'})` then `stripe.accountLinks.create({type:'account_onboarding'})`
- One-off purchase payment intents — `routes/storefront.js` L353-359: `stripe.paymentIntents.create({application_fee_amount, transfer_data:{destination: stripeAccountId}})` (destination charges). Platform fee percent (0% Pro / 5% Free) computed in `getSellerFeePercent()` (L21-30).
- PI metadata updated post-order-insert (L385-387)

**Subscriptions (Pro tier, $3.99/mo)** — `routes/billing.js`
- `getOrCreateStripeCustomer()` (L57-95): `stripe.customers.retrieve/create`
- `POST /subscribe` (L130-179): `stripe.checkout.sessions.create({mode:'subscription', price_data:{unit_amount:399, recurring:{interval:'month'}}})` — redirect-based Stripe Checkout
- `POST /portal` (L182-206): `stripe.billingPortal.sessions.create()` — Stripe's hosted Customer Portal (cancel/manage/update card)

**One-off Checkout (Collections/Storefront)** — `routes/storefront.js` L287-402
- NOT Stripe Checkout Sessions — raw `paymentIntents.create()` + client-side Stripe Elements card element (embedded, not redirect)

**Webhooks** — `handleStripeWebhook()` in `routes/billing.js` L326-493, mounted in `index.js` L124 as `POST /api/billing/webhook` (raw body middleware, must run before `express.json()`). Verified via `stripe.webhooks.constructEvent()` + `STRIPE_WEBHOOK_SECRET`. Handles:
- `checkout.session.completed` (mode=subscription) — activates subscription
- `customer.subscription.updated` — maps Stripe status → internal status
- `customer.subscription.deleted` — expires subscription
- `payment_intent.succeeded` — marks order paid, sends buyer/seller emails
- `payment_intent.payment_failed` — cancels pending order
- No `account.updated` handler — Connect status is checked lazily via `accounts.retrieve` instead
- No refund handling anywhere in the codebase (`stripe.refunds.create` is not used)

**Env vars**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` (backend), `VITE_STRIPE_PUBLISHABLE_KEY` (frontend build). No API version pinned in code. `backend/package.json`: `"stripe": "^22.1.0"`.

### Frontend (`frontend/src/views/`)

- `@stripe/stripe-js: ^4.0.0` in `frontend/package.json`
- `CollectionsPaymentPage.vue` — Connect onboarding UI, Pro subscribe/portal buttons, redirects (`window.location = url`) to Stripe-hosted onboarding/checkout/portal URLs
- `PublicStorePage.vue` and `PublicCollectionPage.vue` — embedded Stripe Elements card element (`loadStripe`, `elements.create('card')`, `confirmCardPayment`) for buyer checkout on public storefronts, dynamically imports `@stripe/stripe-js`
- `ProfileBilling.vue`, `SessionsPage.vue`, `data/exploreFeatures.js`, `MarketingPage.vue` — marketing/fee-explanation copy only, no SDK calls

### Database (`data/migrations/`)

- `019-stripe-connect.sql`: `user_stripe_connect(user_id, stripe_account_id, onboarding_complete)`
- `022-stripe-web-subscription.sql`: adds `'stripe'` to `user_subscriptions.platform` ENUM; creates `user_stripe_customers(user_id, stripe_customer_id)`
- `010-subscriptions.sql`: `user_subscriptions(platform, platform_subscription_id, status, expires_at)` — already platform-agnostic (also used by Apple/Google IAP), just needs `'square'` added to the enum
- `024-orders.sql`: `orders.stripe_payment_intent_id`, `orders.stripe_connected_account_id`, `orders.platform_fee_cents`

---

## Target State — Square equivalents

| Stripe feature | Square equivalent | Notes / gotchas |
|---|---|---|
| Connect Express accounts (`accounts.create`, `accountLinks`) | **Square OAuth** (`GET /oauth2/authorize` → `ObtainToken`) | Returns `access_token` + `refresh_token` + `merchant_id`. **Square OAuth tokens expire and must be refreshed** — Stripe Connect doesn't require this (the platform secret key + destination account ID work indefinitely). This is genuinely new operational code: a refresh flow/job per connected seller, plus handling refresh failure (seller needs to re-auth). Scopes needed: `PAYMENTS_WRITE`, `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` (easy to miss — required specifically for the app-fee split, `PAYMENTS_WRITE` alone isn't enough), `MERCHANT_PROFILE_READ`. |
| Destination charges w/ `application_fee_amount` | `CreatePayment` with `app_fee_money` | Clean 1:1 mapping. Same "buyer pays, platform fee skimmed off top, rest to seller" model. |
| Subscriptions (Checkout Session, mode=subscription) | **Square Subscriptions API + Catalog API** | Must define the plan in Catalog first, then create/manage subscriptions against it. More setup than Stripe's inline `price_data`, but one-time setup cost. |
| Billing Portal (`billingPortal.sessions.create`) | **No equivalent exists.** | Square's subscription management is merchant-dashboard-facing, not customer-facing. Must build custom "Cancel Subscription" / "Update card" endpoint(s) + UI using the Subscriptions API directly. This is real new work, not a swap — budget real time for it. |
| Embedded Stripe Elements card form | **Square Web Payments SDK** | Direct replacement, similar embed model (`attach()` a card element, tokenize, send token to backend). |
| Webhooks (`checkout.session.completed`, `customer.subscription.updated/deleted`, `payment_intent.succeeded/payment_failed`) | **Square Webhooks** | Different event names, different payload shapes, different signature verification. Full rewrite of `handleStripeWebhook()`, not a port. |
| DB: `stripe_account_id`, `stripe_customer_id`, `stripe_payment_intent_id`, `platform` enum | Add Square-equivalent columns | `user_subscriptions.platform` enum just needs `'square'` added. The Stripe-specific ID columns (`user_stripe_connect.stripe_account_id`, `user_stripe_customers.stripe_customer_id`, `orders.stripe_payment_intent_id`, `orders.stripe_connected_account_id`) need Square-ID siblings — see "Open decision: DB approach" below. |

Reference docs (current as of this writing, verify current before implementing):
- OAuth: https://developer.squareup.com/docs/oauth-api/overview
- Payments/app fees: https://developer.squareup.com/docs/payments-api/take-payments-and-collect-fees
- Subscriptions: https://developer.squareup.com/docs/subscriptions-api/overview
- Webhooks: https://developer.squareup.com/reference/square/subscriptions-api/webhooks
- Web Payments SDK: https://developer.squareup.com/docs/web-payments/overview

---

## Open decisions

1. **Existing customers cutover strategy — DECIDED 2026-07-25: hard cutover, ASAP.**
   Confirmed Stripe processing is **fully dead** for this account already — not just new
   signups blocked, existing subscription renewals and seller payouts are not going
   through either. That means there is no "existing working Stripe" left to preserve, so
   dual-run has nothing to dual-run against. Implication: as soon as Phases 1-4 ship,
   pick a date and migrate everyone at once (existing Pro subscribers re-subscribe via
   Square, existing Connect sellers re-onboard via Square). No natural-lapse waiting
   period. **New follow-up need for Phase 5:** since existing subscribers' billing is
   already silently broken, plan a direct notice (email/in-app) telling them their Pro
   subscription needs to be re-activated on Square — don't rely on them noticing a failed
   charge on their own.

2. **DB approach — DECIDED 2026-07-25: generic processor-agnostic rename**, done as a
   single migration. Chosen because every call site touching these columns is already
   being rewritten for Square in Phases 1-3 anyway, so the marginal cost of renaming is
   low, and it avoids permanent Stripe-named-column debt / protects against ever needing
   a third processor. Implemented as `data/migrations/044-square-payment-processor.sql`
   (next open slot — repo was already up to migration 043, not 025 as originally
   guessed). Column plan:
   - `user_stripe_connect` → `user_payment_connect` — add `processor` ENUM('stripe','square'),
     rename `stripe_account_id` → `processor_account_id`
   - `user_stripe_customers` → `user_payment_customers` — add `processor` ENUM('stripe','square'),
     rename `stripe_customer_id` → `processor_customer_id`
   - `orders.stripe_payment_intent_id` → `orders.payment_intent_id`; add `orders.payment_processor` ENUM('stripe','square')
   - `orders.stripe_connected_account_id` → `orders.payment_connected_account_id`
   - `user_subscriptions.platform` — already processor-agnostic (shared with Apple/Google IAP), just add `'square'` to the enum
   - Existing rows: backfill `processor = 'stripe'` for all pre-migration rows

3. **Square developer account / production application — DONE 2026-07-25.** See Phase 0
   below; audience selected was "all Square sellers" (marketplace/platform).

---

## Task checklist

### Phase 0 — Prerequisites
- [x] Create/confirm Square Developer account and Application (audience: "all Square
      sellers" — marketplace/platform use case, matches the Connect model below)
- [x] Decide OAuth scopes needed — DECIDED 2026-07-25: `PAYMENTS_WRITE`,
      `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` (required specifically for the app-fee/
      commission split on CreatePayment — easy to miss, `PAYMENTS_WRITE` alone isn't
      enough), `MERCHANT_PROFILE_READ`. This scope set is only for the seller-onboarding
      OAuth flow; Pro subscription billing uses the platform's own Square account/token
      directly, no OAuth scopes needed there.
- [x] Decide cutover strategy and DB approach (see "Open decisions" above — both decided
      2026-07-25)
- [x] Get Square sandbox credentials into local `.env.local` for dev testing
      (`SQUARE_ENVIRONMENT`, `SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN`,
      `SQUARE_APPLICATION_SECRET`, `SQUARE_LOCATION_ID` — webhook signature key still
      pending, set up in Phase 3)
- [x] OAuth redirect URL registered in the dashboard
- [ ] Square production Application activation (`squareup.com/activation`) — not needed
      until Phase 5 cutover, sandbox is sufficient for Phases 1-4

### Phase 1 — Backend: Connect/OAuth (seller payouts)
- [x] Add Square SDK to `backend/package.json` — note: the npm package is now named
      `square` (v45.x), not `squareup` (that name is a deprecated stub). Uses
      `SquareClient` / `SquareEnvironment` from the package.
- [x] Migration 044 written and **run against breakroom_dev** — covers
      `user_payment_connect`, `user_payment_customers`,
      `orders.payment_intent_id`/`payment_processor`/`payment_connected_account_id`,
      `user_subscriptions.platform` enum add `'square'`.
      **Discovery while running this:** `breakroom_dev` was missing migrations 010, 018,
      019, 022, 024 entirely (commerce/storefront tables were apparently only ever built
      against production). Backfilled all five before running 044 — dev now has
      `user_subscriptions`, `collection_items`, and the renamed payment tables/columns.
      Other unrelated drift (migrations 012, 021, 023, 029, 030 also missing from dev) was
      left alone — out of scope for this migration.
      Old Stripe-shaped queries in `billing.js`/`storefront.js` now reference nonexistent
      columns until updated below (harmless — Stripe is already dead).
- [x] Implement OAuth authorize URL generation (replaces `POST /connect/start`) —
      `backend/routes/billing.js`, builds the `GET /oauth2/authorize` URL with
      `client_id`, scope list, and a signed short-lived JWT `state` param (identifies the
      user on callback + CSRF protection). `redirect_uri` omitted deliberately — Square
      falls back to the URL already registered in the dashboard when it's not passed.
- [x] Implement OAuth callback / token exchange endpoint — `GET /connect/callback` in
      `backend/routes/billing.js`. Verifies the `state` JWT (not the `authenticate`
      middleware — this is a raw browser redirect from squareup.com, no auth header/cookie
      to rely on), calls `oAuth.obtainToken()`, upserts `user_payment_connect` via
      `ON DUPLICATE KEY UPDATE` on the existing `user_id` unique key, then redirects to
      `/collections/payment-setup?square=complete|denied|error`.
      **New migration 045** (`data/migrations/045-square-connect-tokens.sql`, run against
      breakroom_dev) adds `access_token_encrypted`/`refresh_token_encrypted`/
      `token_expires_at` columns — Square OAuth requires storing these per-seller tokens,
      which Stripe Connect never needed (destination charges only needed the account id).
      **New encryption utility** `backend/utilities/token-crypto.js` (AES-256-GCM) encrypts
      both tokens at rest, keyed by a new `TOKEN_ENCRYPTION_KEY` env var — deliberately
      separate from `SECRET_KEY` (JWT signing is a different security domain). Verified
      with a rolled-back transaction against breakroom_dev: upsert + encrypt/decrypt
      round-trip both confirmed working.
      Sets `onboarding_complete = 1` immediately on successful token exchange — assumes
      Square OAuth success implies a working payments-capable account (Square doesn't
      expose a separate identity-verification step the way Stripe Express does). Same
      caveat as the `/connect/status` TODO above: a real `MERCHANT_PROFILE_READ` check
      would be more authoritative than this assumption.
- [x] Implement token refresh logic — `backend/utilities/squareConnect.js`,
      `getValidAccessToken(userId)`. Chose **lazy refresh-on-use** over a scheduled job:
      Connect payments only happen at checkout time, so a polling sweep across all
      connected sellers would mostly do nothing. Refreshes 1 day before the stored
      `token_expires_at` (`REFRESH_BUFFER_MS`). Also consolidated the Square client setup
      (previously inline in `billing.js`) into `backend/utilities/square.js` so
      `storefront.js` can reuse it in Phase 3 instead of a third copy-pasted lazy-init.
      Tested against breakroom_dev: fresh-token fast path (no refresh call) and the
      no-connected-account error path both verified; the actual `refresh_token` grant
      call wasn't exercised end-to-end (no real connected seller account exists yet to
      test against — that requires an actual OAuth approval in the browser).
- [x] Real Square-native status check for `GET /connect/status` —
      `checkConnectionStatus(userId)` in `backend/utilities/squareConnect.js`. Uses the
      seller's own (freshly refreshed if needed) access token to call
      `merchants.get({ merchantId })` via a new `getSquareClientForToken()` helper in
      `square.js` (a per-seller client, distinct from the platform-level `getSquare()`
      singleton). Mirrors the self-healing behavior the old Stripe code had: if Square
      rejects the token with 401/403 (seller revoked access from their own Square
      Dashboard, or Square restricted the account), the stale `user_payment_connect` row
      is deleted so the seller is offered a fresh `/connect/start` instead of a falsely
      "connected" UI. A transient/network error does **not** delete the row — reported as
      `pending` instead, so a momentary blip doesn't force an unnecessary reconnect.
      Tested against breakroom_dev with a genuinely bogus access token: confirmed Square's
      real sandbox API rejects it with an auth error, which correctly triggered the
      self-heal (row deleted, `not_connected` returned). No-connection case also verified.

### Phase 2 — Backend: Subscriptions (Pro tier)

**Architecture note (discovered starting this phase):** unlike Stripe Checkout Sessions,
Square has **no hosted checkout page for subscriptions**. Stripe's old `POST /subscribe`
just returned a redirect `url` and Stripe collected the card on its own hosted page.
Square requires the card to be tokenized **client-side first** (Web Payments SDK, Phase 4
frontend work) into a `sourceId`, which the backend then attaches to a Customer before
creating the subscription. This changes `POST /subscribe`'s contract: it now needs to
**accept** `{ sourceId }` in the request body and returns the resulting subscription
status directly, instead of returning a `{ url }` to redirect to. Phase 4 frontend work
must be built to match this, not the old redirect-based flow.

- [x] Create the $3.99/mo Pro plan in Square Catalog — done via a one-time idempotent
      script, `backend/scripts/square-setup-pro-plan.js` (safe to re-run; checks for an
      existing plan by name first). Plan variation ID saved as
      `SQUARE_PRO_PLAN_VARIATION_ID` in `.env.local`.
      **Gotcha hit while writing this:** the current Square API version
      (`2026-07-15`) rejects `SubscriptionPhase.recurringPriceMoney` — despite that field
      existing in the SDK's TypeScript types — and requires pricing to be set via
      `phase.pricing = { type: 'STATIC', priceMoney: {...} }` instead. Second gotcha: the
      created variation's ID comes back nested under
      `response.objects.find(o => o.type === 'SUBSCRIPTION_PLAN').subscriptionPlanData.subscriptionPlanVariations[0].id`
      — NOT as a separate top-level `SUBSCRIPTION_PLAN_VARIATION` entry in
      `response.objects`, which is what the SDK's own example code implies.
- [x] Implement subscribe endpoint using Square Subscriptions API (replaces
      `POST /subscribe`) — now accepts `{ sourceId }` (tokenized card from the frontend)
      instead of returning a redirect `url`; responds with `{ subscribed, status }`
      directly. Flow: `cards.create()` attaches the tokenized card to the Square customer,
      then `subscriptions.create()` against `SQUARE_PRO_PLAN_VARIATION_ID` +
      `SQUARE_LOCATION_ID`, then upserts `user_subscriptions` (`platform = 'square'`).
- [x] Implement Square-equivalent customer creation/lookup (replaces
      `getOrCreateStripeCustomer()`) — `getOrCreateSquareCustomer()` in `billing.js`.
      `user_payment_customers` has one row per `user_id` (not per `user_id`+`processor`),
      matching the hard-cutover decision: a stale Stripe-processor row for a user gets
      overwritten by the upsert rather than causing a duplicate-key conflict.
      **Verified end-to-end against real Square sandbox** (not mocked): created a real
      customer, tokenized a card via Square's sandbox test nonce (`cnon:card-nonce-ok`),
      created a real subscription (came back `ACTIVE`), confirmed the DB row matched, then
      fully cleaned up (cancelled the subscription, disabled the card, deleted the
      customer, removed the test DB rows).
- [x] Build custom "Cancel Subscription" endpoint (portal replacement — Square has no
      hosted portal) — `POST /cancel` in `billing.js`, replaces `POST /portal`. Square
      schedules cancellation for the end of the current billing period rather than
      terminating instantly, so this sets `expires_at` to the returned
      `chargedThroughDate` and deliberately leaves `status` as `'active'` — matches how
      Apple/Google subscriptions already represent "access until a future date" in this
      same table, and `GET /plan`'s active check (`status==='active' AND expires_at in
      the future`) naturally flips to inactive once that date passes, no extra status
      value needed. **Verified against real sandbox**: cancelling returned
      `status: ACTIVE` with `chargedThroughDate`/`canceledDate` both set to the correct
      future date.
- [x] Build custom "Update payment method" endpoint (portal replacement) —
      `POST /update-payment-method`, accepts `{ sourceId }` (same tokenization contract as
      `/subscribe`), tokenizes the new card via `cards.create()`, points the subscription
      at it via `subscriptions.update()`, then best-effort disables the old card.
      **Verified against real sandbox**: confirmed the subscription's `cardId` actually
      changed to the new card after the call.
- [x] Migration: add `'square'` to `user_subscriptions.platform` enum — done as part of
      migration 044 back in Phase 0/1, no separate migration needed here

### Phase 3 — Backend: Storefront checkout + webhooks

**Architecture note:** `CreatePayment` with `app_fee_money` must be called using the
**seller's own OAuth access token** (via `getValidAccessToken()` from Phase 1), not the
platform's token — Square identifies which merchant account receives the funds from
whichever token makes the call. `location_id` is the **seller's own** location too
(fetched via their Merchant profile's `mainLocationId`), not `SQUARE_LOCATION_ID`.
Confirmed via Square's docs before implementing, since this is a real mechanical
difference from Stripe's destination-charge model (there, the *platform's* secret key +
`transfer_data.destination` did everything in one call from the platform's side).

Also: since `CreatePayment` completes **synchronously** (unlike Stripe's
PaymentIntent-then-webhook-confirms flow), the "mark order paid, mark item unavailable,
send buyer/seller emails" logic that used to live in the `payment_intent.succeeded`
webhook handler now happens directly in the checkout endpoint. This meaningfully shrinks
what the webhook rewrite (still pending) actually needs to cover — mainly refunds/
disputes/future async events, not the initial success path.

- [x] Implement `CreatePayment` with `app_fee_money` for one-off art/product purchases
      (replaces the `paymentIntents.create` + `transfer_data` flow) —
      `backend/routes/storefront.js`, endpoint renamed from
      `POST .../checkout/intent` to `POST .../checkout` (no more separate "intent" step;
      accepts `{ source_id, ... }`, a client-tokenized card, same pattern as `/subscribe`).
      Seller must have `onboarding_complete = 1` in `user_payment_connect`; a 401/403 from
      Square during the payment call (revoked connection) clears that row, same
      self-healing pattern as `checkConnectionStatus()`. Email sends are wrapped in their
      own try/catch — a transient email failure must never surface as a checkout failure
      to a buyer who was already actually charged.
      **Bug caught during testing:** an off-by-one in the `orders` INSERT's
      placeholder/column alignment (missing a placeholder for `total_cents` shifted
      `payment_connected_account_id`'s value). MySQL's column-count check caught it
      immediately as a hard error rather than silently miswriting data, but worth noting
      since it would've been a real bug without the end-to-end test catching it.
      **Also discovered:** `breakroom_dev`'s `collection_items`/`user_collections`/
      `user_storefront` tables were still missing migrations 020, 025, 026, 027
      (price/availability/shipping columns, gallery flag, display order, external URL) —
      backfilled all four, same schema-drift pattern as Phase 0/1.
      **Verified end-to-end against real Square sandbox**: set up a full fake storefront
      (store, collection, $25 item + $5 shipping), used our own sandbox default-account
      token as a stand-in seller connection (a genuine second connected merchant would
      need a live browser OAuth flow), and ran the actual checkout logic. Payment came
      back `COMPLETED` with the correct `appFeeMoney` (150¢ = 5% of $30 for a Free-tier
      seller), the order row landed with every field correct, and the item was marked
      unavailable. All test rows cleaned up afterward.
- [x] Implement Square webhook endpoint + signature verification — `POST
      /api/billing/webhook/square` in `index.js` (mounted with `express.raw()` before
      `express.json()`, same requirement as the Stripe webhook), handler
      `handleSquareWebhook()` in `billing.js`. Verified via the SDK's
      `WebhooksHelper.verifySignature()` — HMAC-SHA256 of `notificationUrl + rawBody`
      against `SQUARE_WEBHOOK_SIGNATURE_KEY`, compared to the
      `x-square-hmacsha256-signature` header. New env vars:
      `SQUARE_WEBHOOK_NOTIFICATION_URL` (must exactly match the URL registered in the
      Square dashboard) and `SQUARE_WEBHOOK_SIGNATURE_KEY` (currently a **local placeholder
      value** — no real webhook subscription has been registered in the Square dashboard
      yet, so this needs to be swapped for the real key once that's done; same category of
      remaining manual step as the OAuth redirect URL setup back in Phase 0).
- [x] Map every existing Stripe webhook event handled today to its Square equivalent —
      scope came out smaller than originally planned: payment-succeeded/failed has no
      Square equivalent needed here since `CreatePayment` completes synchronously in the
      checkout endpoint (Phase 3's first item, above). Implemented `subscription.updated`
      only — the one genuinely necessary gap, since Square bills renewals automatically
      and retries/pauses/cancels on its own schedule; without this a failed renewal would
      leave the local row at `status='active'` with `expires_at=NULL` forever. Mapping:
      `PAUSED` → local `'grace_period'` (loses Pro access immediately, not a full
      cancellation); `CANCELED`/`DEACTIVATED`/`COMPLETED` → status stays `'active'` with
      `expires_at` set to `chargedThroughDate`/`canceledDate` (same as `POST /cancel` —
      covers cancellation initiated outside our own endpoint, e.g. directly in the Square
      merchant dashboard); `ACTIVE` → clears any previously scheduled `expires_at` (e.g. a
      dashboard-side resume). Did **not** add refund/dispute webhook handling — the
      original Stripe code never had any refund handling either
      (`stripe.refunds.create` was never called anywhere), so building that now would be
      new functionality beyond migration parity, not something this migration needs to
      cover.
      **Verified with a self-constructed signed request** (computed the same HMAC the SDK
      would, since no live dashboard webhook subscription exists yet to send a real one):
      invalid signature correctly rejected (401, no DB change); valid `PAUSED` event →
      `grace_period`; valid `CANCELED` event → `expires_at` set correctly; valid `ACTIVE`
      event → `expires_at` cleared. All four scenarios passed.
- [x] Decide what to do about the missing `account.updated` handling gap — DECIDED
      2026-07-27: **confirmed non-issue, no webhook needed.** Square's equivalent event
      would be `oauth.authorization.revoked`, but we already have two independent
      self-healing lazy checks that cover the same gap: `checkConnectionStatus()` (Phase
      1) and the checkout endpoint's 401/403 handling (Phase 3, above) both detect a
      revoked/broken connection and clear the stale `user_payment_connect` row the next
      time either path runs. Adding the proactive webhook would only improve how quickly
      staleness is noticed (immediately vs. next status check or purchase attempt), not
      fix a correctness gap — reasonable future enhancement, not required for migration
      parity.

### Phase 4 — Frontend (Vue)
- [x] Swap `PublicStorePage.vue` and `PublicCollectionPage.vue` embedded Stripe Elements
      card form for Square Web Payments SDK — new shared helper
      `frontend/src/utilities/squarePayments.js` (loads the SDK script, sandbox vs
      production picked off the `sandbox-` app-id prefix so no separate env var is
      needed; `mountSquareCard()` / `tokenizeCard()`). Both pages' checkout endpoint
      call moved from `.../checkout/intent` to the renamed `.../checkout`, sending
      `{ source_id, ...shipping fields }`; since `CreatePayment` completes
      synchronously there's no separate confirm step anymore — a successful response
      goes straight to the confirmation screen.
- [x] Update `CollectionsPaymentPage.vue` to call new backend endpoints and repoint
      redirect URLs — Connect section rebranded Stripe→Square (no logo asset available,
      dropped the SVG mark, kept a plain black button). Subscribe is now a modal that
      tokenizes a card client-side and posts `{ sourceId }` to `/subscribe` instead of
      following a redirect `url`. "Manage Subscription" (`plan.platform === 'square'`
      now, was `'stripe'`) opens a new custom modal — Square has no hosted portal, so
      this is genuinely new UI, not a copy-and-rename: a menu offering "Update payment
      method" (tokenize → `POST /update-payment-method`) or "Cancel subscription"
      (`POST /cancel`, shows the returned `expires_at` on confirmation). Also handles
      `?square=denied|error` from the OAuth callback redirect (`?square=complete`
      needs no special-case UI since `fetchStatus()` already reflects it).
- [x] Update `SessionsPaywallModal.vue` too — **not originally listed in this
      checklist, found during implementation.** It has its own independent
      `POST /subscribe` call (used by the Sessions free-tier paywall), which the
      original file inventory at the top of this doc missed. Converted the same way:
      offer step → inline card-tokenization step → `{ sourceId }`. Since subscribe is
      now synchronous instead of a redirect-then-return flow, `SessionsPage.vue`'s
      `route.query.stripe === 'subscribed'` banner check was replaced with a
      `@subscribed` event straight from the modal.
- [x] Update copy in `ProfileBilling.vue`, `MarketingPage.vue`, `data/exploreFeatures.js`
      (currently says "Stripe" / mentions Stripe's fee %) — Square's online
      card-not-present rate is the same 2.9% + $0.30 Stripe used, so the existing fee
      example math in `ProfileBilling.vue` needed no recalculation, just a wording swap.
- [x] Remove `@stripe/stripe-js` once fully cut over — removed from
      `frontend/package.json`, lockfile updated. Also dropped the now-dead
      `VITE_STRIPE_PUBLISHABLE_KEY` from `.env.local` (kept `STRIPE_SECRET_KEY` /
      `STRIPE_WEBHOOK_SECRET` for now — those are backend-only and still load until
      Phase 6 decommissions the backend Stripe routes).
- [x] **Found and fixed while testing locally, not originally in this checklist:**
      `docker-compose.local.yml` was never updated across Phases 0-3 to pass any
      `SQUARE_*` / `TOKEN_ENCRYPTION_KEY` backend vars or `VITE_SQUARE_*` frontend vars
      into the containers — only `STRIPE_*` ones were wired up. This had been silently
      masked because earlier phases' "verified against real Square sandbox" testing
      was done via one-off Node scripts run directly against `breakroom_dev`, not
      through the actual local Docker stack. Backend also had a stale
      `backend_node_modules` named volume predating `square` being added to
      `package.json`, causing a hard crash (`Cannot find module 'square'`) the moment
      the container was actually started. Fixed both: added the missing env passthrough
      to `docker-compose.local.yml`, and recreated the stale volume. `https://local.
      prosaurus.com` now boots cleanly end-to-end with the Square-only stack.
- [x] **Live-tested through an actual browser (2026-07-27)**, on top of the earlier
      manual line-by-line request/response contract pass: Sessions paywall subscribe
      (hit the free-tier limit, tokenized a card, `/subscribe` succeeded and lifted the
      limit immediately), Collections payment-setup update-payment-method and
      cancel-subscription (both 200, cancel correctly shows the end-of-billing-period
      date instead of an abrupt cutoff), and a full storefront purchase (real store/
      collection/$25 item + $5 shipping, seller connected via the platform's own
      sandbox token as a stand-in per the Phase 3 pattern, `POST .../checkout` returned
      200, item marked sold, order landed correctly in the seller's Orders page). All
      test data cleaned up afterward. Square sandbox test card used:
      `4111 1111 1111 1111`, any future expiry, any CVV/ZIP.

### Phase 5 — Cutover (hard cutover, ASAP — see decision above)
- [ ] Send existing Pro subscribers a direct notice (email + in-app) that their
      subscription needs to be re-activated on Square — their Stripe billing is already
      dead, don't wait for them to notice a failed charge
- [ ] Send existing Connect sellers a direct notice that they need to re-onboard via
      Square before they can receive payouts again
- [ ] Execute the cutover
- [ ] Monitor first real Square subscriptions/payments closely (webhooks landing
      correctly, payouts arriving, fees calculated correctly)

### Phase 6 — Decommission
- [x] Remove Stripe routes/webhook endpoint from backend — deleted `handleStripeWebhook`
      and the lazy `getStripe()` init from `backend/routes/billing.js`, and its mount
      point in `backend/index.js`. Confirmed via `information_schema.COLUMNS` against
      `breakroom_dev` that this code was already fully dead before removal: it queried
      `user_stripe_customers`/`stripe_customer_id`/`orders.stripe_payment_intent_id`,
      all of which migration 044 had already renamed away — any real Stripe webhook
      hitting it would have crashed on "table/column doesn't exist". Also removed the
      now-unused `sendMail` import from `billing.js` (only the deleted webhook used it).
- [x] Remove `stripe` npm dependency from `backend/package.json` — also ran
      `npm uninstall stripe` in `backend/` to update the lockfile and node_modules.
- [x] Drop or archive Stripe-specific DB columns — **turned out to be a no-op**: migration
      044 already renamed every Stripe-specific table/column to a generic
      processor-agnostic name back in Phase 0 (`user_stripe_customers` →
      `user_payment_customers`, `stripe_customer_id` → `processor_customer_id`,
      `orders.stripe_payment_intent_id` → `payment_intent_id`, etc.). Verified nothing
      Stripe-named remains anywhere in the `breakroom_dev` schema.
- [x] Update `CLAUDE.md` to reflect Square as the payment processor — added a "Payments"
      section (repo's `CLAUDE.md` never mentioned Stripe/Square at all before, so this
      was a pure addition, not a correction) plus two new bullets under "File Structure
      Notes" pointing at `backend/utilities/square.js` and `backend/routes/billing.js`.
- [x] **Found and fixed while decommissioning, not originally in this checklist:**
      `docker-compose.ec2.yml` (the actual production compose file) had the same gap
      Phase 4 found and fixed in `docker-compose.local.yml` — it only ever passed
      `STRIPE_*` vars into the backend container, never `SQUARE_*` or
      `TOKEN_ENCRYPTION_KEY`. Removed the dead `STRIPE_*` lines and added the missing
      `SQUARE_*`/`TOKEN_ENCRYPTION_KEY` passthrough. **This means production has never
      been able to make a single real Square API call** — confirmed by checking the
      local copy of `.env.production` (the file that gets scp'd to EC2 as `~/.env`):
      it has zero `SQUARE_*` values, only the old live Stripe keys (now removed) and a
      timestamp predating this migration entirely. Left the `SQUARE_*` keys blank with
      an explanatory comment rather than inventing values — **Phase 5 cannot proceed
      until real production Square credentials (a production Square Application, not
      the sandbox one) are obtained and filled in here**, along with a fresh
      `TOKEN_ENCRYPTION_KEY` (does not need to match the sandbox one) and
      `SQUARE_ENVIRONMENT=production`.
- [x] Fixed a related bug found while touching this code: `backend/routes/analytics.js`'s
      marketing dashboard (`SUBSCRIPTION_PLATFORMS` in `GET /paying-customers`) only ever
      mapped `stripe`/`apple`/`google` — every Square subscription created since Phase 4
      shipped has been silently invisible from that dashboard (missing from both the
      per-platform breakdown and `totalNewSubscribers`). Added a `square` entry; kept
      `stripe` too (relabeled "legacy") since historical rows still exist.
- [x] Verified clean: `node -c` on all three edited backend files, a standalone
      `require('./routes/billing')` load, and a full restart of the local Docker stack
      (nodemon picked up all three edits, restarted cleanly each time, `/api/auth/me`
      responded normally afterward).

### Phase 7 — Mobile apps (do last, low risk, can happen anytime after Phase 3 ships)
- [ ] See Android repo: `STRIPE_TO_SQUARE_MIGRATION.md`
- [ ] See iPhone repo: `stripe-to-square-migration.md`

---

## Progress log

_(Add dated entries here as work happens, so a fresh session — or a fresh machine after a
reboot — can pick up exactly where things left off.)_

- 2026-07-24: Doc created. Research/inventory done. No implementation started yet.
- 2026-07-25: Square Developer account + Application created (audience: all Square
  sellers). Sandbox credentials retrieved and added to `.env.local`. OAuth redirect URL
  registered. `square` npm SDK (v45.1) installed in `backend/`. Added
  `backend/scripts/square-list-locations.js` (lists locations for the configured token —
  used to find `SQUARE_LOCATION_ID`; sandbox default test account location is
  `L2HHW2WEFEX01`, "Default Test Account").
- 2026-07-25: Cutover strategy and DB approach decided (see "Open decisions" above).
  Hard cutover ASAP — confirmed Stripe processing is fully dead already for existing
  subscribers/sellers too, so there's no dual-run window. DB approach: generic
  processor-agnostic rename (draft column plan in "Open decisions"). OAuth scopes decided:
  `PAYMENTS_WRITE`, `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS` (required for the app-fee
  split — missable), `MERCHANT_PROFILE_READ`. All three Phase 0 open decisions are now
  resolved; Phase 0 complete except production activation (deferred to Phase 5). Next up:
  migration 025 (generic rename) and Phase 1 OAuth authorize/callback endpoints.
- 2026-07-27: Phase 4 (frontend) implemented in full. New shared
  `frontend/src/utilities/squarePayments.js` for the Web Payments SDK. Reworked
  `PublicStorePage.vue`/`PublicCollectionPage.vue` checkout, `CollectionsPaymentPage.vue`
  (subscribe modal + new custom manage-subscription modal replacing the Stripe portal),
  and `SessionsPaywallModal.vue` (found mid-session — an independent `/subscribe` caller
  this doc's original file inventory had missed). Removed `@stripe/stripe-js` and the
  dead `VITE_STRIPE_PUBLISHABLE_KEY`. Also discovered and fixed a standing gap from
  Phases 0-3: `docker-compose.local.yml` never actually passed `SQUARE_*` /
  `TOKEN_ENCRYPTION_KEY` / `VITE_SQUARE_*` into the local containers, and the backend
  container's node_modules volume predated the `square` package being added — both
  fixed, `https://local.prosaurus.com` now boots cleanly. Verified via build + lint +
  a manual line-by-line contract check against the backend routes, then **live-tested
  end-to-end in an actual browser** the same day: Sessions paywall subscribe, Collections
  payment-setup update/cancel, and a full storefront purchase all passed. Phase 4 is
  fully done.
- 2026-07-27: Phase 6 (decommission) done, taken before Phase 5 since it's pure code
  cleanup with no customer-facing action. Removed the Stripe webhook/routes (confirmed
  already fully dead — it referenced tables/columns migration 044 had already renamed
  away), the `stripe` npm dependency, and dead `STRIPE_*` env vars from `.env.local` and
  `.env.production`. DB column drop turned out to be a no-op (044 already handled it).
  Updated `CLAUDE.md` with a Payments section. **Found production has never had working
  Square credentials**: `docker-compose.ec2.yml` only ever wired up `STRIPE_*`, never
  `SQUARE_*`/`TOKEN_ENCRYPTION_KEY` (same gap Phase 4 found and fixed in the local
  compose file) — fixed the compose file, but `.env.production` itself has no real
  Square values, only blank placeholders now. **Phase 5 is blocked until a real
  production Square Application is created and those values filled in.** Also fixed an
  unrelated bug noticed in passing: `analytics.js`'s marketing dashboard never counted
  Square subscriptions at all (`SUBSCRIPTION_PLATFORMS` only had stripe/apple/google).
  Verified via syntax check, module load, and a full local Docker stack restart.
