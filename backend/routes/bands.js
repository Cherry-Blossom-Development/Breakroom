const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { isSubscribed } = require('../utilities/subscription');
const { sendMail } = require('../utilities/aws-ses-email');
const { uploadToS3, deleteFromS3, getS3Url } = require('../utilities/aws-s3');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase())
             && /jpeg|jpg|png|gif|webp/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  }
});

const faviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /ico|png|jpeg|jpg|webp/.test(path.extname(file.originalname).toLowerCase())
             && /(x-icon|vnd\.microsoft\.icon|png|jpeg|webp)/.test(file.mimetype);
    cb(ok ? null : new Error('Only ico, png, jpeg, or webp files are allowed'), ok);
  }
});

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

// GET /api/bands — bands the current user belongs to (active) plus pending invites
router.get('/', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT b.id, b.name, b.description, b.created_at,
              bm.role, bm.status,
              (SELECT COUNT(*) FROM band_members WHERE band_id = b.id AND status = 'active') AS member_count
       FROM bands b
       JOIN band_members bm ON bm.band_id = b.id AND bm.user_id = $1
       WHERE bm.status IN ('active', 'invited')
       ORDER BY b.name`,
      [req.user.id]
    );
    res.json({ bands: result.rows });
  } catch (err) {
    console.error('Error fetching bands:', err);
    res.status(500).json({ message: 'Failed to fetch bands' });
  } finally {
    client.release();
  }
});

// GET /api/bands/invite/:token — public: look up an email invite by token
router.get('/invite/:token', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT bei.status, bei.expires_at, bei.email,
              b.name AS band_name,
              u.handle AS inviter_handle, u.first_name AS inviter_first_name
       FROM band_email_invites bei
       JOIN bands b ON b.id = bei.band_id
       JOIN users u ON u.id = bei.invited_by
       WHERE bei.token = $1`,
      [req.params.token]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Invite not found' });

    const invite = result.rows[0];
    if (invite.status === 'accepted') return res.json({ status: 'accepted', band_name: invite.band_name });
    if (invite.status === 'expired' || new Date(invite.expires_at) < new Date())
      return res.status(410).json({ message: 'This invite has expired' });

    res.json({
      status: 'pending',
      band_name: invite.band_name,
      inviter_handle: invite.inviter_handle,
    });
  } catch (err) {
    console.error('Error looking up band invite:', err);
    res.status(500).json({ message: 'Failed to load invite' });
  } finally {
    client.release();
  }
});

// POST /api/bands/invite/:token/accept — authenticated: accept an email invite
router.post('/invite/:token/accept', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT bei.id, bei.band_id, bei.email, bei.status, bei.expires_at
       FROM band_email_invites bei
       WHERE bei.token = $1`,
      [req.params.token]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Invite not found' });

    const invite = result.rows[0];
    if (invite.status === 'accepted') return res.status(409).json({ message: 'Invite already accepted' });
    if (invite.status === 'expired' || new Date(invite.expires_at) < new Date())
      return res.status(410).json({ message: 'This invite has expired' });

    // Verify the logged-in user's email matches the invite
    const userRow = await client.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    if (userRow.rows[0].email.toLowerCase() !== invite.email.toLowerCase())
      return res.status(403).json({ message: 'This invite was sent to a different email address' });

    // Check if already a member
    const existing = await client.query(
      `SELECT status FROM band_members WHERE band_id = $1 AND user_id = $2`,
      [invite.band_id, req.user.id]
    );
    if (existing.rowCount > 0 && existing.rows[0].status === 'active')
      return res.status(409).json({ message: 'You are already a member of this band' });

    if (existing.rowCount > 0) {
      await client.query(
        `UPDATE band_members SET status = 'active', joined_at = NOW() WHERE band_id = $1 AND user_id = $2`,
        [invite.band_id, req.user.id]
      );
    } else {
      await client.query(
        `INSERT INTO band_members (band_id, user_id, role, status, joined_at) VALUES ($1, $2, 'member', 'active', NOW())`,
        [invite.band_id, req.user.id]
      );
    }

    await client.query(`UPDATE band_email_invites SET status = 'accepted' WHERE id = $1`, [invite.id]);

    const band = await client.query('SELECT name FROM bands WHERE id = $1', [invite.band_id]);
    res.json({ message: `You have joined ${band.rows[0].name}` });
  } catch (err) {
    console.error('Error accepting band email invite:', err);
    res.status(500).json({ message: 'Failed to accept invite' });
  } finally {
    client.release();
  }
});

// GET /api/bands/:id — band detail with members
router.get('/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    // Must be an active member to view
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const band = await client.query('SELECT id, name, description, created_by, created_at FROM bands WHERE id = $1', [req.params.id]);
    if (band.rowCount === 0) return res.status(404).json({ message: 'Band not found' });

    const members = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.photo_path,
              bm.role, bm.status, bm.joined_at
       FROM band_members bm
       JOIN users u ON u.id = bm.user_id
       WHERE bm.band_id = $1
       ORDER BY bm.role = 'owner' DESC, u.handle`,
      [req.params.id]
    );

    res.json({ band: { ...band.rows[0], members: members.rows, my_role: membership.rows[0].role } });
  } catch (err) {
    console.error('Error fetching band:', err);
    res.status(500).json({ message: 'Failed to fetch band' });
  } finally {
    client.release();
  }
});

