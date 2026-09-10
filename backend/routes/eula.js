const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { getOrCreateEulaNotification } = require('../utilities/eulaNotification');
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
