const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { getClient } = require('../utilities/db');
const { checkPermission } = require('../middleware/checkPermission');
const { getIO } = require('../utilities/socket');
const { uploadToS3 } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

// Configure multer for memory storage (buffer for S3 upload)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Configure multer for video uploads
const videoUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for videos
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|webm|mov|avi|mkv/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = /video/.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

const SECRET_KEY = process.env.SECRET_KEY;

// Middleware to verify JWT and get user info
const authenticateToken = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, SECRET_KEY);

    // Get user ID from database
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();

    if (user.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = {
      id: user.rows[0].id,
      handle: user.rows[0].handle
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Get all chat rooms (only rooms user is a member of, plus General)
router.get('/rooms', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const rooms = await client.query(
      `SELECT cr.id, cr.name, cr.description, cr.is_active, cr.created_at,
              cr.owner_id, u.handle as owner_handle
       FROM chat_rooms cr
       LEFT JOIN users u ON cr.owner_id = u.id
       LEFT JOIN users_rooms ur ON cr.id = ur.room_id AND ur.user_id = $1
       WHERE cr.is_active = true
         AND (cr.owner_id IS NULL OR (ur.user_id IS NOT NULL AND ur.accepted = true))
       ORDER BY cr.name`,
      [req.user.id]
    );

    res.status(200).json({
      rooms: rooms.rows
    });
  } catch (err) {
    console.error('Error fetching chat rooms:', err);
    res.status(500).json({ message: 'Failed to retrieve chat rooms' });
  } finally {
    client.release();
  }
});

// Get messages for a room (with pagination)
router.get('/rooms/:roomId/messages', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { limit = 50, before } = req.query; // before is a message ID for pagination

  const client = await getClient();
  try {
    let query;
    let params;

    if (before) {
      // Get messages before a specific message ID (for loading older messages)
      query = `
        SELECT
          m.id, m.message, m.image_path, m.video_path, m.created_at,
          u.id as user_id, u.handle
        FROM chat_messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.room_id = $1 AND m.id < $2
        ORDER BY m.created_at DESC
        LIMIT $3
      `;
      params = [roomId, before, parseInt(limit)];
    } else {
      // Get most recent messages
      query = `
        SELECT
          m.id, m.message, m.image_path, m.video_path, m.created_at,
          u.id as user_id, u.handle
        FROM chat_messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.room_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `;
      params = [roomId, parseInt(limit)];
    }

    const messages = await client.query(query, params);

    // Reverse to get chronological order
    res.status(200).json({
      messages: messages.rows.reverse()
    });
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ message: 'Failed to retrieve messages' });
  } finally {
    client.release();
  }
});

// Send a message to a room (REST fallback when socket not available)
router.post('/rooms/:roomId/messages', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { message } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ message: 'Message cannot be empty' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ message: 'Message cannot exceed 1000 characters' });
  }

  const client = await getClient();
  try {
    // Verify room exists
    const room = await client.query('SELECT id FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    // Insert message
    const result = await client.query(
      'INSERT INTO chat_messages (room_id, user_id, message) VALUES ($1, $2, $3)',
      [roomId, req.user.id, message.trim()]
    );

    // Get the inserted message with user info
    const newMessage = await client.query(
      `SELECT
        m.id, m.message, m.image_path, m.video_path, m.created_at,
        u.id as user_id, u.handle
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = $1`,
      [result.insertId]
    );

    const messageData = newMessage.rows[0];

    // Broadcast message to everyone in the room via socket
    const io = getIO();
    if (io) {
      io.to(`room_${roomId}`).emit('new_message', {
        roomId: parseInt(roomId),
        message: messageData
      });
    }

    res.status(201).json({ message: messageData });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ message: 'Failed to send message' });
  } finally {
    client.release();
  }
});

