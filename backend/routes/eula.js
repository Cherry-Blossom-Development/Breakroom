const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies.jwtToken || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = user.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Helper: find or create the EULA notification row for a user.
// Returns the notification row { id, status, updated_at } or null if no eula_required type exists.
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

  // Row doesn't exist — create it
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

/**
 * GET /api/eula/status
 * Returns whether the current user has accepted the EULA, and their notification ID.
 * Creates the notification row if it doesn't exist so the popup will show on next load.
 */
router.get('/status', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const notif = await getOrCreateEulaNotification(client, req.user.id);
    if (!notif) {
      return res.json({ accepted: false, notificationId: null, acceptedAt: null });
    }
    const accepted = notif.status === 'dismissed';
    res.json({
      accepted,
      notificationId: notif.id,
      acceptedAt: accepted ? notif.updated_at : null
    });
  } catch (err) {
    console.error('Error fetching EULA status:', err);
    res.status(500).json({ message: 'Failed to fetch EULA status' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/eula/accept
 * Accepts the EULA for the current user.
 * Creates the notification row if missing, then marks it dismissed.
 */
router.post('/accept', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const notif = await getOrCreateEulaNotification(client, req.user.id);
    if (!notif) {
      return res.status(500).json({ message: 'EULA notification type not configured' });
    }
    if (notif.status !== 'dismissed') {
      await client.query(
        'UPDATE notifications SET status = $1 WHERE id = $2',
        ['dismissed', notif.id]
      );
    }
    res.json({ accepted: true });
  } catch (err) {
    console.error('Error accepting EULA:', err);
    res.status(500).json({ message: 'Failed to accept EULA' });
  } finally {
    client.release();
  }
});

module.exports = router;
