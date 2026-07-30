# PayPal Integration Plan (second payment processor)

**Status**: NOT STARTED — plan only.
**Created**: 2026-07-30
**Owner**: Dallas

## Background

See `docs/multi-processor-payments-architecture.md` for the *why* (avoid another
single-processor-outage scramble like the Stripe cutoff) and the abstraction design this
plan builds on. This doc is the concrete phased checklist for adding **PayPal**
specifically, in the same style as `docs/stripe-to-square-migration.md`.

Web-only, additive — Square keeps working throughout, no cutover. Does not affect
App Store / Play Store in-app billing.

## Blocking dependency — needs the account owner

Same shape of blocker as Square Phase 0: **a PayPal Developer account and a REST app
must be created before any of this can be built or tested**, and only the account
owner can do that (business PayPal account, agreeing to PayPal's developer/partner
terms). Specifically needed before Phase 1 can start:

- [ ] PayPal Developer account (developer.paypal.com) linked to the business PayPal
      account
- [ ] A REST API app created (sandbox first) → Client ID + Secret
- [ ] Enrolled in **PayPal Partner/Platform** capability (needed for Partner Referrals —
      the Connect-equivalent seller-onboarding API; this may require a short PayPal
      approval step, unlike Square where the Connect/marketplace audience was selectable
      at app-creation time — confirm current PayPal process, this may have changed)
