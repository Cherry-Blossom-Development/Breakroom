# Square Migration — Resume Point (2026-07-27, updated)

**This is a temporary status snapshot.** The authoritative, permanent record is
`docs/stripe-to-square-migration.md` — this file just tells you where to pick up.

## Git state
- Branch: `main`, up to date with `origin/main`. This session's code commits are
  pushed: `3aecd44` (Phase 4 frontend), `eea0396` (Phase 6 decommission), `3adee64`
  (resume-point doc). The production-credentials work below lives only in
  `.env.production` (gitignored) and the Square Developer Dashboard — nothing to
  commit for it.

## What's done: Phases 0, 1, 2, 3, 4, 6 — all implemented and verified
- **Phases 0-3**: Connect/OAuth, Subscriptions, Storefront checkout + webhooks — all
  previously verified against real Square sandbox.
- **Phase 4 (Frontend/Vue)**: implemented and live-tested end-to-end in an actual
  browser — Sessions paywall subscribe, Collections payment-setup update/cancel, and
  a full storefront purchase all passed using Square sandbox test card
  `4111 1111 1111 1111`. Test data cleaned up afterward.
- **Phase 6 (Decommission)**: done ahead of Phase 5 since it's pure code cleanup with
  no customer-facing action. Removed the (already-dead) Stripe webhook/routes, the
  `stripe` npm dependency, and dead `STRIPE_*` env vars. DB column drop was a no-op —
  migration 044 had already renamed everything Stripe-specific to generic names.
  Updated `CLAUDE.md` with a Payments section.

## Production Square credentials — filled in, one manual step remains
While doing Phase 6, found `docker-compose.ec2.yml` never wired up `SQUARE_*`/
`TOKEN_ENCRYPTION_KEY` for the backend container (only `STRIPE_*`) — fixed that. Then
went further and actually populated real production credentials:

- The existing "Prosaurus" Square Application already had production credentials
  generated (App ID, Access Token, Application secret) — didn't need to create a new
  app, just use the Production tab.
- Set the Production OAuth Redirect URL to
  `https://www.prosaurus.com/api/billing/connect/callback` (was blank before).
- Created a production webhook subscription ("Prosaurus production") for
  `subscription.updated` pointing at
  `https://www.prosaurus.com/api/billing/webhook/square` — matches exactly what
  `handleSquareWebhook` in `backend/routes/billing.js` handles.
- Confirmed a real production location exists via the API: `LD6S7JK70HN02`,
  "Cherry Blossom Development LLC", status ACTIVE (the dashboard's Locations page UI
  didn't show it, but `client.locations.list()` did).
- Ran the Catalog Pro-plan setup logic against production and got a real
  `SQUARE_PRO_PLAN_VARIATION_ID`.
- Generated a fresh `TOKEN_ENCRYPTION_KEY` (32-byte hex, does not match the sandbox
  one).
- **All 9 values are now filled into `.env.production`**: `SQUARE_ENVIRONMENT=production`,
  `SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_SECRET`,
  `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `SQUARE_WEBHOOK_NOTIFICATION_URL`,
  `SQUARE_PRO_PLAN_VARIATION_ID`, `TOKEN_ENCRYPTION_KEY`. Old dead Stripe keys removed
  from the same file. Secrets were transferred browser-clipboard → file directly via
  PowerShell, never typed or displayed in chat.

### ✅ Account activation confirmed done (2026-07-27)
The "you must activate your Square account" banner is gone from the Credentials page,
and `client.merchants.get({ merchantId: 'me' })` against production now returns
`status: 'ACTIVE'` for "Cherry Blossom Development LLC". Production is capable of
processing real card payments.

Also noticed, still not investigated: OAuth page shows "Active tokens connected to
production merchants: 1" — i.e. one real merchant has already gone through Connect
OAuth against this production app at some point. Worth checking who/what that is
before cutover if it's unexpected.

### ✅ Deployed to EC2 (2026-07-27)
`docker-compose.ec2.yml` and `.env.production` were scp'd to `ec2-user@44.225.148.34`,
and the backend container was recreated (`docker compose -f docker-compose.ec2.yml
--env-file .env up -d`) so it picks up the real Square env vars. Logs came up clean,
`GET /api/auth/me` and `GET /api/billing/plan` both responded normally (401 as
expected, unauthenticated). Square-specific behavior (subscribe, Connect OAuth,
storefront checkout) has **not** been exercised against production yet — only basic
reachability is confirmed so far.

### Remaining steps before Phase 5 cutover
1. ~~Complete account activation~~ — done.
2. ~~Redeploy~~ — done.
3. **Do a real (small, refundable) end-to-end test in production** — subscribe to Pro
   with a real card, or a real Connect OAuth + storefront purchase, before announcing
   cutover to real subscribers/sellers. Not done yet.
4. Then Phase 5 proper: notify existing subscribers/sellers, execute cutover, monitor
   first real transactions closely.

## What's NOT done yet
- **A real production payment test** (step 3 above) — the last thing standing between
  here and Phase 5 proper.
- **Phase 5** — cutover execution (notify subscribers/sellers).
- **Phase 7** — mobile apps (Android/iPhone docs), low priority, do last.

## Important local-only state (NOT in git — lives in `.env.local` / `.env.production`)
- `.env.local`: sandbox credentials, unchanged this session.
- `.env.production`: has real production Square credentials, deployed to EC2 (see
  above). The local copy and the EC2 `~/.env` copy should now match.

## Next action when resuming
Do a real, small, careful production payment test (Pro subscribe and/or a storefront
purchase) before Phase 5 notifications go out. Read `docs/stripe-to-square-migration.md`
in full for complete context.
