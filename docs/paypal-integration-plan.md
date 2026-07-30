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

**Bigger blocker than Square's Phase 0 was — confirmed 2026-07-30 against current
PayPal docs.** Square let you self-serve the "all Square sellers" marketplace audience
at app-creation time, no waiting period. PayPal is not fully self-serve for what we
actually need:

- A basic PayPal Developer account + sandbox REST app **is** self-serve and instant
  (developer.paypal.com, agree to terms, create an app → Client ID + Secret). This is
  enough to start Phase 2/3 (Subscriptions) work, since subscriptions don't need
  partner/platform-fee capability.
- **But the basic REST Partner Referrals integration explicitly does not support
  Platform Fee, Delayed Disbursement, Partner Reporting, or the Disputes API** (per
  PayPal's own onboarding docs). Since our whole reason for Connect-equivalent
  onboarding is the platform-fee split on seller payouts (0%/5% depending on Pro tier
  — the same thing Square's `app_fee_money` does), the basic integration alone isn't
  sufficient.
- **Platform fees require PPCP (PayPal Complete Payments Platform) with the
  `PARTNER_FEE` capability, which requires PayPal to approve you as a partner** — "fill
  out a form to get approved and a PayPal representative will reach out to you," per
  PayPal's docs. This is a business review process, not a self-service toggle, and its
  timeline is outside our control.

**Recommendation: start the PPCP partner application now, in parallel with everything
else**, since it's the one part of this whole PayPal effort that has a lead time
neither of us controls. Everything else in this plan (sandbox subscriptions work,
frontend scaffolding, DB migration) can proceed on the basic sandbox account while that
application is pending — only the Connect/checkout-fee-split piece (Phases 2 and 4)
actually needs PPCP approval to *test for real*, though the code for it can still be
written against docs in the meantime.

- [ ] PayPal Developer account (developer.paypal.com) linked to the business PayPal
      account — self-serve, do this first regardless
- [ ] A sandbox REST API app created → Client ID + Secret — self-serve
- [ ] **Apply for PPCP partner approval** (needed for Partner Referrals with
      `PARTNER_FEE` — the Connect-equivalent seller-onboarding with platform-fee
      support). Start this immediately given the unknown lead time; confirm current
      application process/form at developer.paypal.com, this doc's description may
      already be stale by the time you read it.
- [ ] Sandbox test buyer + seller accounts (PayPal sandbox provides these, similar to
      Square's "Default Test Account")

Everything below Phase 1 can be built and sandbox-tested once those exist. Production
credentials/activation (Phase 8) is a separate, later step, same as Square's Phase 0
vs Phase 5 split.

## Phase 0 — Prerequisites
- [ ] PayPal Developer account + sandbox REST app (see blocker above) — self-serve
- [x] **Apply for PPCP partner approval** — submitted 2026-07-30 via
      `https://www.paypal.com/us/enterprise/become-a-partner` ("Become a Partner"
      form). Note: the link PayPal's own docs point to for this
      (`developer.paypal.com/platforms/get-started`, "Fill out this form") is
      currently a broken self-referencing link — confirmed live in-browser, not just a
      fetch-tool artifact. Used the enterprise partner page instead, which has a real
      working form (First/Last name, Business name/email/phone/website, Business type,
      Country, Client annual volume, "Describe your solution", Number of active
      merchants). Now waiting on PayPal to review and a rep to reach out — no known
      timeline.
- [x] Decide products/capabilities needed — confirmed 2026-07-30 against current
      PayPal docs: `products: ["PPCP"]` in the Partner Referrals request, plus the
      `PARTNER_FEE` capability specifically for platform-fee support (requires the PPCP
      partner approval above — `EXPRESS_CHECKOUT` alone does not support platform fees,
      same category of distinction as Square's `PAYMENTS_WRITE` vs
      `PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS`)
- [ ] Sandbox credentials into `.env.local` (`PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`,
      `PAYPAL_CLIENT_SECRET`, alongside the existing `SQUARE_*` vars — additive, not a
      replacement)

**Account decision (2026-07-30)**: creating a dedicated PayPal *Business* account for
the company (not Dallas's personal, years-old, Gmail-tied PayPal account) — same
separation-of-concerns precedent as Square's production account being under
"Cherry Blossom Development LLC" rather than personal. Email:
`payments@cherryblossomdevelopment.com` — routes through the existing
`@cherryblossomdevelopment.com` catch-all forward to `cherryblossomdev411@gmail.com`
(confirmed working both directions, including send-as). Chosen over `support@` since
this is specifically payment-processor account administration, not end-user support —
worth reusing this same address for other processors' account admin going forward for
consistency.

## Phase 1 — Refactor Square behind the new processor interface
**Done 2026-07-30 (commit `e05fc8c`).** `backend/utilities/payments/index.js` (registry)
and `backend/utilities/payments/square.js` (adapter over the existing
`utilities/square.js`/`squareConnect.js`, unchanged) now exist. `billing.js` and
`storefront.js` dispatch through `getProcessor(name)` instead of calling Square inline,
defaulting to `'square'` so no existing caller needed to change. Verified against the
local sandbox stack — subscribe (fresh create + already-subscribed short-circuit),
cancel, update-payment-method, plan, connect/status, connect/start (including
rejecting an unknown processor name with a clean 400), storefront checkout with
correct fee/processor/account fields on the resulting order, and webhook signature
verification all match pre-refactor behavior. Committed and pushed to `main`, but
**not yet deployed to production** (deliberately held — see the 2026-07-30 Square
incident write-up in `docs/square-migration-resume-point.md` for why deploys are being
treated as an explicit, separate step now rather than assumed).

## Phase 2 — Backend: Partner Referrals (seller payouts)
**Confirmed 2026-07-30 against current PayPal docs** (sources: PayPal's
seller-onboarding and Partner Referrals API docs):

- [ ] Implement `getConnectAuthorizeUrl` / referral-creation for PayPal
      (`POST /v2/customer/partner-referrals`) — request body needs `operations`
      (`API_INTEGRATION` type), `products` (`["PPCP"]`), `capabilities` (must include
      `PARTNER_FEE` for platform-fee support — requires the Phase 0 partner approval),
      a `seller_nonce` (random 43-128 char string, analogous to Square's OAuth `state`
      but PayPal-specific naming), and `legal_consents`
      (`SHARE_DATA_CONSENT: true`). Response is a `201` with an `action_url` to
      redirect the seller to (analogous to Square's `oauth2/authorize` URL) — note the
      `action_url` **expires after first use**, unlike Square's authorize URL.
- [ ] Implement the return/callback handling — PayPal's flow is structurally different
      from Square's OAuth `code` exchange: PayPal redirects back to your return URL
      with query params directly (`merchantIdInPayPal`, `accountStatus`,
      `isEmailConfirmed`, `returnMessage`) rather than a `code` you then exchange for a
      token server-side. This means `exchangeConnectCode(code)` in the architecture
      doc's interface doesn't map cleanly onto PayPal's shape — the PayPal adapter's
      equivalent function will likely need to accept the whole query object rather than
      a single `code` string. Update the interface doc if so, don't force-fit it.
      `merchantIdInPayPal` is the account reference to store (PayPal's equivalent of
      Square's `merchantId`).
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
      setup script). **Confirmed 2026-07-30**: three separate APIs involved — Catalog
      Products API (defines "Prosaurus Pro" as a product), Billing Plans API (defines
      the $3.99/mo pricing/frequency against that product), Subscriptions API (creates
      individual subscription instances against the plan). More setup steps than
      Square's single Catalog call, but same one-time-script pattern applies.
- [ ] Implement `createSubscription`/`cancelSubscription`/`updatePaymentMethod` for
      PayPal. **Confirmed the buyer-facing contract differs from Square's
      `{ sourceId }` pattern, as suspected**: the PayPal JS SDK's Buttons component
      takes a `createSubscription` callback (calls `actions.subscription.create({
      plan_id })`) and an `onApprove` callback that receives `data.subscriptionID`
      after the buyer approves in a PayPal popup/redirect. The backend's role shifts
      from "create the subscription" (Square) to "receive an already-approved
      subscription ID from the frontend and record it" — closer to a confirm/activate
      step than Square's create step. Design Phase 5's frontend piece and this backend
      piece together; the `POST /subscribe` contract will need a `subscriptionId` field
      instead of (or alongside) `sourceId`/`paymentToken`, which the architecture doc's
      generic interface should accommodate via its `paymentToken` parameter carrying
      different meaning per processor rather than forcing PayPal into Square's shape.

## Phase 4 — Backend: Storefront checkout
- [ ] Implement PayPal Orders API v2 checkout with platform fee split. **Confirmed
      2026-07-30**: `POST /v2/checkout/orders`, fee goes in
      `purchase_units[0].payment_instruction.platform_fees[0].amount` (schema allows an
      array but PayPal currently only honors a single platform fee object), and the
      receiving seller in `purchase_units[0].payee`. Confirmed this requires the
      Phase 0 `PARTNER_FEE` capability/partner approval — not available on a bare
      sandbox app. Also confirmed: the partner/platform's own account **cannot have a
      PayPal balance** if collecting partner fees, and settlement happens once daily
      (not per-transaction) — a real difference from Square's per-payment instant
      split, worth noting in any seller-facing payout-timing copy.
- [ ] Confirm whether this call is made with the platform's own credentials or
      requires seller-side token involvement (architecture doc gotcha #2) — not yet
      confirmed from docs alone, verify with a real sandbox test once PPCP approval
      exists, don't assume either way from this doc.
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
      (sandbox: `api-m.sandbox.paypal.com`, production: `api-m.paypal.com`) — **confirmed
      2026-07-30**: request body needs `auth_algo`, `cert_url`, `transmission_id`,
      `transmission_sig`, `transmission_time` (all read off the
      `PAYPAL-AUTH-ALGO`/`PAYPAL-CERT-URL`/`PAYPAL-TRANSMISSION-ID`/
      `PAYPAL-TRANSMISSION-SIG`/`PAYPAL-TRANSMISSION-TIME` request headers), plus
      `webhook_id` (from the Developer Portal webhook config, analogous to storing
      `SQUARE_WEBHOOK_SIGNATURE_KEY`) and the full `webhook_event` payload. Response is
      `{ "verification_status": "SUCCESS" | "FAILURE" }` — check that field, not just
      HTTP status. This is a real API call per incoming webhook (see architecture doc
      gotcha #4) — decide a timeout/retry policy for when the verification call itself
      fails or times out, since that's a new failure mode Square's local HMAC never had.
- [ ] Map whichever PayPal subscription-lifecycle events are the equivalent of Square's
      `subscription.updated` handling (likely something like
      `BILLING.SUBSCRIPTION.SUSPENDED`/`CANCELLED`/`ACTIVATED` — confirm exact event
      names against current docs, not yet verified)

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
- 2026-07-30: Phase 1 (Square refactor behind the processor interface) implemented,
  sandbox-verified, committed (`e05fc8c`) — see Phase 1 section above. Not deployed to
  production yet (deliberately held).
- 2026-07-30: Researched current PayPal docs to firm up Phases 0/2/3/4/6 (previously
  marked "confirm against current docs"). Biggest finding: platform fees require PPCP
  partner approval (a PayPal business-review process with an unknown lead time), not a
  self-serve toggle like Square's marketplace audience selection was — this is now the
  actual critical-path blocker, more so than just "create a developer account." Also
  confirmed concrete request/response shapes for Partner Referrals, Orders v2
  `platform_fees`, and webhook signature verification (see Phases 2/4/6 above).
  Recommended starting the PPCP partner application immediately given the unknown
  timeline, in parallel with self-serve sandbox work.
