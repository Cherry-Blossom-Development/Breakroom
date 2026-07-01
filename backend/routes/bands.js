const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { isSubscribed } = require('../utilities/subscription');
const { sendMail } = require('../utilities/aws-ses-email');

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

module.exports = router;