// Upload an image to a room
router.post('/rooms/:roomId/image', authenticateToken, upload.single('image'), async (req, res) => {
  const { roomId } = req.params;
  const { message } = req.body; // Optional text message with the image

  if (!req.file) {
    return res.status(400).json({ message: 'No image uploaded' });
  }

  const client = await getClient();
  try {
    // Verify room exists
    const room = await client.query('SELECT id FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    // Generate S3 key
    const ext = path.extname(req.file.originalname).toLowerCase();
    const s3Key = `chat/chat_${req.user.id}_${Date.now()}${ext}`;

    // Upload to S3
    const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);

    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload image: ' + uploadResult.error });
    }

    // Insert message with S3 key as image_path
    const result = await client.query(
      'INSERT INTO chat_messages (room_id, user_id, message, image_path) VALUES ($1, $2, $3, $4)',
      [roomId, req.user.id, message?.trim() || null, s3Key]
    );

    // Get the inserted message with user info
    const newMessage = await client.query(
      `SELECT
        m.id, m.message, m.image_path, m.video_path, m.created_at,
        u.id as user_id, u.handle
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = $1`,
      [result.insertId]
    );

    const messageData = newMessage.rows[0];

    // Broadcast message to everyone in the room via socket
    const io = getIO();
    if (io) {
      io.to(`room_${roomId}`).emit('new_message', {
        roomId: parseInt(roomId),
        message: messageData
      });
    }

    res.status(201).json({
      message: messageData
    });
  } catch (err) {
    console.error('Error uploading image:', err);
    res.status(500).json({ message: 'Failed to upload image' });
  } finally {
    client.release();
  }
});

// Upload a video to a room
router.post('/rooms/:roomId/video', authenticateToken, videoUpload.single('video'), async (req, res) => {
  const { roomId } = req.params;
  const { message } = req.body; // Optional text message with the video

  if (!req.file) {
    return res.status(400).json({ message: 'No video uploaded' });
  }

  const client = await getClient();
  try {
    // Verify room exists
    const room = await client.query('SELECT id FROM chat_rooms WHERE id = $1 AND is_active = true', [roomId]);
    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Chat room not found' });
    }

    // Generate S3 key
    const ext = path.extname(req.file.originalname).toLowerCase();
    const s3Key = `chat/video_${req.user.id}_${Date.now()}${ext}`;

    // Upload to S3
    const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);

    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload video: ' + uploadResult.error });
    }

    // Insert message with S3 key as video_path
    const result = await client.query(
      'INSERT INTO chat_messages (room_id, user_id, message, video_path) VALUES ($1, $2, $3, $4)',
      [roomId, req.user.id, message?.trim() || null, s3Key]
    );

    // Get the inserted message with user info
    const newMessage = await client.query(
      `SELECT
        m.id, m.message, m.image_path, m.video_path, m.created_at,
        u.id as user_id, u.handle
      FROM chat_messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = $1`,
      [result.insertId]
    );

    const messageData = newMessage.rows[0];

    // Broadcast message to everyone in the room via socket
    const io = getIO();
    if (io) {
      io.to(`room_${roomId}`).emit('new_message', {
        roomId: parseInt(roomId),
        message: messageData
      });
    }

    res.status(201).json({
      message: messageData
    });
  } catch (err) {
    console.error('Error uploading video:', err);
    res.status(500).json({ message: 'Failed to upload video' });
  } finally {
    client.release();
  }
});

// Create a new chat room
router.post('/rooms', authenticateToken, checkPermission('create_room'), async (req, res) => {
  const { name, description } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ message: 'Room name is required' });
  }

  if (name.length > 64) {
    return res.status(400).json({ message: 'Room name cannot exceed 64 characters' });
  }

  const client = await getClient();
  try {
    // Check for duplicate room name
    const existing = await client.query(
      'SELECT id FROM chat_rooms WHERE name = $1',
      [name.trim()]
    );

    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'A room with this name already exists' });
    }

    // Insert the new room
    const result = await client.query(
      'INSERT INTO chat_rooms (name, description, owner_id) VALUES ($1, $2, $3)',
      [name.trim(), description?.trim() || null, req.user.id]
    );

    const roomId = result.insertId;

    // Auto-add creator as accepted member
    await client.query(
      'INSERT INTO users_rooms (user_id, room_id, role, accepted) VALUES ($1, $2, $3, $4)',
      [req.user.id, roomId, 'moderator', true]
    );

    // Fetch the created room
    const newRoom = await client.query(
      `SELECT cr.id, cr.name, cr.description, cr.is_active, cr.created_at,
              cr.owner_id, u.handle as owner_handle
       FROM chat_rooms cr
       LEFT JOIN users u ON cr.owner_id = u.id
       WHERE cr.id = $1`,
      [roomId]
    );

    res.status(201).json({ room: newRoom.rows[0] });
  } catch (err) {
    console.error('Error creating chat room:', err);
    res.status(500).json({ message: 'Failed to create chat room' });
  } finally {
    client.release();
  }
});

