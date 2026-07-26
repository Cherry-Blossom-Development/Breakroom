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
- [ ] Implement token refresh logic (new — Stripe didn't need this). Decide: refresh
      lazily on each use, or a scheduled job that refreshes before expiry. (Note: for the
      non-PKCE code-flow grant we're using, Square's refresh token is multi-use and never
      expires — only the access token expires, in 30 days — so this is lower urgency than
      it might sound.)
- [x] Minimal column-name fix to `GET /connect/status` so it doesn't throw against the
      renamed table — **not yet the real Square-native status check** (still just trusts
      the local `onboarding_complete` flag; TODO comment left in code). Real check via
      `MERCHANT_PROFILE_READ` is a separate remaining item.

### Phase 2 — Backend: Subscriptions (Pro tier)
- [ ] Create the $3.99/mo Pro plan in Square Catalog (one-time setup, can be done via
      Square Dashboard or API)
- [ ] Implement subscribe endpoint using Square Subscriptions API (replaces
      `POST /subscribe`)
- [ ] Implement Square-equivalent customer creation/lookup (replaces
      `getOrCreateStripeCustomer()`)
- [ ] Build custom "Cancel Subscription" endpoint (portal replacement — Square has no
      hosted portal)
- [ ] Build custom "Update payment method" endpoint (portal replacement)
- [ ] Migration: add `'square'` to `user_subscriptions.platform` enum

### Phase 3 — Backend: Storefront checkout + webhooks
- [ ] Implement `CreatePayment` with `app_fee_money` for one-off art/product purchases
      (replaces the `paymentIntents.create` + `transfer_data` flow)
- [ ] Implement Square webhook endpoint + signature verification
- [ ] Map every existing Stripe webhook event handled today to its Square equivalent (see
      table above) — subscription activate/update/expire, payment succeeded/failed
- [ ] Decide what to do about the missing `account.updated` handling gap (currently Connect
      status is checked lazily anyway, so this may be a non-issue — confirm)

### Phase 4 — Frontend (Vue)
- [ ] Swap `PublicStorePage.vue` and `PublicCollectionPage.vue` embedded Stripe Elements
      card form for Square Web Payments SDK
- [ ] Update `CollectionsPaymentPage.vue` to call new backend endpoints and repoint
      redirect URLs (onboarding, subscribe, manage-subscription)
- [ ] Update copy in `ProfileBilling.vue`, `MarketingPage.vue`, `data/exploreFeatures.js`
      (currently says "Stripe" / mentions Stripe's fee %)
- [ ] Remove `@stripe/stripe-js` once fully cut over

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
- [ ] Remove Stripe routes/webhook endpoint from backend
- [ ] Remove `stripe` npm dependency from `backend/package.json`
- [ ] Drop or archive Stripe-specific DB columns (only after confident no rollback needed)
- [ ] Update `CLAUDE.md` / `Breakroom/CLAUDE.md` to reflect Square as the payment processor

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
