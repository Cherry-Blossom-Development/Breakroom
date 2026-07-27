# Square Migration — Resume Point (2026-07-27, updated)

**This is a temporary status snapshot.** The authoritative, permanent record is
`docs/stripe-to-square-migration.md` — this file just tells you where to pick up.

## Git state
- Branch: `main`, up to date with `origin/main`. Both this session's commits are
  pushed: `3aecd44` (Phase 4 frontend) and `eea0396` (Phase 6 decommission).
- No uncommitted changes from this session.

## What's done: Phases 0, 1, 2, 3, 4, 6 — all implemented and verified
- **Phases 0-3**: Connect/OAuth, Subscriptions, Storefront checkout + webhooks — all
  previously verified against real Square sandbox.
- **Phase 4 (Frontend/Vue)**: implemented and live-tested end-to-end in an actual
  browser this session — Sessions paywall subscribe, Collections payment-setup
  update/cancel, and a full storefront purchase all passed using Square sandbox test
  card `4111 1111 1111 1111`. Test data cleaned up afterward. Full detail in
  `docs/stripe-to-square-migration.md`.
- **Phase 6 (Decommission)**: done ahead of Phase 5 since it's pure code cleanup with
  no customer-facing action. Removed the (already-dead) Stripe webhook/routes, the
  `stripe` npm dependency, and dead `STRIPE_*` env vars. DB column drop was a no-op —
  migration 044 had already renamed everything Stripe-specific to generic names.
  Updated `CLAUDE.md` with a Payments section.

## ⚠️ Phase 5 is blocked — production has never had working Square credentials
Found while doing Phase 6: `docker-compose.ec2.yml` (the real production compose file)
only ever wired up `STRIPE_*` env vars into the backend container, never `SQUARE_*` or
`TOKEN_ENCRYPTION_KEY` — the same gap Phase 4 found and fixed in
`docker-compose.local.yml`, just never caught on the production side. Fixed the compose
file itself, but the local copy of `.env.production` (the file that gets scp'd to EC2 as
`~/.env`) has **zero real Square values** — I left them as blank placeholders with an
explanatory comment rather than inventing anything. Its old Stripe keys are gone too
(dead code now, removed).

**Before Phase 5 (cutover) can happen, someone needs to:**
1. Create a real (non-sandbox) Square Application in the Square Developer Dashboard —
   the current sandbox one only works in Square's test environment.
2. Fill in `.env.production` on the dev machine: `SQUARE_ENVIRONMENT=production` plus
   real `SQUARE_APPLICATION_ID` / `SQUARE_ACCESS_TOKEN` / `SQUARE_APPLICATION_SECRET` /
   `SQUARE_LOCATION_ID` / `SQUARE_WEBHOOK_SIGNATURE_KEY` / `SQUARE_WEBHOOK_NOTIFICATION_URL`
   / `SQUARE_PRO_PLAN_VARIATION_ID`, and a fresh `TOKEN_ENCRYPTION_KEY` (does not need to
   match the sandbox one — generate a new 32-byte hex string).
3. Re-run the Square Catalog Pro-plan setup script (`backend/scripts/square-setup-pro-plan.js`)
   against production credentials to get a production `SQUARE_PRO_PLAN_VARIATION_ID`.
4. Register the production webhook subscription in the Square Dashboard.
5. Redeploy (scp the updated `docker-compose.ec2.yml` + `.env.production`, restart the
   container).

Only after that is production actually capable of taking a real Square payment — Phase
5's subscriber/seller notification emails would otherwise point people at a cutover that
can't process anything yet.

## What's NOT done yet
- **Phase 5** — cutover execution (notify existing subscribers/sellers). Blocked on the
  production credentials gap above.
- **Phase 7** — mobile apps (Android/iPhone docs), low priority, do last.

## Important local-only state (NOT in git — lives in `.env.local` / `.env.production`)
- `.env.local`: `VITE_SQUARE_APPLICATION_ID` / `VITE_SQUARE_LOCATION_ID` present, old
  Stripe keys removed. Webhook signature key is still a sandbox placeholder — no real
  Square dashboard webhook subscription registered yet for local/sandbox either.
- `.env.production`: old Stripe keys removed; `SQUARE_*` keys present but blank —
  see the Phase 5 blocker section above.

## Next action when resuming
Either work the Phase 5 production-credentials checklist above, or pick something else.
Read `docs/stripe-to-square-migration.md` in full for complete context.