- [ ] Sandbox test buyer + seller accounts (PayPal sandbox provides these, similar to
      Square's "Default Test Account")

Everything below Phase 1 can be built and sandbox-tested once those exist. Production
credentials/activation (Phase 8) is a separate, later step, same as Square's Phase 0
vs Phase 5 split.

## Phase 0 — Prerequisites
- [ ] PayPal Developer account + sandbox REST app (see blocker above)
- [ ] Confirm current Partner Referrals / Platform enrollment process (PayPal's docs
      change here more often than Square's — verify before implementing, don't trust
      this doc's description as current)
- [ ] Decide scopes/"products" needed — likely `PPCP` (PayPal Complete Payments) or the
      narrower `EXPRESS_CHECKOUT` + platform fee capability; confirm against current
      PayPal Partner docs
- [ ] Sandbox credentials into `.env.local` (`PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`,
      `PAYPAL_CLIENT_SECRET`, alongside the existing `SQUARE_*` vars — additive, not a
      replacement)

## Phase 1 — Refactor Square behind the new processor interface
Do this *before* touching PayPal at all, so the extraction can be verified in isolation
against the working Square integration.

- [ ] Create `backend/utilities/payments/index.js` (registry: `getProcessor(name)`,
      `listEnabledProcessors()`) and `backend/utilities/payments/square.js` (adapter
      over existing `utilities/square.js`/`squareConnect.js` — those files stay as-is,
      this just wraps them in the common interface shape from the architecture doc)
- [ ] Update `backend/routes/billing.js` (`/subscribe`, `/cancel`,
      `/update-payment-method`, `/connect/start`, `/connect/callback`) to accept a
      `processor` field and dispatch through `getProcessor()` instead of calling
      `getSquare()` inline. Hardcoded `'square'` literals in SQL become the
      `processorName` variable.
- [ ] Update `backend/routes/storefront.js` checkout endpoint the same way — the
      seller-processor lookup (currently `WHERE processor = 'square'` at ~line 338)
      needs to check whichever processor the buyer selected, and the connected-account
      fetch/payment-create calls dispatch through the interface.
- [ ] Re-run the same non-destructive verification approach used for the Square
      production fix (2026-07-30): sandbox smoke test of subscribe/cancel/
      update-payment-method/checkout, confirm no behavior change from the buyer's or
      seller's perspective.

## Phase 2 — Backend: Partner Referrals (seller payouts)
- [ ] Implement `getConnectAuthorizeUrl` / referral-creation for PayPal
      (`POST /v2/customer/partner-referrals`) — returns an action URL to redirect the
      seller to, analogous to Square's `oauth2/authorize` URL
- [ ] Implement the callback/return handling — PayPal's referral flow returns control
      via a `tracking_id` you supply up front (not a `code` exchanged for a token the
      way Square's OAuth works) plus a merchant ID lookup; confirm exact mechanics
      against current docs, this is the biggest structural difference from Square's
      Connect flow
- [ ] Store the resulting merchant/account reference in `user_payment_connect`
      (`processor = 'paypal'`) — reuse the existing encrypted-token columns if PayPal's
      flow does involve storing an access/refresh token pair (some Partner integrations
      do, some just store a merchant ID with no token needed for the fee-split payment
      call — see architecture doc gotcha #2)
- [ ] `checkConnectionStatus` implementation — whatever PayPal's equivalent of
      `merchants.get()` is for confirming the connected account is actually
      payments-capable

## Phase 3 — Backend: Subscriptions (Pro tier)
- [ ] Create the $3.99/mo Pro Product + Billing Plan in PayPal (analogous to
      `backend/scripts/square-setup-pro-plan.js` — write a similar one-time idempotent
      setup script for PayPal's Products/Plans API)
- [ ] Implement `createSubscription`/`cancelSubscription`/`updatePaymentMethod` for
      PayPal. **Expect the buyer-facing contract to differ from Square's
      `{ sourceId }` pattern** — PayPal Subscriptions normally involves the JS SDK's
      `createSubscription` callback returning a subscription ID after buyer approval,
      which the backend then confirms/activates, rather than a raw tokenized-card
      `sourceId` POST. Design the frontend integration (Phase 5) and this backend
      piece together, don't assume the Square shape ports over.

## Phase 4 — Backend: Storefront checkout
- [ ] Implement PayPal Orders API v2 checkout with platform fee split
      (`purchase_units[].payee` + `platform_fees`), called with the **platform's own**
      credentials per architecture doc gotcha #2 (confirm against current docs before
      assuming this — verify whether any seller-side token involvement is still needed)
- [ ] Same synchronous-vs-webhook consideration as Square: confirm whether PayPal's
      Orders API capture step completes synchronously (likely yes, similar to Square's
      `CreatePayment`) so the "mark order paid, email buyer/seller" logic can live in
      the checkout endpoint itself rather than waiting on a webhook

## Phase 5 — Frontend (Vue)
- [ ] `frontend/src/utilities/payments/paypalPayments.js` — loads the PayPal JS SDK,
      exposes helpers analogous to `squarePayments.js`'s `mountSquareCard`/
      `tokenizeCard` but shaped for PayPal's Buttons/approval flow instead
- [ ] `GET /api/billing/processors` endpoint (new, small) — lists which processors are
      currently enabled, so the frontend chooser doesn't hardcode "Square only"
- [ ] Add a processor chooser to `CollectionsPaymentPage.vue` (subscribe modal),
      `SessionsPaywallModal.vue`, `PublicStorePage.vue`, `PublicCollectionPage.vue` —
      each currently assumes Square is the only option
- [ ] Seller-side: Collections payment-setup UI needs a way to connect PayPal
      independently of Square (a seller may have one, both, or neither)

## Phase 6 — Webhooks
- [ ] `POST /api/billing/webhook/paypal` endpoint, mounted in `index.js` alongside the
      Square one
- [ ] Signature verification via PayPal's `POST /v1/notifications/verify-webhook-signature`
      API call (not local HMAC — see architecture doc gotcha #4). Decide a
      timeout/retry policy for when that verification call itself fails or times out.
- [ ] Map whichever PayPal subscription-lifecycle events are the equivalent of Square's
      `subscription.updated` handling (likely something like
      `BILLING.SUBSCRIPTION.SUSPENDED`/`CANCELLED`/`ACTIVATED` — confirm exact event
      names against current docs)

## Phase 7 — DB migration
- [ ] `data/migrations/046-paypal-payment-processor.sql` — purely additive enum
      changes (see architecture doc for the exact SQL). Safe to run against production
      immediately once written; doesn't depend on any other phase being done first.

## Phase 8 — Sandbox verification
- [ ] Full sandbox pass mirroring what was done for Square: subscribe, cancel,
      update-payment-method, Connect referral + storefront purchase, webhook signature
      round-trip (valid accepted, tampered rejected) — all against PayPal sandbox, all
      cleaned up afterward

## Phase 9 — Production credentials + go-live
- [ ] PayPal production app activation (owner-only step, same shape as Square's
      `squareup.com/activate`)
- [ ] Production credentials into `.env.production` + `docker-compose.ec2.yml`
      (additive alongside existing `SQUARE_*`/`TOKEN_ENCRYPTION_KEY` vars, don't touch
      those)
- [ ] **Learn from the 2026-07-30 Square incident**: verify the actual deployed
      backend image and frontend bundle contain this code (not just the `.env` values)
      before considering this phase done. Don't repeat the mistake of updating env
      files/compose without rebuilding and pushing the actual image.
- [ ] A real, small, human-supervised production payment test before announcing PayPal
      as an available option to real users
- [ ] No forced cutover needed — announce PayPal as a new option alongside Square,
      existing Square subscribers/sellers unaffected

## Phase 10 — Mobile apps
- Out of scope — mobile uses App Store/Play Store IAP, not this backend's
  processor-choice system. No mobile work needed for this feature.

---

## Progress log

_(Add dated entries here as work happens.)_

- 2026-07-30: Plan written, alongside `docs/multi-processor-payments-architecture.md`.
  No implementation started. Blocked on Phase 0 (PayPal Developer account + sandbox
  app creation — owner-only step).
