const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const VALID_DESTINATIONS = ['us_only', 'us_canada', 'worldwide'];
const VALID_PROCESSING  = ['same_day', '1_2_days', '3_5_days', '1_2_weeks', '2_4_weeks'];

// GET /api/shipping/settings
router.get('/settings', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT address_line1, address_line2, city, state_region, zip, country,
              ship_destinations, processing_time
       FROM user_shipping_settings WHERE user_id = $1`,
      [req.user.id]
    );
    res.json(result.rowCount > 0 ? result.rows[0] : null);
  } catch (err) {
    console.error('Failed to fetch shipping settings:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/shipping/settings
router.post('/settings', authenticate, async (req, res) => {
  const {
    address_line1, address_line2, city, state_region, zip,
    country, ship_destinations, processing_time
  } = req.body;

  if (ship_destinations && !VALID_DESTINATIONS.includes(ship_destinations))
    return res.status(400).json({ message: 'Invalid ship_destinations value' });
  if (processing_time && !VALID_PROCESSING.includes(processing_time))
    return res.status(400).json({ message: 'Invalid processing_time value' });

  let client;
  try {
    client = await getClient();
    await client.query(
      `INSERT INTO user_shipping_settings
         (user_id, address_line1, address_line2, city, state_region, zip, country, ship_destinations, processing_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON DUPLICATE KEY UPDATE
         address_line1 = VALUES(address_line1),
         address_line2 = VALUES(address_line2),
         city          = VALUES(city),
         state_region  = VALUES(state_region),
         zip           = VALUES(zip),
         country       = VALUES(country),
         ship_destinations = VALUES(ship_destinations),
         processing_time   = VALUES(processing_time)`,
      [
        req.user.id,
        address_line1?.trim() || null,
        address_line2?.trim() || null,
        city?.trim() || null,
        state_region?.trim() || null,
        zip?.trim() || null,
        country?.trim() || 'US',
        ship_destinations || 'us_only',
        processing_time || '1_2_days'
      ]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('Failed to save shipping settings:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
