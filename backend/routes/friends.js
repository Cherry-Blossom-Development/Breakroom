const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { emitToUser } = require('../utilities/socket');
const { sendToUser } = require('../utilities/fcm');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Auth middleware
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query(
      'SELECT id, handle FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Get list of accepted friends
router.get('/', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    // Get friends where either user_id or friend_id is the current user
    const friends = await client.query(
      `SELECT
        u.id, u.handle, u.first_name, u.last_name, u.photo_path,
        f.created_at as friends_since
       FROM friends f
       JOIN users u ON (
         (f.user_id = $1 AND f.friend_id = u.id) OR
         (f.friend_id = $2 AND f.user_id = u.id)
       )
       WHERE (f.user_id = $3 OR f.friend_id = $4)
         AND f.status = 'accepted'
       ORDER BY u.handle`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );

    res.json({ friends: friends.rows });
  } catch (err) {
    console.error('Error fetching friends:', err);
    res.status(500).json({ message: 'Failed to fetch friends' });
  } finally {
    client.release();
  }
});

// Get pending incoming friend requests
router.get('/requests', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const requests = await client.query(
      `SELECT
        u.id, u.handle, u.first_name, u.last_name, u.photo_path,
        f.created_at as requested_at
       FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );

    res.json({ requests: requests.rows });
  } catch (err) {
    console.error('Error fetching friend requests:', err);
    res.status(500).json({ message: 'Failed to fetch friend requests' });
  } finally {
    client.release();
  }
});

// Get pending outgoing friend requests (sent by current user)
router.get('/sent', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const sent = await client.query(
      `SELECT
        u.id, u.handle, u.first_name, u.last_name, u.photo_path,
        f.created_at as requested_at
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );

    res.json({ sent: sent.rows });
  } catch (err) {
    console.error('Error fetching sent requests:', err);
    res.status(500).json({ message: 'Failed to fetch sent requests' });
  } finally {
    client.release();
  }
});

// Send a friend request
router.post('/request/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const targetUserId = parseInt(userId);

  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: 'Cannot send friend request to yourself' });
  }

  const client = await getClient();
  try {
    // Check if target user exists
    const targetUser = await client.query(
      'SELECT id, handle FROM users WHERE id = $1',
      [targetUserId]
    );

    if (targetUser.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check for existing relationship in either direction
    const existing = await client.query(
      `SELECT status FROM friends
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4)`,
      [req.user.id, targetUserId, targetUserId, req.user.id]
    );

    if (existing.rowCount > 0) {
      const status = existing.rows[0].status;
      if (status === 'accepted') {
        return res.status(409).json({ message: 'Already friends with this user' });
      } else if (status === 'pending') {
        return res.status(409).json({ message: 'Friend request already pending' });
      } else if (status === 'blocked') {
        return res.status(403).json({ message: 'Cannot send friend request to this user' });
      }
    }

    // Create friend request
    await client.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)',
      [req.user.id, targetUserId, 'pending']
    );

    // Notify recipient if they have friend request notifications enabled
    const settingResult = await client.query(
      `SELECT notifications_enabled, notify_friend_requests
       FROM user_settings WHERE user_id = $1`,
      [targetUserId]
    );
    const s = settingResult.rows[0];
    const notifyEnabled = !s || (s.notifications_enabled && s.notify_friend_requests);
    if (notifyEnabled) {
      emitToUser(targetUserId, 'friend_badge_update', {});
      sendToUser(targetUserId, {
        type: 'friend_request',
        senderHandle: req.user.username
      }).catch(() => {});
    }

    res.status(201).json({ message: 'Friend request sent', user: targetUser.rows[0] });
  } catch (err) {
    console.error('Error sending friend request:', err);
    res.status(500).json({ message: 'Failed to send friend request' });
  } finally {
    client.release();
  }
});

