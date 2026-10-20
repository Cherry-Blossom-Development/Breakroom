const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { checkPermission } = require('../middleware/checkPermission');
const { normalizeSerial } = require('../utilities/greywire');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Site-admin tools for Greywire membership: the pedal serial registry (filled
// at build time), moving a pedal to a new owner, and granting membership by
// hand. See data/migrations/090-greywire-pedals.sql.
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

router.use(authenticate, checkPermission('admin_access'));

const MAX_SERIALS_PER_ADD = 500;

/**
 * GET /api/admin/greywire/pedals
 * Every registered pedal with its owner, newest first.
 */
router.get('/pedals', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT p.id, p.model, p.serial, p.build_date, p.notes, p.claimed_at, p.created_at,
              u.id AS owner_id, u.handle AS owner_handle
       FROM greywire_pedals p
       LEFT JOIN users u ON u.id = p.claimed_by
       ORDER BY p.created_at DESC, p.id DESC`
    );
    res.json({ pedals: result.rows });
  } catch (err) {
    console.error('Error loading Greywire pedals:', err);
    res.status(500).json({ message: 'Failed to load pedals' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/greywire/pedals  { model, serials, buildDate?, notes? }
 * Registers pedals. serials is an array, or one string with a serial per line.
 * Returns what was added and what was skipped (bad format or already on record).
 */
router.post('/pedals', async (req, res) => {
  const model = (req.body?.model || '').trim();
  const buildDate = req.body?.buildDate || null;
  const notes = (req.body?.notes || '').trim() || null;
  let raw = req.body?.serials;
  if (typeof raw === 'string') raw = raw.split(/[\r\n,]+/);
  if (!Array.isArray(raw)) raw = [];
  raw = raw.map(s => String(s).trim()).filter(Boolean);

  if (!model || model.length > 50) return res.status(400).json({ message: 'Model is required (50 characters at most)' });
  if (raw.length === 0) return res.status(400).json({ message: 'Enter at least one serial' });
  if (raw.length > MAX_SERIALS_PER_ADD) return res.status(400).json({ message: `At most ${MAX_SERIALS_PER_ADD} serials at a time` });
  if (buildDate && !/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) return res.status(400).json({ message: 'Build date must be YYYY-MM-DD' });
  if (notes && notes.length > 255) return res.status(400).json({ message: 'Notes are 255 characters at most' });

  const added = [];
  const skipped = [];
  const client = await getClient();
  try {
    for (const input of raw) {
      const serial = normalizeSerial(input);
      if (!serial) { skipped.push({ serial: input, reason: 'Not 16 hex digits' }); continue; }
      if (added.includes(serial)) { skipped.push({ serial, reason: 'Listed twice' }); continue; }
      try {
        const result = await client.query(
          `INSERT INTO greywire_pedals (model, serial, build_date, notes, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [model, serial, buildDate, notes, req.user.id]
        );
        await client.query(
          `INSERT INTO greywire_pedal_events (pedal_id, event, by_user_id) VALUES ($1, 'added', $2)`,
          [result.insertId, req.user.id]
        );
        added.push(serial);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        skipped.push({ serial, reason: 'Already on record' });
      }
    }
    res.status(added.length ? 201 : 200).json({ added, skipped });
  } catch (err) {
    console.error('Error adding Greywire pedals:', err);
    res.status(500).json({ message: 'Failed to add pedals', added, skipped });
  } finally {
    client.release();
  }
});

/**
 * PATCH /api/admin/greywire/pedals/:id  { handle }
 * Moves a pedal to the user with that handle (for a resale), or releases it
 * when handle is empty so the next owner can claim it themselves.
 */