// POST /api/bands — create a band; creator becomes owner
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Band name is required' });

  // Enforce free-tier limit: 1 band
  const limitClient = await getClient();
  try {
    const countResult = await limitClient.query(
      `SELECT COUNT(*) AS cnt FROM bands WHERE created_by = $1`,
      [req.user.id]
    );
    const count = parseInt(countResult.rows[0].cnt, 10);
    if (count >= 1) {
      const { subscribed } = await isSubscribed(req.user.id);
      if (!subscribed) {
        return res.status(402).json({
          message: 'Free accounts are limited to 1 band',
          requiresSubscription: true,
        });
      }
    }
  } finally {
    limitClient.release();
  }

  const client = await getClient();
  try {
    const insert = await client.query(
      'INSERT INTO bands (name, description, created_by) VALUES ($1, $2, $3)',
      [name.trim(), description?.trim() || null, req.user.id]
    );
    const bandId = insert.insertId;
    await client.query(
      `INSERT INTO band_members (band_id, user_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', NOW())`,
      [bandId, req.user.id]
    );
    const band = await client.query('SELECT id, name, description, created_by, created_at FROM bands WHERE id = $1', [bandId]);
    res.status(201).json({ band: { ...band.rows[0], members: [], my_role: 'owner' } });
  } catch (err) {
    console.error('Error creating band:', err);
    res.status(500).json({ message: 'Failed to create band' });
  } finally {
    client.release();
  }
});

// PATCH /api/bands/:id — update name/description (owner only)
router.patch('/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can edit band details' });

    const { name, description } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description?.trim() || null); }
    if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    values.push(req.params.id);
    await client.query(`UPDATE bands SET ${fields.join(', ')} WHERE id = $${idx}`, values);
    const band = await client.query('SELECT id, name, description, created_by, created_at FROM bands WHERE id = $1', [req.params.id]);
    res.json({ band: band.rows[0] });
  } catch (err) {
    console.error('Error updating band:', err);
    res.status(500).json({ message: 'Failed to update band' });
  } finally {
    client.release();
  }
});

// DELETE /api/bands/:id — delete band (owner only)
router.delete('/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can delete the band' });

    await client.query('DELETE FROM bands WHERE id = $1', [req.params.id]);
    res.json({ message: 'Band deleted' });
  } catch (err) {
    console.error('Error deleting band:', err);
    res.status(500).json({ message: 'Failed to delete band' });
  } finally {
    client.release();
  }
});

