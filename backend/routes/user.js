const express = require('express');
const router = express.Router();

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../utilities/sendgrid-email');

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

router.get('/all', async (req, res) => {
  const client = await getClient();
  try {
    console.log('Fetching all users...');
    const users = await client.query(
      `SELECT 
         id, handle, first_name, last_name, email 
      FROM "users"
      ORDER BY id;`
    );

    res.status(200).json({
      message: 'Users retrieved',
      users: users.rows,
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Failed to retrieve users' });
  } finally {
    client.release();
  }
});


router.post('/invite', async (req, res) => {
  console.log('Request');
  //console.log(req);
  
  const { handle, email, first_name, last_name } = req.body;

  if (!handle || !email || !first_name || !last_name) {
    return res.status(400).json({ 
      message: 'Missing required fields.' 
    });
  }
  console.log(`Creating user ${handle} with email ${email}. ${first_name}, ${last_name}`);
  const client = await getClient();

  const existingUser = await client.query(
    'SELECT id FROM "users" WHERE handle = $1 OR email = $2;',
    [handle, email]
  );

  if (existingUser.rowCount > 0) {
    client.release();
    return res.status(409).json({
      message: 'User already exists with the provided handle or email.'
    });
  }

  const randomPassword = crypto.randomBytes(12).toString('base64'); // Temporary random password
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(randomPassword + salt).digest('hex');

  const verificationToken = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);

  await client.query(
    `INSERT INTO "users" 
      (handle, first_name, last_name, email, verification_token, verification_expires_at, hash, salt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
    [handle, first_name, last_name, email, verificationToken, expiresAt, hash, salt]
  );

  // Send invitation email
  await sendMail(
    email,
    'admin@prosaurus.com',
    'You’ve been invited to join prosaurus.com',
    `
    <h3>Welcome to Prosaurus!</h3>
    <p>You’ve been invited to join our platform. To activate your account and choose a password, please click the link below:</p>
    <p><a href="https://prosaurus.com/verify?token=${verificationToken}">Complete Your Registration</a></p>
    <p>This link will expire in 1 hour.</p>
    `
  );

  client.release();

  res.status(201).json({ message: 'Invitation sent to user.' });
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { user, permissions, groups } = req.body;

  // make sure the basic fields are available
  if (!user.handle || !user.first_name || !user.last_name || !user.email) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  const client = await getClient();
  try {
    // Check for duplicate handle or email (excluding current user)
    const existing = await client.query(
      'SELECT id FROM "users" WHERE (handle = $1 OR email = $2) AND id != $3;',
      [user.handle, user.email, id]
    );

    if (existing.rowCount > 0) {
      return res.status(409).json({
        message: 'Another user with this handle or email already exists.',
      });
    }

    // Begin the transactional part of the process
    await client.query('BEGIN');

    const searchResult = await client.query(
      `UPDATE users SET 
        handle = $1,
        first_name = $2,
        last_name = $3,
        email = $4
      WHERE id = $5`,
      [user.handle, user.first_name, user.last_name, user.email, id]
    );

    // make sure there is even a user to update
    if (searchResult.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Clear current permissions
    await client.query(
      `DELETE FROM user_permissions WHERE user_id = $1`,
      [id]
    );

    // Insert new ones
    const filteredPermissions = permissions.filter(p => p.has_permission);
    if (filteredPermissions.length > 0) {
      // this is some complicated bullshit to prevent sql injection, trust the robot bro, it works...
      const values = filteredPermissions
        .map((_, i) => `($1, $${i + 2})`)
        .join(',');

      const params = [id, ...filteredPermissions.map(p => p.permission_id)];

      await client.query(
        `INSERT INTO user_permissions (user_id, permission_id) VALUES ${values}`,
        params
      );
    }

    // Clear current groups
    await client.query(
      `DELETE FROM user_groups WHERE user_id = $1`,
      [id]
    );

    // Insert new ones
    const filteredGroups = groups.filter(p => p.has_group);
    if (filteredGroups.length > 0) {
      // more bs, one day you should examine this to actually understand it...
      const values = filteredGroups
        .map((_, i) => `($1, $${i + 2})`)
        .join(',');

      const params = [id, ...filteredGroups.map(p => p.group_id)];

      await client.query(
        `INSERT INTO user_groups (user_id, group_id) VALUES ${values}`,
        params
      );
    }

    await client.query('COMMIT');

    // Return updated user (optionally with fresh data if needed)
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);
    res.status(200).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating user', err);
    res.status(500).json({ message: 'Failed to update user' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'DELETE FROM users WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Failed to delete user.' });
  } finally {
    client.release();
  }
});

router.get('/permissionMatrix/:id', async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    console.log('Fetching all user related permission data');
    const permissionsResult = await client.query(
      `SELECT 
        p.id, p.name, p.description, p.is_active,
        CASE 
          WHEN up.user_id IS NOT NULL THEN true
          ELSE false 
        END AS has_permission
      FROM permissions p
      LEFT JOIN user_permissions up
        ON p.id = up.permission_id
        AND up.user_id = $1
      WHERE up.user_id = $1
        OR up.user_id IS NULL;`,
      [id]
    );

    console.log('Fetching all group data');
    const groupsResult = await client.query(
      `SELECT 
        g.id, g.name, g.description, g.is_active,
        CASE
          WHEN ug.user_id IS NOT NULL THEN true
          ELSE false
        END AS has_group
      FROM groups g
      LEFT JOIN user_groups ug
        ON g.id = ug.group_id
        AND ug.user_id = $1
      WHERE ug.user_id = $1
        OR ug.user_id IS NULL
      ORDER BY g.id;`,
      [id]
    );

    const groups = groupsResult.rows;

    console.log('Fetching group_permissions for each group');

    for (const group of groups) {
      const groupPermissionsResult = await client.query(
        'SELECT permission_id FROM group_permissions WHERE group_id = $1',
        [group.id]
      );

      group.group_permissions = groupPermissionsResult.rows.map(row => row.permission_id);
    }

    res.status(200).json({
      message: 'Permission matrix retrieved',
      permissions: permissionsResult.rows,
      groups: groups
    });

  } catch (err) {
    console.error('Error fetching permission matrix', err);
    res.status(500).json({ message: 'Failed to retrieve permission matrix' });
  } finally {
    client.release();
  }
});



router.put('/:id/password', authenticate, checkPermission('admin_access'), async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');

  const client = await getClient();
  try {
    const result = await client.query(
      'UPDATE users SET hash = $1, salt = $2 WHERE id = $3',
      [hash, salt, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ message: 'Failed to update password.' });
  } finally {
    client.release();
  }
});

// ── Notification settings ────────────────────────────────────────────────────

/**
 * GET /api/user/notification-settings
 * Returns the current user's notification preferences.
 * Missing row = all defaults ON.
 */
router.get('/notification-settings', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT notifications_enabled, notify_chat_messages,
              notify_friend_requests, notify_blog_comments
       FROM user_settings WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.json({
        notifications_enabled: true,
        notify_chat_messages: true,
        notify_friend_requests: true,
        notify_blog_comments: true
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching notification settings:', err);
    res.status(500).json({ message: 'Failed to fetch settings' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/user/notification-settings
 * Upserts the current user's notification preferences.
 */
router.put('/notification-settings', authenticate, async (req, res) => {
  const { notifications_enabled, notify_chat_messages, notify_friend_requests, notify_blog_comments } = req.body;
  const client = await getClient();
  try {
    await client.query(
      `INSERT INTO user_settings
         (user_id, notifications_enabled, notify_chat_messages, notify_friend_requests, notify_blog_comments)
       VALUES ($1, $2, $3, $4, $5)
       ON DUPLICATE KEY UPDATE
         notifications_enabled  = VALUES(notifications_enabled),
         notify_chat_messages   = VALUES(notify_chat_messages),
         notify_friend_requests = VALUES(notify_friend_requests),
         notify_blog_comments   = VALUES(notify_blog_comments)`,
      [req.user.id,
       notifications_enabled ?? true,
       notify_chat_messages ?? true,
       notify_friend_requests ?? true,
       notify_blog_comments ?? true]
    );
    res.json({ message: 'Settings saved' });
  } catch (err) {
    console.error('Error saving notification settings:', err);
    res.status(500).json({ message: 'Failed to save settings' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/user/badge-counts
 * Returns all badge counts for the current user:
 *   chatUnread: { [roomId]: count }  — rooms where unread > 0
 *   friendRequestsUnread: N          — pending requests not yet seen
 *   blogCommentsUnread: N            — author's posts with new comments
 */
router.get('/badge-counts', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    // Respect master toggle and per-type setting (absence of row = defaults ON)
    const settingsResult = await client.query(
      `SELECT notifications_enabled, notify_chat_messages,
              notify_friend_requests, notify_blog_comments
       FROM user_settings WHERE user_id = $1`,
      [req.user.id]
    );
    const s = settingsResult.rows[0] || {
      notifications_enabled: true,
      notify_chat_messages: true,
      notify_friend_requests: true,
      notify_blog_comments: true
    };

    const chatUnread = {};
    let friendRequestsUnread = 0;
    let blogCommentsUnread = 0;
    let blogUnreadByPost = {};

    if (s.notifications_enabled) {
      // Chat: unread per room (messages after last_read_at, excluding own messages)
      if (s.notify_chat_messages) {
        const chatResult = await client.query(
          `SELECT ur.room_id,
                  COUNT(m.id) AS unread_count
           FROM users_rooms ur
           JOIN chat_messages m ON m.room_id = ur.room_id
           WHERE ur.user_id = $1
             AND ur.accepted = TRUE
             AND ur.notifications_muted = FALSE
             AND m.user_id != $2
             AND (ur.last_read_at IS NULL OR m.created_at > ur.last_read_at)
           GROUP BY ur.room_id`,
          [req.user.id, req.user.id]
        );
        for (const row of chatResult.rows) {
          chatUnread[row.room_id] = parseInt(row.unread_count, 10);
        }
      }

      // Friend requests: pending rows not yet seen by recipient
      if (s.notify_friend_requests) {
        const frResult = await client.query(
          `SELECT COUNT(*) AS cnt FROM friends
           WHERE friend_id = $1 AND status = 'pending' AND seen_by_recipient = FALSE`,
          [req.user.id]
        );
        friendRequestsUnread = parseInt(frResult.rows[0].cnt, 10);
      }

      // Blog: per-post unread comment counts for posts owned by user
      if (s.notify_blog_comments) {
        const blogResult = await client.query(
          `SELECT c.blog_post_id, COUNT(*) AS unread_count
           FROM blog_comments c
           JOIN blog_posts bp ON c.blog_post_id = bp.id
           LEFT JOIN user_post_last_read ulr
             ON ulr.user_id = $1 AND ulr.post_id = c.blog_post_id
           WHERE bp.user_id = $2
             AND c.user_id != $3
             AND c.is_deleted = FALSE
             AND (ulr.last_read_at IS NULL OR c.created_at > ulr.last_read_at)
           GROUP BY c.blog_post_id`,
          [req.user.id, req.user.id, req.user.id]
        );
        for (const row of blogResult.rows) {
          blogUnreadByPost[row.blog_post_id] = parseInt(row.unread_count, 10);
        }
        blogCommentsUnread = blogResult.rows.length;  // distinct post count
      }
    }

    res.json({ chatUnread, friendRequestsUnread, blogCommentsUnread, blogUnreadByPost });
  } catch (err) {
    console.error('Error fetching badge counts:', err);
    res.status(500).json({ message: 'Failed to fetch badge counts' });
  } finally {
    client.release();
  }
});

module.exports = router;