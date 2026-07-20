-- Migration 041: Real user numbering
-- Assigns each non-test signup the next sequential "real user" number, so the
-- true headcount of actual (non-fake) users can be read directly off the
-- users table instead of re-deriving it from is_internal each time. Distinct
-- from is_internal: a handful of known-fake accounts (Apple/Google test
-- reviewer logins) are deliberately NOT flagged is_internal, since those
-- platforms were handed the credentials directly, but still must not count
-- toward real_user_number.
--
-- Numbers are assigned once and never reused. If a user is later flagged
-- is_internal, their real_user_number is cleared (see backend/routes/user.js)
-- but the number itself is retired, not reassigned -- the sequence is allowed
-- to have permanent gaps rather than ever renumbering existing users.

ALTER TABLE users ADD COLUMN real_user_number INT NULL UNIQUE;
