-- Migration 043: Band invite notification type
-- Backs the in-app/push notification sent when an existing user is invited
-- to a band (by @handle, or by email where the email matches an account).
-- See backend/routes/bands.js.

INSERT INTO event_types (type, description)
SELECT 'band_invite', 'Triggered when a user is invited to join a band'
WHERE NOT EXISTS (SELECT 1 FROM event_types WHERE type = 'band_invite');

INSERT INTO notification_types (name, description, display_type, event_id, is_active)
SELECT 'Band Invite', 'You have been invited to join a band', 'header', et.id, TRUE
FROM event_types et
WHERE et.type = 'band_invite'
  AND NOT EXISTS (
    SELECT 1 FROM notification_types nt
    JOIN event_types et2 ON nt.event_id = et2.id
    WHERE et2.type = 'band_invite'
  );
