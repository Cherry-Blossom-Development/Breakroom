-- Migration 052: Games feature flag
-- Seeds the "games" flag in the existing feature-flags system (data/34-features.sql)
-- so the new Games section is gated and off for everyone by default -- no rows are
-- inserted into feature_users, so no one is enrolled until an admin opts users in
-- via Admin > Features.

INSERT INTO features (feature_key, name, description, is_active)
VALUES ('games', 'Games', 'Games section of the app (in development). Adds a Games link to the sidebar for enrolled users.', TRUE)
ON DUPLICATE KEY UPDATE feature_key = feature_key;
