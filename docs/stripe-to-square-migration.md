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
| Connect Express accounts (`accounts.create`, `accountLinks`) | **Square OAuth** (`GET /oauth2/authorize` → `ObtainToken`) | Returns `access_token` + `refresh_token` + `merchant_id`. **Square OAuth tokens expire and must be refreshed** — Stripe Connect doesn't require this (the platform secret key + destination account ID work indefinitely). This is genuinely new operational code: a refresh flow/job per connected seller, plus handling refresh failure (seller needs to re-auth). |
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

## Open decisions (resolve before/during implementation — not yet decided)

1. **Existing customers cutover strategy.** There are real, currently-paying Stripe
   subscribers and real Connect sellers with payout accounts right now. Options:
   - (a) Dual-run: keep Stripe billing alive for existing subscribers until they lapse/renew
     naturally, only new signups go to Square. Sellers keep existing Stripe payouts until
     they choose to re-onboard with Square.
   - (b) Hard cutover: pick a date, force everyone to re-onboard/re-subscribe on Square.
   - This is the highest-stakes decision in the whole project. Decide explicitly, don't
     let it happen by default. Whichever is chosen, write the decision and date into this
     doc before starting Phase 5 below.

2. **DB approach for the transition.** Add Square columns alongside the existing Stripe
   columns (nullable, used only for square-platform rows) vs. a cleaner generic rename
   (`payment_processor_account_id` instead of `stripe_account_id`) done as a single
   migration. Generic naming is nicer long-term (protects against a third processor
   someday) but touches more call sites. Pick one before writing migration 025+.

3. **Square developer account / production application.** Has this been created yet? If
   not, this blocks everything below — it's Phase 0.

---

## Task checklist

### Phase 0 — Prerequisites
- [x] Create/confirm Square Developer account and Application (audience: "all Square
      sellers" — marketplace/platform use case, matches the Connect model below)
- [ ] Decide OAuth scopes needed (at minimum `PAYMENTS_WRITE`, `MERCHANT_PROFILE_READ`)
- [ ] Decide the two open questions above (cutover strategy, DB approach) and record the
      decision in this file
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
- [ ] New migration: Square-equivalent columns for seller payout accounts
      (`user_square_connect` table or generic rename — per decision above)
- [ ] Implement OAuth authorize URL generation (replaces `POST /connect/start`)
- [ ] Implement OAuth callback / token exchange endpoint, store `access_token` +
      `refresh_token` + `merchant_id`
- [ ] Implement token refresh logic (new — Stripe didn't need this). Decide: refresh
      lazily on each use, or a scheduled job that refreshes before expiry.
- [ ] Implement connect-status check (replaces `GET /connect/status`)

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

### Phase 5 — Cutover
- [ ] Execute whichever cutover strategy was decided in Phase 0
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
  `L2HHW2WEFEX01`, "Default Test Account"). Still open: OAuth scopes decision, cutover
  strategy decision, DB approach decision — all needed before Phase 1 OAuth code proper.
