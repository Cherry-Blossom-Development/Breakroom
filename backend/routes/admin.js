const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { checkPermission } = require('../middleware/checkPermission');

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;

const authenticate = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const cookieOptions = () => ({
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
});

// POST /api/admin/impersonate/stop  — must be registered before /:userId
router.post('/impersonate/stop', async (req, res) => {
  const { adminToken } = req.body;
  if (!adminToken) return res.status(400).json({ message: 'Admin token required' });

  let client;
  try {
    const payload = jwt.verify(adminToken, SECRET_KEY);
    if (payload.impersonatedBy) return res.status(400).json({ message: 'Token is itself an impersonation token' });

    client = await getClient();
    const userResult = await client.query('SELECT id FROM users WHERE handle = $1', [payload.username]);
    if (userResult.rowCount === 0) return res.status(401).json({ message: 'User not found' });

    const adminId = userResult.rows[0].id;
    const permResult = await client.query(`
      SELECT 1 FROM permissions p
      WHERE p.name = 'admin_access' AND p.is_active = true AND (
        EXISTS (SELECT 1 FROM user_permissions up WHERE up.permission_id = p.id AND up.user_id = $1)
        OR EXISTS (
          SELECT 1 FROM group_permissions gp
          JOIN user_groups ug ON ug.group_id = gp.group_id
          WHERE gp.permission_id = p.id AND ug.user_id = $1
        )
      )
    `, [adminId]);

    if (permResult.rowCount === 0) return res.status(403).json({ message: 'Not an admin' });

    res.cookie('jwtToken', adminToken, { ...cookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ message: 'Impersonation ended' });
  } catch (err) {
    console.error('Stop impersonation error:', err);
    res.status(401).json({ message: 'Invalid or expired token' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/admin/impersonate/:userId
router.post('/impersonate/:userId', authenticate, checkPermission('admin_access'), async (req, res) => {
  const { userId } = req.params;
  let client;
  try {
    client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'User not found' });

    const target = result.rows[0];
    if (target.id === req.user.id) return res.status(400).json({ message: 'Cannot impersonate yourself' });

    const token = jwt.sign(
      { username: target.handle, impersonatedBy: req.user.handle },
      SECRET_KEY,
      { expiresIn: '4h' }
    );

    res.cookie('jwtToken', token, { ...cookieOptions(), maxAge: 4 * 60 * 60 * 1000 });
    res.json({ handle: target.handle, displayName: [target.first_name, target.last_name].filter(Boolean).join(' ') || target.handle });
  } catch (err) {
    console.error('Impersonate error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
