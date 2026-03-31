const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');

// GET /api/instruments — public lookup list
router.get('/', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query('SELECT id, name FROM instruments ORDER BY name');
    res.json({ instruments: result.rows });
  } catch (err) {
    console.error('Error fetching instruments:', err);
    res.status(500).json({ message: 'Failed to fetch instruments' });
  } finally {
    client.release();
  }
});

module.exports = router;