// POST /api/bands/:id/invites — invite a user by handle (owner only)
router.post('/:id/invites', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can invite members' });

    const { handle } = req.body;
    if (!handle) return res.status(400).json({ message: 'User handle is required' });

    const target = await client.query('SELECT id, handle, first_name, last_name FROM users WHERE handle = $1', [handle.trim()]);
    if (target.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    const targetUser = target.rows[0];

    if (targetUser.id === req.user.id) return res.status(400).json({ message: 'You are already in your own band' });

    const existing = await client.query(
      'SELECT status FROM band_members WHERE band_id = $1 AND user_id = $2',
      [req.params.id, targetUser.id]
    );
    if (existing.rowCount > 0) {
      const status = existing.rows[0].status;
      if (status === 'active') return res.status(409).json({ message: 'User is already a member' });
      if (status === 'invited') return res.status(409).json({ message: 'User already has a pending invite' });
      // declined — re-invite
      await client.query(
        `UPDATE band_members SET status = 'invited', invited_by = $3, joined_at = NULL WHERE band_id = $1 AND user_id = $2`,
        [req.params.id, targetUser.id, req.user.id]
      );
    } else {
      await client.query(
        `INSERT INTO band_members (band_id, user_id, role, status, invited_by) VALUES ($1, $2, 'member', 'invited', $3)`,
        [req.params.id, targetUser.id, req.user.id]
      );
    }

    res.status(201).json({ message: `Invite sent to @${targetUser.handle}` });
  } catch (err) {
    console.error('Error inviting member:', err);
    res.status(500).json({ message: 'Failed to send invite' });
  } finally {
    client.release();
  }
});

// POST /api/bands/:id/email-invites — invite a non-Prosaurus user by email
router.post('/:id/email-invites', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can invite members' });

    const { email } = req.body;
    if (!email || !email.trim()) return res.status(400).json({ message: 'Email is required' });
    const emailTrimmed = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed))
      return res.status(400).json({ message: 'Invalid email address' });

    // If they already have an account, redirect to handle invite
    const existing = await client.query('SELECT handle FROM users WHERE email = $1', [emailTrimmed]);
    if (existing.rowCount > 0)
      return res.status(409).json({
        message: `That email belongs to @${existing.rows[0].handle} — invite them by handle instead`
      });

    const band = await client.query('SELECT name FROM bands WHERE id = $1', [req.params.id]);
    if (band.rowCount === 0) return res.status(404).json({ message: 'Band not found' });

    // Check for existing pending invite to this email for this band
    const pendingInvite = await client.query(
      `SELECT id FROM band_email_invites WHERE band_id = $1 AND email = $2 AND status = 'pending' AND expires_at > NOW()`,
      [req.params.id, emailTrimmed]
    );
    if (pendingInvite.rowCount > 0)
      return res.status(409).json({ message: 'A pending invite has already been sent to that email' });

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await client.query(
      `INSERT INTO band_email_invites (band_id, invited_by, email, token, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, req.user.id, emailTrimmed, token, expiresAt]
    );

    const inviter = await client.query('SELECT handle, first_name FROM users WHERE id = $1', [req.user.id]);
    const inviterName = inviter.rows[0].first_name || `@${inviter.rows[0].handle}`;
    const bandName = band.rows[0].name;
    const appUrl = process.env.APP_URL || process.env.CORS_ORIGIN || 'https://www.prosaurus.com';
    const inviteUrl = `${appUrl}/band-invite/${token}`;

    const fromRow = await client.query(
      `SELECT from_address FROM system_emails WHERE is_active = true LIMIT 1`
    );
    const fromAddress = fromRow.rowCount > 0 ? fromRow.rows[0].from_address : 'noreply@prosaurus.com';

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
        <h2>You've been invited to join a band!</h2>
        <p>${inviterName} has invited you to join <strong>${bandName}</strong> on Prosaurus.</p>
        <p>Prosaurus is a platform for musicians to collaborate, share recordings, and jam together online.</p>
        <p style="margin:30px 0">
          <a href="${inviteUrl}" style="background:#007bff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
            Accept Invite
          </a>
        </p>
        <p style="color:#666;font-size:0.9em">This invite expires in 7 days. If you don't want to join, you can ignore this email.</p>
        <p style="color:#999;font-size:0.8em">Or copy and paste: ${inviteUrl}</p>
      </div>
    `;

    await sendMail(emailTrimmed, fromAddress, `${inviterName} invited you to join ${bandName} on Prosaurus`, html);

    res.status(201).json({ message: `Invite sent to ${emailTrimmed}` });
  } catch (err) {
    console.error('Error sending band email invite:', err);
    res.status(500).json({ message: 'Failed to send invite' });
  } finally {
    client.release();
  }
});

