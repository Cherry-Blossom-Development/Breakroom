# Square Migration — Resume Point (2026-07-27, updated)

**This is a temporary status snapshot.** The authoritative, permanent record is
`docs/stripe-to-square-migration.md` — this file just tells you where to pick up.

## Git state
- Branch: `main`. Uncommitted changes present from this session's Phase 4 work —
  not yet committed (user hasn't asked for a commit yet).

## Phase 4 live browser verification — DONE (2026-07-27)
All three flows click-tested end-to-end in an actual browser against the local dev
stack, using Square sandbox test card `4111 1111 1111 1111`:
- **Sessions paywall subscribe** — hit the free-tier limit (uploaded recordings via
  Chrome automation + BreakTest's `test-recording.wav` fixture), paywall modal
  triggered correctly, Square Web Payments SDK tokenization + `/subscribe` succeeded,
  Pro activated immediately and lifted the limit.
- **Collections payment-setup manage subscription** — update payment method (200) and
  cancel subscription (200, correct "Pro access continues until end of billing period"
  messaging) both verified via network tab.
- **Storefront checkout** — built a real store/collection/$25 item ($5 shipping) on the
  dev account, connected Square Connect using the platform's own sandbox default-account
  token as a stand-in seller (same trick as the Phase 3 backend test — a genuine second
  merchant needs live OAuth), then completed checkout via `POST .../items/:itemId/checkout`
  through the public storefront UI. Payment succeeded, item flipped to sold, order
  landed as PAID $30.00 in the seller's Orders page.
- No console errors or unexpected network failures anywhere in this pass.
- **All test data cleaned up afterward** (test store, collection, item, order, and the
  stand-in `user_payment_connect` row) — account is back to its pre-test state. The
  cancelled-subscription test was NOT reverted (that's real: Pro stays active on this
  account until 2026-08-26 per Square's own proration, then reverts to free — this is
  expected behavior being exercised, not leftover test debris).

## What's done: Phases 0, 1, 2, 3, 4 — all implemented
- **Phases 0-3**: unchanged from before (Connect/OAuth, Subscriptions, Storefront
  checkout + webhooks — all previously verified against real Square sandbox).
- **Phase 4 (Frontend/Vue)**: implemented this session.
  - New `frontend/src/utilities/squarePayments.js` — shared Web Payments SDK loader +
    card tokenization helper.
  - `PublicStorePage.vue` / `PublicCollectionPage.vue` — Square card tokenization
    replaces Stripe Elements; checkout call moved to the renamed
    `POST .../items/:itemId/checkout` (no more `/intent`), synchronous response goes
    straight to the confirmation step.
  - `CollectionsPaymentPage.vue` — Stripe Connect copy/branding replaced with Square;
    subscribe is now a modal that tokenizes a card and posts `{ sourceId }`; "Manage
    Subscription" is a new custom modal (Update payment method / Cancel subscription)
    since Square has no hosted portal equivalent to Stripe's.
  - `SessionsPaywallModal.vue` — found mid-session, not in the original Phase 4 file
    list in the migration doc (it has its own independent `/subscribe` call for the
    Sessions free-tier paywall). Converted the same way as CollectionsPaymentPage.
  - Copy updated in `ProfileBilling.vue`, `MarketingPage.vue`,
    `data/exploreFeatures.js`. `@stripe/stripe-js` removed from `package.json`.
  - **Also fixed, found during local testing**: `docker-compose.local.yml` had never
    actually been updated across Phases 0-3 to pass `SQUARE_*` / `TOKEN_ENCRYPTION_KEY`
    backend vars or `VITE_SQUARE_*` frontend vars into the containers. Fixed. Also had
    to recreate a stale `backend_node_modules` Docker volume that predated `square`
    being added to `backend/package.json` (was causing a hard crash on container
    start). `https://local.prosaurus.com` now boots cleanly with the full stack.

## What's NOT done yet
- **Phase 5** — cutover execution (notify existing subscribers/sellers).
- **Phase 6** — decommission Stripe code/columns/dependency (backend `stripe` npm
  package, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, Stripe webhook route, DB
  columns still around from before the Phase 0 rename).
- **Phase 7** — mobile apps (Android/iPhone docs), low priority, do last.

## Important local-only state (NOT in git — lives in `.env.local`)
Same as before, plus:
- `VITE_SQUARE_APPLICATION_ID` / `VITE_SQUARE_LOCATION_ID` added this session (mirror
  the existing backend `SQUARE_APPLICATION_ID`/`SQUARE_LOCATION_ID` — safe to expose
  client-side, same trust level as a Stripe publishable key).
- `VITE_STRIPE_PUBLISHABLE_KEY` removed (dead, no code references it anymore).
- Webhook signature key is still a placeholder — no real Square dashboard webhook
  subscription registered yet (same note as before, unchanged this session).

## Next action when resuming
Phase 4 is fully verified now. Decide whether to move into Phase 5 (cutover) or Phase 6
(decommission) next — or something else. Read `docs/stripe-to-square-migration.md` in
full for complete context.
