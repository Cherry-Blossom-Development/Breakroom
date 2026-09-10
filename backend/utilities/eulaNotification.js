const { getClient } = require('./db');

// Find or create the EULA notification row for a user.
// Returns the notification row { id, status, updated_at } or null if no
// eula_required notification type exists. Shared by backend/routes/eula.js
// (the in-app popup accept flow) and backend/routes/authentication.js (guest
// signup, where accepting the EULA is a precondition of creating the account).
async function getOrCreateEulaNotification(client, userId) {
  const eulaType = await client.query(
    `SELECT nt.id FROM notification_types nt
     JOIN event_types et ON nt.event_id = et.id
     WHERE et.type = 'eula_required' AND nt.is_active = TRUE
     LIMIT 1`
  );
  if (eulaType.rowCount === 0) return null;
  const eulaTypeId = eulaType.rows[0].id;

  const existing = await client.query(
    'SELECT id, status, updated_at FROM notifications WHERE notif_id = $1 AND user_id = $2',
    [eulaTypeId, userId]
  );
  if (existing.rowCount > 0) return existing.rows[0];

  await client.query(
    'INSERT INTO notifications (notif_id, user_id, status) VALUES ($1, $2, $3)',
    [eulaTypeId, userId, 'unviewed']
  );
  const created = await client.query(
    'SELECT id, status, updated_at FROM notifications WHERE notif_id = $1 AND user_id = $2',
    [eulaTypeId, userId]
  );
  return created.rowCount > 0 ? created.rows[0] : null;
}

// Marks the EULA accepted for a user (notification status -> 'dismissed').
// Returns true on success, false if there's no eula_required type configured.
// Pass an existing client when this needs to run inside a caller's transaction.
async function acceptEulaForUser(userId, client = null) {
  const ownClient = !client;
  if (ownClient) client = await getClient();
  try {
    const notif = await getOrCreateEulaNotification(client, userId);
    if (!notif) return false;
    if (notif.status !== 'dismissed') {
      await client.query('UPDATE notifications SET status = $1 WHERE id = $2', ['dismissed', notif.id]);
    }
    return true;
  } finally {
    if (ownClient) client.release();
  }
}

module.exports = { getOrCreateEulaNotification, acceptEulaForUser };