// PATCH /api/bands/:id/members/me — accept or decline an invite
router.patch('/:id/members/me', authenticate, async (req, res) => {
  const { action } = req.body; // 'accept' | 'decline'
  if (!['accept', 'decline'].includes(action)) return res.status(400).json({ message: 'Action must be accept or decline' });

  const client = await getClient();
  try {
    const invite = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'invited'`,
      [req.params.id, req.user.id]
    );
    if (invite.rowCount === 0) return res.status(404).json({ message: 'No pending invite found' });

    if (action === 'accept') {
      await client.query(
        `UPDATE band_members SET status = 'active', joined_at = NOW() WHERE band_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      res.json({ message: 'You have joined the band' });
    } else {
      await client.query(
        `UPDATE band_members SET status = 'declined' WHERE band_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      res.json({ message: 'Invite declined' });
    }
  } catch (err) {
    console.error('Error responding to invite:', err);
    res.status(500).json({ message: 'Failed to respond to invite' });
  } finally {
    client.release();
  }
});

// DELETE /api/bands/:id/members/:userId — remove a member (owner) or leave (self)
router.delete('/:id/members/:userId', authenticate, async (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const myRole = membership.rows[0].role;
    const isSelf = targetId === req.user.id;

    if (!isSelf && myRole !== 'owner') return res.status(403).json({ message: 'Only the owner can remove members' });

    const target = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2`,
      [req.params.id, targetId]
    );
    if (target.rowCount === 0) return res.status(404).json({ message: 'Member not found' });
    if (target.rows[0].role === 'owner' && !isSelf) return res.status(400).json({ message: 'Cannot remove the band owner' });

    await client.query('DELETE FROM band_members WHERE band_id = $1 AND user_id = $2', [req.params.id, targetId]);
    res.json({ message: isSelf ? 'You have left the band' : 'Member removed' });
  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ message: 'Failed to remove member' });
  } finally {
    client.release();
  }
});

// ─── Set Lists (any active member) ───────────────────────────────────────────

function parseSetlist(row) {
  let songs = [];
  try { songs = row.songs ? JSON.parse(row.songs) : []; } catch { songs = []; }
  return { ...row, songs };
}