router.patch('/pedals/:id', async (req, res) => {
  const handle = (req.body?.handle || '').trim();
  const client = await getClient();
  try {
    let toUserId = null;
    if (handle) {
      const user = await client.query('SELECT id, is_guest FROM users WHERE handle = $1', [handle]);
      if (user.rowCount === 0) return res.status(404).json({ message: `No user with handle "${handle}"` });
      if (user.rows[0].is_guest) return res.status(400).json({ message: 'Guest accounts cannot hold pedals' });
      toUserId = user.rows[0].id;
    }

    await client.beginTransaction();
    const pedal = await client.query('SELECT claimed_by FROM greywire_pedals WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (pedal.rowCount === 0) {
      await client.rollback();
      return res.status(404).json({ message: 'Pedal not found' });
    }
    const fromUserId = pedal.rows[0].claimed_by;
    if (fromUserId === toUserId) {
      await client.rollback();
      return res.json({ message: 'No change' });
    }

    await client.query(
      `UPDATE greywire_pedals SET claimed_by = $1, claimed_at = ${toUserId ? 'NOW()' : 'NULL'} WHERE id = $2`,
      [toUserId, req.params.id]
    );
    const event = !toUserId ? 'released' : fromUserId ? 'transferred' : 'claimed';
    await client.query(
      `INSERT INTO greywire_pedal_events (pedal_id, event, from_user_id, to_user_id, by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, event, fromUserId, toUserId, req.user.id]
    );
    await client.commit();
    res.json({ message: toUserId ? `Pedal moved to ${handle}` : 'Pedal released' });
  } catch (err) {
    await client.rollback().catch(() => {});
    console.error('Error moving Greywire pedal:', err);
    res.status(500).json({ message: 'Failed to update pedal' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/admin/greywire/pedals/:id
 * Removes a pedal entered by mistake. Claimed pedals can't be deleted;
 * release them first.
 */
router.delete('/pedals/:id', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM greywire_pedals WHERE id = $1 AND claimed_by IS NULL',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(409).json({ message: 'Pedal not found, or it has an owner (release it first)' });
    }
    res.json({ message: 'Pedal removed' });
  } catch (err) {
    console.error('Error removing Greywire pedal:', err);
    res.status(500).json({ message: 'Failed to remove pedal' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/greywire/pedals/:id/events
 * The pedal's history, oldest first.
 */
router.get('/pedals/:id/events', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT e.id, e.event, e.created_at,
              fu.handle AS from_handle, tu.handle AS to_handle, bu.handle AS by_handle
       FROM greywire_pedal_events e
       LEFT JOIN users fu ON fu.id = e.from_user_id
       LEFT JOIN users tu ON tu.id = e.to_user_id
       LEFT JOIN users bu ON bu.id = e.by_user_id
       WHERE e.pedal_id = $1
       ORDER BY e.created_at, e.id`,
      [req.params.id]
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error('Error loading Greywire pedal history:', err);
    res.status(500).json({ message: 'Failed to load history' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/admin/greywire/grants
 * Users granted membership by hand.
 */
router.get('/grants', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.greywire_granted_at AS granted_at,
              g.handle AS granted_by_handle,
              (SELECT COUNT(*) FROM greywire_pedals p WHERE p.claimed_by = u.id) AS pedal_count
       FROM users u
       LEFT JOIN users g ON g.id = u.greywire_granted_by
       WHERE u.greywire_granted_at IS NOT NULL
       ORDER BY u.greywire_granted_at DESC`
    );
    res.json({ grants: result.rows });
  } catch (err) {
    console.error('Error loading Greywire grants:', err);
    res.status(500).json({ message: 'Failed to load grants' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/admin/greywire/grants  { handle }
 * Grants membership by hand.
 */
router.post('/grants', async (req, res) => {
  const handle = (req.body?.handle || '').trim();
  if (!handle) return res.status(400).json({ message: 'Handle is required' });

  const client = await getClient();
  try {
    const user = await client.query('SELECT id, is_guest, greywire_granted_at FROM users WHERE handle = $1', [handle]);
    if (user.rowCount === 0) return res.status(404).json({ message: `No user with handle "${handle}"` });
    if (user.rows[0].is_guest) return res.status(400).json({ message: 'Guest accounts cannot be members' });
    if (user.rows[0].greywire_granted_at) return res.status(409).json({ message: `${handle} already has a grant` });

    await client.query(
      'UPDATE users SET greywire_granted_at = NOW(), greywire_granted_by = $1 WHERE id = $2',
      [req.user.id, user.rows[0].id]
    );
    res.status(201).json({ message: `Granted membership to ${handle}` });
  } catch (err) {
    console.error('Error granting Greywire membership:', err);
    res.status(500).json({ message: 'Failed to grant membership' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/admin/greywire/grants/:userId
 * Removes a hand grant. Pedals the user holds still keep them a member.
 */
router.delete('/grants/:userId', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE users SET greywire_granted_at = NULL, greywire_granted_by = NULL
       WHERE id = $1 AND greywire_granted_at IS NOT NULL`,
      [req.params.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Grant not found' });
    res.json({ message: 'Grant removed' });
  } catch (err) {
    console.error('Error removing Greywire grant:', err);
    res.status(500).json({ message: 'Failed to remove grant' });
  } finally {
    client.release();
  }
});

module.exports = router;
