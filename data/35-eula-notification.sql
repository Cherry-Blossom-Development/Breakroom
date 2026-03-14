-- EULA acceptance notification type
-- Users must accept the EULA. Status 'dismissed' in the notifications table = accepted.
-- updated_at on that row records when they accepted.

INSERT IGNORE INTO event_types (type, description)
  VALUES ('eula_required', 'User must accept the End User License Agreement');

INSERT INTO notification_types (name, description, display_type, event_id, repeat_rule, is_active)
SELECT
  'Terms of Service',
  'Please read and accept the Prosaurus End User License Agreement (EULA) to continue using this service.\n\nVisit prosaurus.com/eula to review the full terms.',
  'popup',
  id,
  '1',
  TRUE
FROM event_types WHERE type = 'eula_required';