// GET /api/bands/:id/setlists — list all set lists for a band
router.get('/:id/setlists', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const result = await client.query(
      `SELECT id, band_id, name, songs, created_at, updated_at FROM band_setlists WHERE band_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ setlists: result.rows.map(parseSetlist) });
  } catch (err) {
    console.error('Error fetching set lists:', err);
    res.status(500).json({ message: 'Failed to fetch set lists' });
  } finally {
    client.release();
  }
});

// POST /api/bands/:id/setlists — create a new (empty) set list
router.post('/:id/setlists', authenticate, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Set list name is required' });

  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const insert = await client.query(
      'INSERT INTO band_setlists (band_id, name, songs, created_by) VALUES ($1, $2, $3, $4)',
      [req.params.id, name.trim(), JSON.stringify([]), req.user.id]
    );
    const setlist = await client.query(
      'SELECT id, band_id, name, songs, created_at, updated_at FROM band_setlists WHERE id = $1',
      [insert.insertId]
    );
    res.status(201).json({ setlist: parseSetlist(setlist.rows[0]) });
  } catch (err) {
    console.error('Error creating set list:', err);
    res.status(500).json({ message: 'Failed to create set list' });
  } finally {
    client.release();
  }
});

// PATCH /api/bands/:id/setlists/:setlistId — rename a set list
router.patch('/:id/setlists/:setlistId', authenticate, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ message: 'Set list name is required' });

  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const existing = await client.query(
      'SELECT id FROM band_setlists WHERE id = $1 AND band_id = $2',
      [req.params.setlistId, req.params.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Set list not found' });

    await client.query('UPDATE band_setlists SET name = $1 WHERE id = $2', [name.trim(), req.params.setlistId]);
    const setlist = await client.query(
      'SELECT id, band_id, name, songs, created_at, updated_at FROM band_setlists WHERE id = $1',
      [req.params.setlistId]
    );
    res.json({ setlist: parseSetlist(setlist.rows[0]) });
  } catch (err) {
    console.error('Error renaming set list:', err);
    res.status(500).json({ message: 'Failed to rename set list' });
  } finally {
    client.release();
  }
});

// DELETE /api/bands/:id/setlists/:setlistId — delete a set list
router.delete('/:id/setlists/:setlistId', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const existing = await client.query(
      'SELECT id FROM band_setlists WHERE id = $1 AND band_id = $2',
      [req.params.setlistId, req.params.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Set list not found' });

    await client.query('DELETE FROM band_setlists WHERE id = $1', [req.params.setlistId]);
    res.json({ message: 'Set list deleted' });
  } catch (err) {
    console.error('Error deleting set list:', err);
    res.status(500).json({ message: 'Failed to delete set list' });
  } finally {
    client.release();
  }
});

// PUT /api/bands/:id/setlists/:setlistId/songs — replace the ordered song list
router.put('/:id/setlists/:setlistId/songs', authenticate, async (req, res) => {
  const { songs } = req.body;
  if (!Array.isArray(songs) || !songs.every(s => typeof s === 'string'))
    return res.status(400).json({ message: 'songs must be an array of strings' });

  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT id FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0) return res.status(403).json({ message: 'Not a member of this band' });

    const existing = await client.query(
      'SELECT id FROM band_setlists WHERE id = $1 AND band_id = $2',
      [req.params.setlistId, req.params.id]
    );
    if (existing.rowCount === 0) return res.status(404).json({ message: 'Set list not found' });

    const cleaned = songs.map(s => s.trim()).filter(Boolean);
    await client.query('UPDATE band_setlists SET songs = $1 WHERE id = $2', [JSON.stringify(cleaned), req.params.setlistId]);
    res.json({ songs: cleaned });
  } catch (err) {
    console.error('Error updating set list songs:', err);
    res.status(500).json({ message: 'Failed to update songs' });
  } finally {
    client.release();
  }
});

// ─── Band Page Management (owner only) ───────────────────────────────────────

// GET /api/bands/:id/page — get (or auto-create) band page settings
router.get('/:id/page', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    // Auto-create page record on first access
    await client.query(
      `INSERT IGNORE INTO band_pages (band_id) VALUES ($1)`,
      [req.params.id]
    );

    const page = await client.query(
      `SELECT bp.band_url, bp.story, bp.background_photo_key, bp.favicon_key, bp.background_color, bp.is_published,
              b.name AS band_name
       FROM band_pages bp
       JOIN bands b ON b.id = bp.band_id
       WHERE bp.band_id = $1`,
      [req.params.id]
    );

    // Members with their currently assigned instruments
    const members = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.photo_path, bm.role,
              GROUP_CONCAT(bmi.instrument_id ORDER BY bmi.instrument_id SEPARATOR ',') AS instrument_ids
       FROM band_members bm
       JOIN users u ON u.id = bm.user_id
       LEFT JOIN band_member_instruments bmi ON bmi.band_id = bm.band_id AND bmi.user_id = bm.user_id
       WHERE bm.band_id = $1 AND bm.status = 'active'
       GROUP BY u.id, u.handle, u.first_name, u.last_name, u.photo_path, bm.role
       ORDER BY bm.role = 'owner' DESC, u.handle`,
      [req.params.id]
    );

    // All instruments for the picker
    const instruments = await client.query(`SELECT id, name FROM instruments ORDER BY name`);

    // Band sessions available to feature
    const sessions = await client.query(
      `SELECT s.id, s.name, s.recorded_at, u.handle AS uploader_handle,
              i.name AS instrument_name,
              CASE WHEN bps.session_id IS NOT NULL THEN 1 ELSE 0 END AS on_page,
              COALESCE(bps.display_order, 999) AS display_order
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN band_page_songs bps ON bps.session_id = s.id AND bps.band_id = $1
       WHERE s.band_id = $1
       ORDER BY on_page DESC, bps.display_order ASC, s.recorded_at DESC`,
      [req.params.id]
    );

    const p = page.rows[0];
    res.json({
      band_name: p.band_name,
      band_url: p.band_url || '',
      story: p.story || '',
      background_photo_url: getS3Url(p.background_photo_key),
      background_photo_key: p.background_photo_key,
      favicon_url: getS3Url(p.favicon_key),
      favicon_key: p.favicon_key,
      background_color: p.background_color || '',
      is_published: !!p.is_published,
      members: members.rows.map(m => ({
        ...m,
        photo_url: m.photo_path ? `/api/uploads/${m.photo_path}` : null,
        instrument_ids: m.instrument_ids ? m.instrument_ids.split(',').map(Number) : []
      })),
      instruments: instruments.rows,
      sessions: sessions.rows
    });
  } catch (err) {
    console.error('Error fetching band page settings:', err);
    res.status(500).json({ message: 'Failed to load band page settings' });
  } finally {
    client.release();
  }
});

