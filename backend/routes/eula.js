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

/**
 * GET /api/eula/status
 * Returns whether the current user has accepted the EULA, and their notification ID.
 * accepted: true  → user has dismissed (accepted) the EULA notification
 * accepted: false → user has not yet accepted; notificationId is the notification to dismiss on accept
 */
router.get('/status', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT n.id, n.status, n.updated_at
       FROM notifications n
       JOIN notification_types nt ON n.notif_id = nt.id
       JOIN event_types et ON nt.event_id = et.id
       WHERE et.type = 'eula_required' AND n.user_id = $1
       LIMIT 1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.json({ accepted: false, notificationId: null, acceptedAt: null });
    }

    const notif = result.rows[0];
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

module.exports = router;
