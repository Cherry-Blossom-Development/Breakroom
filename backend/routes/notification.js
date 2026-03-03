const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { emitToUser } = require('../utilities/socket');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies.jwtToken;
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query(
      'SELECT id, handle FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (user.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

/**
 * GET /api/notification/event-types
 * Returns all event types
 */
router.get('/event-types', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT id, type, description FROM event_types ORDER BY id'
    );
    res.status(200).json({ eventTypes: result.rows });
  } catch (err) {
    console.error('Error fetching event types:', err);
    res.status(500).json({ message: 'Failed to fetch event types' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/notification/notification-types
 * Returns all notification types with their target groups
 */
router.get('/notification-types', async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT nt.id, nt.name, nt.description, nt.display_type, nt.event_id,
              nt.repeat_rule, nt.is_active, nt.created_at,
              et.type as event_type
       FROM notification_types nt
       LEFT JOIN event_types et ON nt.event_id = et.id
       ORDER BY nt.id`
    );

    // Get groups and target users for each notification type
    const notificationTypes = [];
    for (const nt of result.rows) {
      const groupsResult = await client.query(
        `SELECT g.id, g.name
         FROM notification_type_groups ntg
         JOIN \`groups\` g ON ntg.group_id = g.id
         WHERE ntg.notification_type_id = $1`,
        [nt.id]
      );

      const targetUsersResult = await client.query(
        `SELECT target_type FROM notification_type_users WHERE notification_type_id = $1`,
        [nt.id]
      );

      notificationTypes.push({
        ...nt,
        groups: groupsResult.rows,
        target_users: targetUsersResult.rows.map(r => r.target_type)
      });
    }

    res.status(200).json({ notificationTypes });
  } catch (err) {
    console.error('Error fetching notification types:', err);
    res.status(500).json({ message: 'Failed to fetch notification types' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/notification/notification-types
 * Create a new notification type
 */
router.post('/notification-types', async (req, res) => {
  const { name, description, display_type, event_id, repeat_rule, group_ids, target_users } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();

    const insertResult = await client.query(
      `INSERT INTO notification_types (name, description, display_type, event_id, repeat_rule)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, description || null, display_type || 'header', event_id || null, repeat_rule || 'forever']
    );

    const notificationTypeId = insertResult.insertId;

    // Insert group associations if provided (empty array means all users)
    if (group_ids && group_ids.length > 0) {
      for (const groupId of group_ids) {
        await client.query(
          'INSERT INTO notification_type_groups (notification_type_id, group_id) VALUES ($1, $2)',
          [notificationTypeId, groupId]
        );
      }
    }

    // Insert target user types if provided
    if (target_users && target_users.length > 0) {
      for (const targetType of target_users) {
        await client.query(
          'INSERT INTO notification_type_users (notification_type_id, target_type) VALUES ($1, $2)',
          [notificationTypeId, targetType]
        );
      }
    }

    await client.commit();

    // Fetch the created notification type
    const result = await client.query(
      `SELECT nt.id, nt.name, nt.description, nt.display_type, nt.event_id,
              nt.repeat_rule, nt.is_active, nt.created_at,
              et.type as event_type
       FROM notification_types nt
       LEFT JOIN event_types et ON nt.event_id = et.id
       WHERE nt.id = $1`,
      [notificationTypeId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.rollback();
    console.error('Error creating notification type:', err);
    res.status(500).json({ message: 'Failed to create notification type' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/notification/notification-types/:id
 * Update a notification type
 */
router.put('/notification-types/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, display_type, event_id, repeat_rule, is_active, group_ids, target_users } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();

    const updateResult = await client.query(
      `UPDATE notification_types
       SET name = $1, description = $2, display_type = $3, event_id = $4,
           repeat_rule = $5, is_active = $6
       WHERE id = $7`,
      [name, description || null, display_type || 'header', event_id || null,
       repeat_rule || 'forever', is_active ?? true, id]
    );

    if (updateResult.affectedRows === 0) {
      await client.rollback();
      return res.status(404).json({ message: 'Notification type not found' });
    }

    // Clear and re-insert group associations
    await client.query(
      'DELETE FROM notification_type_groups WHERE notification_type_id = $1',
      [id]
    );

    if (group_ids && group_ids.length > 0) {
      for (const groupId of group_ids) {
        await client.query(
          'INSERT INTO notification_type_groups (notification_type_id, group_id) VALUES ($1, $2)',
          [id, groupId]
        );
      }
    }

    // Clear and re-insert target user types
    await client.query(
      'DELETE FROM notification_type_users WHERE notification_type_id = $1',
      [id]
    );

    if (target_users && target_users.length > 0) {
      for (const targetType of target_users) {
        await client.query(
          'INSERT INTO notification_type_users (notification_type_id, target_type) VALUES ($1, $2)',
          [id, targetType]
        );
      }
    }

    await client.commit();

    // Fetch the updated notification type
    const result = await client.query(
      `SELECT nt.id, nt.name, nt.description, nt.display_type, nt.event_id,
              nt.repeat_rule, nt.is_active, nt.created_at,
              et.type as event_type
       FROM notification_types nt
       LEFT JOIN event_types et ON nt.event_id = et.id
       WHERE nt.id = $1`,
      [id]
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    await client.rollback();
    console.error('Error updating notification type:', err);
    res.status(500).json({ message: 'Failed to update notification type' });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/notification/notification-types/:id
 * Delete a notification type
 */
router.delete('/notification-types/:id', async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM notification_types WHERE id = $1',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Notification type not found' });
    }

    res.status(200).json({ message: 'Notification type deleted' });
  } catch (err) {
    console.error('Error deleting notification type:', err);
    res.status(500).json({ message: 'Failed to delete notification type' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/notification/my
 * Get current user's active notifications
 */
router.get('/my', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT n.id, n.status, n.created_at,
              nt.name, nt.description, nt.display_type
       FROM notifications n
       JOIN notification_types nt ON n.notif_id = nt.id
       WHERE n.user_id = $1 AND n.status != 'dismissed'
       ORDER BY n.created_at DESC`,
      [req.user.id]
    );
    res.status(200).json({ notifications: result.rows });
  } catch (err) {
    console.error('Error fetching user notifications:', err);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/notification/:id/status
 * Update notification status (view/dismiss)
 */
router.put('/:id/status', authenticate, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['unviewed', 'viewed', 'dismissed'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      'UPDATE notifications SET status = $1 WHERE id = $2 AND user_id = $3',
      [status, id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.status(200).json({ message: 'Status updated' });
  } catch (err) {
    console.error('Error updating notification status:', err);
    res.status(500).json({ message: 'Failed to update status' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/notification/trigger/:eventTypeCode
 * Trigger an event and create notifications for eligible users
 */
router.post('/trigger/:eventTypeCode', authenticate, async (req, res) => {
  const { eventTypeCode } = req.params;
  const eventData = req.body;

  const client = await getClient();
  try {
    // Find the event type
    const eventTypeResult = await client.query(
      'SELECT id FROM event_types WHERE type = $1',
      [eventTypeCode]
    );

    if (eventTypeResult.rowCount === 0) {
      return res.status(404).json({ message: 'Event type not found' });
    }

    const eventTypeId = eventTypeResult.rows[0].id;

    // Log the event
    await client.query(
      'INSERT INTO events (type_id, user_id, data_json) VALUES ($1, $2, $3)',
      [eventTypeId, req.user.id, JSON.stringify(eventData)]
    );

    // Find notification types linked to this event
    const notifTypesResult = await client.query(
      `SELECT id, name, description, display_type, repeat_rule
       FROM notification_types
       WHERE event_id = $1 AND is_active = TRUE`,
      [eventTypeId]
    );

    const createdNotifications = [];

    for (const notifType of notifTypesResult.rows) {
      // Get target groups for this notification type
      const groupsResult = await client.query(
        'SELECT group_id FROM notification_type_groups WHERE notification_type_id = $1',
        [notifType.id]
      );

      // Get target user types for this notification type
      const targetUsersResult = await client.query(
        'SELECT target_type FROM notification_type_users WHERE notification_type_id = $1',
        [notifType.id]
      );
      const targetUserTypes = targetUsersResult.rows.map(r => r.target_type);

      let targetUserIds = new Set();

      // Handle individual targeting
      if (targetUserTypes.includes('trigger_user')) {
        targetUserIds.add(req.user.id);
      }

      if (targetUserTypes.includes('trigger_user_friends')) {
        // Get friends of the trigger user
        const friendsResult = await client.query(
          `SELECT CASE
             WHEN user_id = $1 THEN friend_id
             ELSE user_id
           END as friend_id
           FROM friends
           WHERE (user_id = $2 OR friend_id = $3) AND status = 'accepted'`,
          [req.user.id, req.user.id, req.user.id]
        );
        friendsResult.rows.forEach(r => targetUserIds.add(r.friend_id));
      }

      // Handle group targeting (only if no individual targeting is set)
      if (targetUserTypes.length === 0) {
        if (groupsResult.rowCount === 0) {
          // No groups specified - target all users
          const allUsersResult = await client.query('SELECT id FROM users');
          allUsersResult.rows.forEach(u => targetUserIds.add(u.id));
        } else {
          // Get users in the specified groups
          const groupIds = groupsResult.rows.map(g => g.group_id);
          const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(',');
          const usersInGroupsResult = await client.query(
            `SELECT DISTINCT user_id FROM user_groups WHERE group_id IN (${placeholders})`,
            groupIds
          );
          usersInGroupsResult.rows.forEach(u => targetUserIds.add(u.user_id));
        }
      }

      // Convert Set to Array
      const targetUserIdsArray = Array.from(targetUserIds);

      // For each target user, check repeat rule and create notification
      for (const userId of targetUserIdsArray) {
        // Check repeat rule
        if (notifType.repeat_rule !== 'forever') {
          const maxCount = parseInt(notifType.repeat_rule, 10);
          if (!isNaN(maxCount)) {
            const countResult = await client.query(
              'SELECT COUNT(*) as count FROM notifications WHERE notif_id = $1 AND user_id = $2',
              [notifType.id, userId]
            );
            if (countResult.rows[0].count >= maxCount) {
              continue; // Skip this user - they've reached the limit
            }
          }
        }

        // Create the notification
        const insertResult = await client.query(
          'INSERT INTO notifications (notif_id, user_id) VALUES ($1, $2)',
          [notifType.id, userId]
        );

        const notification = {
          id: insertResult.insertId,
          name: notifType.name,
          description: notifType.description,
          display_type: notifType.display_type,
          status: 'unviewed'
        };

        createdNotifications.push(notification);

        // Emit Socket.IO event to the user (works with multiple tabs and Redis adapter)
        emitToUser(userId, 'new_notification', notification);
      }
    }

    res.status(200).json({
      message: 'Event triggered',
      notificationsCreated: createdNotifications.length
    });
  } catch (err) {
    console.error('Error triggering event:', err);
    res.status(500).json({ message: 'Failed to trigger event' });
  } finally {
    client.release();
  }
});

module.exports = router;