// Update a chat room (owner only)
router.put('/rooms/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ message: 'Room name is required' });
  }

  if (name.length > 64) {
    return res.status(400).json({ message: 'Room name cannot exceed 64 characters' });
  }

  const client = await getClient();
  try {
    // Verify room exists and check ownership
    const room = await client.query(
      'SELECT owner_id FROM chat_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the room owner can edit this room' });
    }

    // Check for duplicate name (excluding current room)
    const existing = await client.query(
      'SELECT id FROM chat_rooms WHERE name = $1 AND id != $2',
      [name.trim(), id]
    );

    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'A room with this name already exists' });
    }

    // Update the room
    await client.query(
      'UPDATE chat_rooms SET name = $1, description = $2 WHERE id = $3',
      [name.trim(), description?.trim() || null, id]
    );

    // Fetch updated room
    const updated = await client.query(
      `SELECT cr.id, cr.name, cr.description, cr.is_active, cr.created_at,
              cr.owner_id, u.handle as owner_handle
       FROM chat_rooms cr
       LEFT JOIN users u ON cr.owner_id = u.id
       WHERE cr.id = $1`,
      [id]
    );

    res.status(200).json({ room: updated.rows[0] });
  } catch (err) {
    console.error('Error updating chat room:', err);
    res.status(500).json({ message: 'Failed to update chat room' });
  } finally {
    client.release();
  }
});

// Delete a chat room (owner only, soft delete)
router.delete('/rooms/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    // Verify room exists and check ownership
    const room = await client.query(
      'SELECT owner_id, name FROM chat_rooms WHERE id = $1 AND is_active = true',
      [id]
    );

    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // Prevent deletion of General room (owner_id is null)
    if (room.rows[0].owner_id === null) {
      return res.status(403).json({ message: 'The General room cannot be deleted' });
    }

    if (room.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the room owner can delete this room' });
    }

    // Soft delete (set is_active = false)
    await client.query(
      'UPDATE chat_rooms SET is_active = false WHERE id = $1',
      [id]
    );

    res.status(200).json({ message: 'Room deleted successfully' });
  } catch (err) {
    console.error('Error deleting chat room:', err);
    res.status(500).json({ message: 'Failed to delete chat room' });
  } finally {
    client.release();
  }
});

// Get pending invites for current user
router.get('/invites', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const invites = await client.query(
      `SELECT ur.room_id, ur.created_at as invited_at,
              cr.name as room_name, cr.description as room_description,
              u.handle as invited_by_handle
       FROM users_rooms ur
       JOIN chat_rooms cr ON ur.room_id = cr.id
       LEFT JOIN users u ON ur.invited_by = u.id
       WHERE ur.user_id = $1 AND ur.accepted = false AND cr.is_active = true
       ORDER BY ur.created_at DESC`,
      [req.user.id]
    );

    res.status(200).json({ invites: invites.rows });
  } catch (err) {
    console.error('Error fetching invites:', err);
    res.status(500).json({ message: 'Failed to retrieve invites' });
  } finally {
    client.release();
  }
});