// Accept a friend request
router.post('/accept/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const requesterUserId = parseInt(userId);

  const client = await getClient();
  try {
    // Verify pending request exists (where the other user sent to current user)
    const request = await client.query(
      'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = $3',
      [requesterUserId, req.user.id, 'pending']
    );

    if (request.rowCount === 0) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    // Accept the request
    await client.query(
      'UPDATE friends SET status = $1 WHERE user_id = $2 AND friend_id = $3',
      ['accepted', requesterUserId, req.user.id]
    );

    res.json({ message: 'Friend request accepted' });
  } catch (err) {
    console.error('Error accepting friend request:', err);
    res.status(500).json({ message: 'Failed to accept friend request' });
  } finally {
    client.release();
  }
});

// Decline a friend request
router.post('/decline/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const requesterUserId = parseInt(userId);

  const client = await getClient();
  try {
    // Verify pending request exists
    const request = await client.query(
      'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = $3',
      [requesterUserId, req.user.id, 'pending']
    );

    if (request.rowCount === 0) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    // Delete the request
    await client.query(
      'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2',
      [requesterUserId, req.user.id]
    );

    res.json({ message: 'Friend request declined' });
  } catch (err) {
    console.error('Error declining friend request:', err);
    res.status(500).json({ message: 'Failed to decline friend request' });
  } finally {
    client.release();
  }
});

// Cancel a sent friend request
router.delete('/request/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const targetUserId = parseInt(userId);

  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = $3',
      [req.user.id, targetUserId, 'pending']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Pending request not found' });
    }

    res.json({ message: 'Friend request cancelled' });
  } catch (err) {
    console.error('Error cancelling friend request:', err);
    res.status(500).json({ message: 'Failed to cancel friend request' });
  } finally {
    client.release();
  }
});

// Remove a friend (unfriend)
router.delete('/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const friendUserId = parseInt(userId);

  const client = await getClient();
  try {
    // Delete friendship in either direction
    const result = await client.query(
      `DELETE FROM friends
       WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4))
         AND status = 'accepted'`,
      [req.user.id, friendUserId, friendUserId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Friendship not found' });
    }

    res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('Error removing friend:', err);
    res.status(500).json({ message: 'Failed to remove friend' });
  } finally {
    client.release();
  }
});

// Block a user
router.post('/block/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const targetUserId = parseInt(userId);

  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: 'Cannot block yourself' });
  }

  const client = await getClient();
  try {
    // Check if target user exists
    const targetUser = await client.query(
      'SELECT id FROM users WHERE id = $1',
      [targetUserId]
    );

    if (targetUser.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete any existing relationship in either direction
    await client.query(
      'DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $3 AND friend_id = $4)',
      [req.user.id, targetUserId, targetUserId, req.user.id]
    );

    // Create block entry
    await client.query(
      'INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)',
      [req.user.id, targetUserId, 'blocked']
    );

    res.json({ message: 'User blocked' });
  } catch (err) {
    console.error('Error blocking user:', err);
    res.status(500).json({ message: 'Failed to block user' });
  } finally {
    client.release();
  }
});

// Unblock a user
router.delete('/block/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const targetUserId = parseInt(userId);

  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = $3',
      [req.user.id, targetUserId, 'blocked']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Block not found' });
    }

    res.json({ message: 'User unblocked' });
  } catch (err) {
    console.error('Error unblocking user:', err);
    res.status(500).json({ message: 'Failed to unblock user' });
  } finally {
    client.release();
  }
});

// Get blocked users
router.get('/blocked', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const blocked = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, f.created_at as blocked_at
       FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = $1 AND f.status = 'blocked'
       ORDER BY f.created_at DESC`,
      [req.user.id]
    );

    res.json({ blocked: blocked.rows });
  } catch (err) {
    console.error('Error fetching blocked users:', err);
    res.status(500).json({ message: 'Failed to fetch blocked users' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/friends/mark-seen
 * Marks all pending incoming friend requests as seen by the recipient.
 * Called when the user visits the Friends page.
 */
router.post('/mark-seen', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    await client.query(
      `UPDATE friends SET seen_by_recipient = TRUE
       WHERE friend_id = $1 AND status = 'pending' AND seen_by_recipient = FALSE`,
      [req.user.id]
    );
    res.json({ message: 'Friend requests marked seen' });
  } catch (err) {
    console.error('Error marking friend requests seen:', err);
    res.status(500).json({ message: 'Failed to mark seen' });
  } finally {
    client.release();
  }
});

module.exports = router;
