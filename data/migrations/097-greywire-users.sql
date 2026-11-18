-- Migration 097: Greywire users
-- Greywire is no longer members-only (decided 2026-11-18). Anyone with a full
-- account can use community.greywirestudio.com and the Greywire apps:
-- members (a claimed pedal or a grant) have no limits, and everyone else gets
-- the same free tier and subscription as Prosaurus.
--
-- A "Greywire user" is someone who has used Greywire: this column records the
-- first time an account signed up on, signed in to, or made a request to
-- Greywire (see backend/utilities/greywire.js, ensureGreywireUser). Friends
-- lists, user search, profiles and band invites on Greywire show Greywire
-- users, so Prosaurus-only accounts stay out of the Greywire community.

ALTER TABLE users
  ADD COLUMN greywire_joined_at DATETIME NULL AFTER greywire_granted_at;

-- Existing Greywire accounts: everyone who signed up there, holds a pedal, or
-- was granted membership.
UPDATE users u
SET u.greywire_joined_at = COALESCE(
  (SELECT MIN(p.claimed_at) FROM greywire_pedals p WHERE p.claimed_by = u.id),
  u.greywire_granted_at,
  u.created_at,
  NOW()
)
WHERE u.greywire_joined_at IS NULL
  AND u.is_guest = FALSE
  AND (u.signup_site = 'greywire'
       OR u.greywire_granted_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM greywire_pedals p WHERE p.claimed_by = u.id));
