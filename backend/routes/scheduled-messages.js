const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

const authenticateToken = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = { id: user.rows[0].id, handle: user.rows[0].handle };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Create a scheduled message
router.post('/', authenticateToken, async (req, res) => {
  const { room_id, message_text, scheduled_at, warning_minutes, indicator_text } = req.body;

  if (!room_id || !message_text || !scheduled_at) {
    return res.status(400).json({ message: 'room_id, message_text, and scheduled_at are required' });
  }
  if (!message_text.trim() || message_text.length > 1000) {
    return res.status(400).json({ message: 'Message must be 1–1000 characters' });
  }

  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return res.status(400).json({ message: 'scheduled_at must be a future date/time' });
  }

  const warnMins = Math.max(0, Math.min(60, parseInt(warning_minutes) || 10));
  const indText = indicator_text !== undefined ? indicator_text : '- sent via scheduled message';

  const client = await getClient();
  try {
    const room = await client.query(
      `SELECT cr.id FROM chat_rooms cr
       LEFT JOIN users_rooms ur ON ur.room_id = cr.id AND ur.user_id = $1
       WHERE cr.id = $2 AND cr.is_active = true
         AND (cr.owner_id IS NULL OR (ur.user_id IS NOT NULL AND ur.accepted = true))`,
      [req.user.id, room_id]
    );
    if (room.rowCount === 0) {
      return res.status(403).json({ message: 'You are not a member of that room' });
    }

    const result = await client.query(
      `INSERT INTO scheduled_chat_messages
         (user_id, room_id, message_text, scheduled_at, warning_minutes, indicator_text)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, room_id, message_text.trim(), scheduledDate, warnMins, indText]
    );

    const created = await client.query(
      `SELECT scm.*, cr.name AS room_name
       FROM scheduled_chat_messages scm
       JOIN chat_rooms cr ON cr.id = scm.room_id
       WHERE scm.id = $1`,
      [result.insertId]
    );

    res.status(201).json({ scheduled_message: created.rows[0] });
  } catch (err) {
    console.error('Error creating scheduled message:', err);
    res.status(500).json({ message: 'Failed to create scheduled message' });
  } finally {
    client.release();
  }
});

// List user's active (pending/warning_sent/confirmed) scheduled messages
router.get('/', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT scm.*, cr.name AS room_name
       FROM scheduled_chat_messages scm
       JOIN chat_rooms cr ON cr.id = scm.room_id
       WHERE scm.user_id = $1 AND scm.status NOT IN ('sent', 'cancelled')
       ORDER BY scm.scheduled_at ASC`,
      [req.user.id]
    );
    res.json({ scheduled_messages: result.rows });
  } catch (err) {
    console.error('Error fetching scheduled messages:', err);
    res.status(500).json({ message: 'Failed to fetch scheduled messages' });
  } finally {
    client.release();
  }
});

// Update a scheduled message
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { message_text, scheduled_at, warning_minutes, indicator_text, room_id } = req.body;

  const client = await getClient();
  try {
    const existing = await client.query(
      'SELECT * FROM scheduled_chat_messages WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Scheduled message not found' });
    }

    const msg = existing.rows[0];
    if (msg.status === 'sent' || msg.status === 'cancelled') {
      return res.status(400).json({ message: 'Cannot edit a message that has already been sent or cancelled' });
    }

    const newText = message_text !== undefined ? message_text.trim() : msg.message_text;
    if (!newText || newText.length > 1000) {
      return res.status(400).json({ message: 'Message must be 1–1000 characters' });
    }

    const newDate = scheduled_at ? new Date(scheduled_at) : new Date(msg.scheduled_at);
    const newWarn = warning_minutes !== undefined
      ? Math.max(0, Math.min(60, parseInt(warning_minutes)))
      : msg.warning_minutes;
    const newIndicator = indicator_text !== undefined ? indicator_text : msg.indicator_text;
    const newRoomId = room_id !== undefined ? room_id : msg.room_id;

    await client.query(
      `UPDATE scheduled_chat_messages
       SET message_text = $1, scheduled_at = $2, warning_minutes = $3,
           indicator_text = $4, room_id = $5, is_editing = 0
       WHERE id = $6`,
      [newText, newDate, newWarn, newIndicator, newRoomId, id]
    );

    const updated = await client.query(
      `SELECT scm.*, cr.name AS room_name
       FROM scheduled_chat_messages scm
       JOIN chat_rooms cr ON cr.id = scm.room_id
       WHERE scm.id = $1`,
      [id]
    );

    res.json({ scheduled_message: updated.rows[0] });
  } catch (err) {
    console.error('Error updating scheduled message:', err);
    res.status(500).json({ message: 'Failed to update scheduled message' });
  } finally {
    client.release();
  }
});

// Cancel a scheduled message
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE scheduled_chat_messages SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status NOT IN ('sent', 'cancelled')`,
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Scheduled message not found or already sent/cancelled' });
    }
    res.json({ message: 'Cancelled' });
  } catch (err) {
    console.error('Error cancelling scheduled message:', err);
    res.status(500).json({ message: 'Failed to cancel' });
  } finally {
    client.release();
  }
});

// Explicitly confirm from warning (proceed with sending)
router.post('/:id/confirm', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE scheduled_chat_messages SET status = 'confirmed', is_editing = 0
       WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'warning_sent')`,
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Not found or not in a confirmable state' });
    }
    res.json({ message: 'Confirmed' });
  } catch (err) {
    console.error('Error confirming scheduled message:', err);
    res.status(500).json({ message: 'Failed to confirm' });
  } finally {
    client.release();
  }
});

// Pause for editing (from warning modal)
router.post('/:id/pause-edit', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE scheduled_chat_messages SET is_editing = 1
       WHERE id = $1 AND user_id = $2 AND status NOT IN ('sent', 'cancelled')`,
      [id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Not found or cannot be paused' });
    }
    res.json({ message: 'Paused for editing' });
  } catch (err) {
    console.error('Error pausing scheduled message:', err);
    res.status(500).json({ message: 'Failed to pause' });
  } finally {
    client.release();
  }
});

module.exports = router;