// PUT /api/bands/:id/page — update story, band_url, background_color, is_published
router.put('/:id/page', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    const { band_url, story, background_color, is_published } = req.body;

    if (band_url !== undefined) {
      if (!/^[a-z0-9-]+$/.test(band_url))
        return res.status(400).json({ message: 'URL can only contain lowercase letters, numbers, and hyphens' });
      // Check uniqueness
      const conflict = await client.query(
        `SELECT band_id FROM band_pages WHERE band_url = $1 AND band_id != $2`,
        [band_url, req.params.id]
      );
      if (conflict.rowCount > 0)
        return res.status(409).json({ message: 'That URL is already taken' });
    }

    if (background_color && !/^#[0-9a-fA-F]{6}$/.test(background_color))
      return res.status(400).json({ message: 'Background color must be a hex value like #1a1a2e' });

    const fields = [];
    const values = [];
    let idx = 1;
    if (band_url !== undefined) { fields.push(`band_url = $${idx++}`); values.push(band_url || null); }
    if (story !== undefined) { fields.push(`story = $${idx++}`); values.push(story || null); }
    if (background_color !== undefined) { fields.push(`background_color = $${idx++}`); values.push(background_color || null); }
    if (is_published !== undefined) { fields.push(`is_published = $${idx++}`); values.push(is_published ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    values.push(req.params.id);
    await client.query(`UPDATE band_pages SET ${fields.join(', ')} WHERE band_id = $${idx}`, values);
    res.json({ message: 'Band page updated' });
  } catch (err) {
    console.error('Error updating band page:', err);
    res.status(500).json({ message: 'Failed to update band page' });
  } finally {
    client.release();
  }
});

// POST /api/bands/:id/page/background — upload background photo
router.post('/:id/page/background', authenticate, imageUpload.single('photo'), async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    // Delete old background if it exists
    const existing = await client.query(`SELECT background_photo_key FROM band_pages WHERE band_id = $1`, [req.params.id]);
    if (existing.rowCount > 0 && existing.rows[0].background_photo_key)
      await deleteFromS3(existing.rows[0].background_photo_key);

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const key = `band-backgrounds/band_${req.params.id}_${Date.now()}${ext}`;
    const result = await uploadToS3(req.file.buffer, key, req.file.mimetype);
    if (!result.success) return res.status(500).json({ message: 'Image upload failed' });

    await client.query(`UPDATE band_pages SET background_photo_key = $1 WHERE band_id = $2`, [key, req.params.id]);
    res.json({ background_photo_url: getS3Url(key), background_photo_key: key });
  } catch (err) {
    console.error('Error uploading band background:', err);
    res.status(500).json({ message: 'Failed to upload background' });
  } finally {
    client.release();
  }
});

// DELETE /api/bands/:id/page/background — remove background photo
router.delete('/:id/page/background', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    const existing = await client.query(`SELECT background_photo_key FROM band_pages WHERE band_id = $1`, [req.params.id]);
    if (existing.rowCount > 0 && existing.rows[0].background_photo_key)
      await deleteFromS3(existing.rows[0].background_photo_key);

    await client.query(`UPDATE band_pages SET background_photo_key = NULL WHERE band_id = $1`, [req.params.id]);
    res.json({ message: 'Background removed' });
  } catch (err) {
    console.error('Error removing band background:', err);
    res.status(500).json({ message: 'Failed to remove background' });
  } finally {
    client.release();
  }
});

