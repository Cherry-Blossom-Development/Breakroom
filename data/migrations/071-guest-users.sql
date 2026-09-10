-- Migration 071: Guest users
--
-- A "guest" is a real users row created via POST /api/auth/guest for someone
-- who only wants to play a game (Haulonaut) and doesn't want to join Prosaurus.
-- The game already authenticates purely off the jwtToken cookie / users.id, so
-- a guest needs a real row rather than a separate identity model -- the is_guest
-- flag is what sets them apart.
--
-- Guests DO get a real_user_number and DO count as real users in analytics
-- (deliberately unlike is_internal, which excludes staff/test accounts). The
-- flag exists so guest rows can be bulk-purged later, kept out of people-facing
-- surfaces (friend requests), and surfaced in the admin user list.
--
-- Guests have hash/salt NULL (password login impossible, same as the Prosaurus
-- chat-bot account in migration 042) and a synthetic unique email
-- (guest-<uuid>@guests.prosaurus.com) to satisfy the NOT NULL UNIQUE column.

ALTER TABLE users ADD COLUMN is_guest BOOLEAN NOT NULL DEFAULT FALSE AFTER is_internal;