// Get members of a room
router.get('/rooms/:roomId/members', authenticateToken, async (req, res) => {
  const { roomId } = req.params;

  const client = await getClient();
  try {
    // Verify user has access to this room (is member or room is General)
    const room = await client.query(
      'SELECT owner_id FROM chat_rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );

    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    // For non-General rooms, verify membership
    if (room.rows[0].owner_id !== null) {
      const membership = await client.query(
        'SELECT 1 FROM users_rooms WHERE user_id = $1 AND room_id = $2 AND accepted = true',
        [req.user.id, roomId]
      );
      if (membership.rowCount === 0) {
        return res.status(403).json({ message: 'You are not a member of this room' });
      }
    }

    const members = await client.query(
      `SELECT u.id, u.handle, ur.role, ur.created_at as joined_at
       FROM users_rooms ur
       JOIN users u ON ur.user_id = u.id
       WHERE ur.room_id = $1 AND ur.accepted = true
       ORDER BY ur.created_at`,
      [roomId]
    );

    res.status(200).json({ members: members.rows });
  } catch (err) {
    console.error('Error fetching room members:', err);
    res.status(500).json({ message: 'Failed to retrieve room members' });
  } finally {
    client.release();
  }
});

// Invite a user to a room (owner only)
router.post('/rooms/:roomId/invite', authenticateToken, async (req, res) => {
  const { roomId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ message: 'User ID is required' });
  }

  const client = await getClient();
  try {
    // Verify room exists and user is owner
    const room = await client.query(
      'SELECT owner_id FROM chat_rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );

    if (room.rowCount === 0) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.rows[0].owner_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the room owner can invite users' });
    }

    // Verify target user exists
    const targetUser = await client.query(
      'SELECT id, handle FROM users WHERE id = $1',
      [userId]
    );

    if (targetUser.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already invited or member
    const existing = await client.query(
      'SELECT accepted FROM users_rooms WHERE user_id = $1 AND room_id = $2',
      [userId, roomId]
    );

    if (existing.rowCount > 0) {
      if (existing.rows[0].accepted) {
        return res.status(409).json({ message: 'User is already a member of this room' });
      } else {
        return res.status(409).json({ message: 'User has already been invited to this room' });
      }
    }

    // Create the invite
    await client.query(
      'INSERT INTO users_rooms (user_id, room_id, invited_by, accepted) VALUES ($1, $2, $3, $4)',
      [userId, roomId, req.user.id, false]
    );

    res.status(201).json({ message: 'Invite sent successfully', user: targetUser.rows[0] });
  } catch (err) {
    console.error('Error inviting user:', err);
    res.status(500).json({ message: 'Failed to send invite' });
  } finally {
    client.release();
  }
});

// Accept an invite
router.post('/invites/:roomId/accept', authenticateToken, async (req, res) => {
  const { roomId } = req.params;

  const client = await getClient();
  try {
    // Verify invite exists
    const invite = await client.query(
      'SELECT 1 FROM users_rooms WHERE user_id = $1 AND room_id = $2 AND accepted = false',
      [req.user.id, roomId]
    );

    if (invite.rowCount === 0) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    // Accept the invite
    await client.query(
      'UPDATE users_rooms SET accepted = true WHERE user_id = $1 AND room_id = $2',
      [req.user.id, roomId]
    );

    // Fetch the room details
    const room = await client.query(
      `SELECT cr.id, cr.name, cr.description, cr.is_active, cr.created_at,
              cr.owner_id, u.handle as owner_handle
       FROM chat_rooms cr
       LEFT JOIN users u ON cr.owner_id = u.id
       WHERE cr.id = $1`,
      [roomId]
    );

    res.status(200).json({ message: 'Invite accepted', room: room.rows[0] });
  } catch (err) {
    console.error('Error accepting invite:', err);
    res.status(500).json({ message: 'Failed to accept invite' });
  } finally {
    client.release();
  }
});

// Decline an invite
router.post('/invites/:roomId/decline', authenticateToken, async (req, res) => {
  const { roomId } = req.params;

  const client = await getClient();
  try {
    // Verify invite exists
    const invite = await client.query(
      'SELECT 1 FROM users_rooms WHERE user_id = $1 AND room_id = $2 AND accepted = false',
      [req.user.id, roomId]
    );

    if (invite.rowCount === 0) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    // Delete the invite
    await client.query(
      'DELETE FROM users_rooms WHERE user_id = $1 AND room_id = $2',
      [req.user.id, roomId]
    );

    res.status(200).json({ message: 'Invite declined' });
  } catch (err) {
    console.error('Error declining invite:', err);
    res.status(500).json({ message: 'Failed to decline invite' });
  } finally {
    client.release();
  }
});

module.exports = router;