// POST /api/bands/:id/page/favicon — upload favicon
router.post('/:id/page/favicon', authenticate, faviconUpload.single('favicon'), async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    if (!req.file) return res.status(400).json({ message: 'No image file provided' });

    // Delete old favicon if it exists
    const existing = await client.query(`SELECT favicon_key FROM band_pages WHERE band_id = $1`, [req.params.id]);
    if (existing.rowCount > 0 && existing.rows[0].favicon_key)
      await deleteFromS3(existing.rows[0].favicon_key);

    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const key = `band-favicons/band_${req.params.id}_${Date.now()}${ext}`;
    const result = await uploadToS3(req.file.buffer, key, req.file.mimetype);
    if (!result.success) return res.status(500).json({ message: 'Image upload failed' });

    await client.query(`UPDATE band_pages SET favicon_key = $1 WHERE band_id = $2`, [key, req.params.id]);
    res.json({ favicon_url: getS3Url(key), favicon_key: key });
  } catch (err) {
    console.error('Error uploading band favicon:', err);
    res.status(500).json({ message: 'Failed to upload favicon' });
  } finally {
    client.release();
  }
});

// DELETE /api/bands/:id/page/favicon — remove favicon
router.delete('/:id/page/favicon', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    const existing = await client.query(`SELECT favicon_key FROM band_pages WHERE band_id = $1`, [req.params.id]);
    if (existing.rowCount > 0 && existing.rows[0].favicon_key)
      await deleteFromS3(existing.rows[0].favicon_key);

    await client.query(`UPDATE band_pages SET favicon_key = NULL WHERE band_id = $1`, [req.params.id]);
    res.json({ message: 'Favicon removed' });
  } catch (err) {
    console.error('Error removing band favicon:', err);
    res.status(500).json({ message: 'Failed to remove favicon' });
  } finally {
    client.release();
  }
});

// PUT /api/bands/:id/page/members/:userId/instruments — set instrument assignments for a member
router.put('/:id/page/members/:userId/instruments', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    const { instrumentIds } = req.body; // array of instrument IDs
    if (!Array.isArray(instrumentIds)) return res.status(400).json({ message: 'instrumentIds must be an array' });

    await client.query(
      `DELETE FROM band_member_instruments WHERE band_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId]
    );
    for (const instId of instrumentIds) {
      await client.query(
        `INSERT IGNORE INTO band_member_instruments (band_id, user_id, instrument_id) VALUES ($1, $2, $3)`,
        [req.params.id, req.params.userId, instId]
      );
    }
    res.json({ message: 'Instruments updated' });
  } catch (err) {
    console.error('Error updating member instruments:', err);
    res.status(500).json({ message: 'Failed to update instruments' });
  } finally {
    client.release();
  }
});

// PUT /api/bands/:id/page/songs — set featured songs (ordered array of session IDs)
router.put('/:id/page/songs', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const membership = await client.query(
      `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (membership.rowCount === 0 || membership.rows[0].role !== 'owner')
      return res.status(403).json({ message: 'Only the band owner can manage the band page' });

    const { sessionIds } = req.body; // ordered array
    if (!Array.isArray(sessionIds)) return res.status(400).json({ message: 'sessionIds must be an array' });

    await client.query(`DELETE FROM band_page_songs WHERE band_id = $1`, [req.params.id]);
    for (let i = 0; i < sessionIds.length; i++) {
      await client.query(
        `INSERT IGNORE INTO band_page_songs (band_id, session_id, display_order) VALUES ($1, $2, $3)`,
        [req.params.id, sessionIds[i], i]
      );
    }
    res.json({ message: 'Songs updated' });
  } catch (err) {
    console.error('Error updating band page songs:', err);
    res.status(500).json({ message: 'Failed to update songs' });
  } finally {
    client.release();
  }
});

module.exports = router;
