const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { sendMail } = require('../utilities/aws-ses-email');
const { emitToUser } = require('../utilities/socket');
const { invalidateCache } = require('../utilities/contentFilter');

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;

const TABLE_MAP = {
  post: 'blog_posts',
  comment: 'blog_comments',
  chat_message: 'chat_messages',
  artwork: 'gallery_artworks',
  lyrics: 'lyrics'
};

const VALID_CONTENT_TYPES = ['post', 'comment', 'chat_message', 'artwork', 'lyrics', 'user', 'profile', 'other'];

// =====================================
// Auth middleware
// =====================================

const authenticate = async (req, res, next) => {
  const token = req.cookies.jwtToken;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = user.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const requireAdmin = async (req, res, next) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT 1 FROM user_permissions up
       JOIN permissions p ON up.permission_id = p.id
       WHERE up.user_id = $1 AND p.name = 'admin_access'
       UNION
       SELECT 1 FROM user_groups ug
       JOIN group_permissions gp ON ug.group_id = gp.group_id
       JOIN permissions p ON gp.permission_id = p.id
       WHERE ug.user_id = $2 AND p.name = 'admin_access'`,
      [req.user.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(403).json({ message: 'Admin access required' });
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Error checking permissions' });
  } finally {
    client.release();
  }
};

// =====================================
// Helper functions
// =====================================

async function notifyAdmins(client) {
  const ntResult = await client.query(
    `SELECT nt.id, nt.name, nt.description, nt.display_type
     FROM notification_types nt
     JOIN event_types et ON nt.event_id = et.id
     WHERE et.type = 'content_reported' AND nt.is_active = TRUE LIMIT 1`
  );
  if (ntResult.rowCount === 0) return;
  const notifType = ntResult.rows[0];
  const adminsResult = await client.query(
    `SELECT DISTINCT ug.user_id FROM user_groups ug
     JOIN \`groups\` g ON ug.group_id = g.id
     WHERE g.name = 'Administrator'`
  );
  for (const admin of adminsResult.rows) {
    const ins = await client.query(
      'INSERT INTO notifications (notif_id, user_id, status) VALUES ($1, $2, $3)',
      [notifType.id, admin.user_id, 'unviewed']
    );
    emitToUser(admin.user_id, 'new_notification', {
      id: ins.insertId,
      name: notifType.name,
      description: notifType.description,
      display_type: notifType.display_type,
      status: 'unviewed'
    });
  }
}

async function getContentDetails(client, contentType, contentId) {
  try {
    if (contentType === 'post') {
      const result = await client.query(
        `SELECT bp.title, bp.content, bp.user_id, u.handle
         FROM blog_posts bp
         JOIN users u ON bp.user_id = u.id
         WHERE bp.id = $1`,
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      const snippet = (row.title || '') + ' ' + (row.content || '');
      return { snippet: snippet.substring(0, 200), authorId: row.user_id, authorHandle: row.handle };
    }
    if (contentType === 'comment') {
      const result = await client.query(
        `SELECT bc.content, bc.user_id, u.handle
         FROM blog_comments bc
         JOIN users u ON bc.user_id = u.id
         WHERE bc.id = $1`,
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return { snippet: (row.content || '').substring(0, 200), authorId: row.user_id, authorHandle: row.handle };
    }
    if (contentType === 'chat_message') {
      const result = await client.query(
        `SELECT cm.message, cm.user_id, u.handle
         FROM chat_messages cm
         JOIN users u ON cm.user_id = u.id
         WHERE cm.id = $1`,
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return { snippet: (row.message || '').substring(0, 200), authorId: row.user_id, authorHandle: row.handle };
    }
    if (contentType === 'artwork') {
      const result = await client.query(
        `SELECT ga.title, ga.description, ga.user_id, u.handle
         FROM gallery_artworks ga
         JOIN users u ON ga.user_id = u.id
         WHERE ga.id = $1`,
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      const snippet = (row.title || '') + ' ' + (row.description || '');
      return { snippet: snippet.substring(0, 200), authorId: row.user_id, authorHandle: row.handle };
    }
    if (contentType === 'lyrics') {
      const result = await client.query(
        `SELECT l.title, l.content, l.user_id, u.handle
         FROM lyrics l
         JOIN users u ON l.user_id = u.id
         WHERE l.id = $1`,
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      const snippet = (row.title || '') + ' ' + (row.content || '');
      return { snippet: snippet.substring(0, 200), authorId: row.user_id, authorHandle: row.handle };
    }
    if (contentType === 'user' || contentType === 'profile') {
      const result = await client.query(
        'SELECT id, handle FROM users WHERE id = $1',
        [contentId]
      );
      if (result.rowCount === 0) return null;
      const row = result.rows[0];
      return { snippet: `User profile: @${row.handle}`, authorId: row.id, authorHandle: row.handle };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function hideContent(client, contentType, contentId) {
  const table = TABLE_MAP[contentType];
  if (!table) return;
  await client.query(
    `UPDATE ${table} SET is_hidden = TRUE, hidden_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [contentId]
  );
}

async function ejectUser(client, userId) {
  const groupResult = await client.query(`SELECT id FROM \`groups\` WHERE name = 'Restricted'`);
  if (groupResult.rowCount === 0) return;
  const restrictedGroupId = groupResult.rows[0].id;
  await client.query(
    'INSERT IGNORE INTO user_groups (user_id, group_id) VALUES ($1, $2)',
    [userId, restrictedGroupId]
  );
  for (const [type, table] of Object.entries(TABLE_MAP)) {
    await client.query(
      `UPDATE ${table} SET is_hidden = TRUE, hidden_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_hidden = FALSE`,
      [userId]
    );
  }
}

async function sendFlagEmail(contentType, contentId, snippet, authorHandle, flaggerHandle, reason) {
  const subject = `Content Report - ${contentType}`;
  const htmlContent = `
    <h2>Content Report Submitted</h2>
    <table style="border-collapse: collapse; width: 100%;">
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Content Type</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contentType}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Content ID</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${contentId || 'N/A'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Content Author</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${authorHandle || 'Unknown'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Flagged By</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${flaggerHandle || 'Unknown'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Reason</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${reason || 'No reason provided'}</td></tr>
      <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Snippet</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${snippet || 'N/A'}</td></tr>
    </table>
    <p>Review this report in the <a href="https://www.prosaurus.com/admin/moderation">moderation panel</a>.</p>
  `;
  await sendMail(
    'ContentNotification@cherryblossomdevelopment.com',
    'noreply@cherryblossomdevelopment.com',
    subject,
    htmlContent
  );
}

// =====================================
// Authenticated user endpoints
// =====================================

// POST /api/moderation/flag
router.post('/flag', authenticate, async (req, res) => {
  const { content_type, content_id, reason } = req.body;

  if (!content_type || !VALID_CONTENT_TYPES.includes(content_type)) {
    return res.status(400).json({ message: 'Invalid content_type' });
  }
  if (content_type === 'other' && !reason) {
    return res.status(400).json({ message: 'Reason is required for content_type "other"' });
  }

  const client = await getClient();
  try {
    // Check if user is flag banned
    const userResult = await client.query(
      'SELECT is_flag_banned FROM users WHERE id = $1',
      [req.user.id]
    );
    if (userResult.rowCount > 0 && userResult.rows[0].is_flag_banned) {
      return res.status(403).json({ message: 'Your flagging privileges have been disabled' });
    }

    // Look up content author
    let authorId = null;
    let authorHandle = null;
    let snippet = null;
    const details = await getContentDetails(client, content_type, content_id);
    if (details) {
      authorId = details.authorId;
      authorHandle = details.authorHandle;
      snippet = details.snippet;
    }

    // Hide flaggable content immediately
    if (TABLE_MAP[content_type] && content_id) {
      await hideContent(client, content_type, content_id);
    }

    // Insert flag
    await client.query(
      `INSERT INTO content_flags (content_type, content_id, content_author_id, flagged_by_user_id, reason, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [content_type, content_id || null, authorId, req.user.id, reason || null]
    );

    // Notify admins
    await notifyAdmins(client);

    // Send email
    try {
      await sendFlagEmail(content_type, content_id, snippet, authorHandle, req.user.handle, reason);
    } catch (emailErr) {
      console.error('Failed to send flag email:', emailErr);
    }

    return res.status(200).json({ message: 'Content flagged successfully' });
  } catch (err) {
    console.error('Error flagging content:', err);
    return res.status(500).json({ message: 'Error flagging content' });
  } finally {
    client.release();
  }
});

// POST /api/moderation/block/:userId
router.post('/block/:userId', authenticate, async (req, res) => {
  const blockedUserId = parseInt(req.params.userId, 10);
  if (!blockedUserId || blockedUserId === req.user.id) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const client = await getClient();
  try {
    // Insert block (ignore duplicates)
    await client.query(
      'INSERT IGNORE INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)',
      [req.user.id, blockedUserId]
    );

    // Get blocked user handle
    const userResult = await client.query('SELECT handle FROM users WHERE id = $1', [blockedUserId]);
    const blockedHandle = userResult.rowCount > 0 ? userResult.rows[0].handle : null;

    // Create a content flag for this block
    await client.query(
      `INSERT INTO content_flags (content_type, content_id, content_author_id, flagged_by_user_id, reason, status)
       VALUES ('user', $1, $2, $3, 'User blocked', 'pending')`,
      [blockedUserId, blockedUserId, req.user.id]
    );

    // Notify admins
    await notifyAdmins(client);

    // Send email
    try {
      await sendFlagEmail('user', blockedUserId, `User profile: @${blockedHandle}`, blockedHandle, req.user.handle, 'User blocked');
    } catch (emailErr) {
      console.error('Failed to send block email:', emailErr);
    }

    return res.status(200).json({ blocked: true });
  } catch (err) {
    console.error('Error blocking user:', err);
    return res.status(500).json({ message: 'Error blocking user' });
  } finally {
    client.release();
  }
});

// DELETE /api/moderation/block/:userId
router.delete('/block/:userId', authenticate, async (req, res) => {
  const blockedUserId = parseInt(req.params.userId, 10);
  if (!blockedUserId) {
    return res.status(400).json({ message: 'Invalid user ID' });
  }

  const client = await getClient();
  try {
    await client.query(
      'DELETE FROM user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2',
      [req.user.id, blockedUserId]
    );
    return res.status(200).json({ unblocked: true });
  } catch (err) {
    console.error('Error unblocking user:', err);
    return res.status(500).json({ message: 'Error unblocking user' });
  } finally {
    client.release();
  }
});

// GET /api/moderation/blocks
router.get('/blocks', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT blocked_user_id FROM user_blocks WHERE blocker_user_id = $1',
      [req.user.id]
    );
    const blockedUserIds = result.rows.map(r => r.blocked_user_id);
    return res.status(200).json({ blockedUserIds });
  } catch (err) {
    console.error('Error fetching block list:', err);
    return res.status(500).json({ message: 'Error fetching block list' });
  } finally {
    client.release();
  }
});

// =====================================
// Admin-only endpoints
// =====================================

// GET /api/moderation/flags
router.get('/flags', authenticate, requireAdmin, async (req, res) => {
  const { status } = req.query;
  let statusFilter = 'pending';
  let whereClause = '';

  if (status === 'all') {
    whereClause = '';
  } else if (status === 'approved') {
    statusFilter = 'approved';
    whereClause = `WHERE cf.status = 'approved'`;
  } else if (status === 'restored') {
    statusFilter = 'restored';
    whereClause = `WHERE cf.status = 'restored'`;
  } else if (status === 'resolved') {
    whereClause = `WHERE cf.status IN ('approved', 'restored')`;
  } else {
    whereClause = `WHERE cf.status = 'pending'`;
  }

  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT
         cf.id,
         cf.content_type,
         cf.content_id,
         cf.content_author_id,
         cf.flagged_by_user_id,
         cf.reason,
         cf.status,
         cf.reviewed_by_user_id,
         cf.reviewed_at,
         cf.created_at,
         author.handle AS author_handle,
         flagger.handle AS flagger_handle,
         reviewer.handle AS reviewer_handle
       FROM content_flags cf
       LEFT JOIN users author ON cf.content_author_id = author.id
       LEFT JOIN users flagger ON cf.flagged_by_user_id = flagger.id
       LEFT JOIN users reviewer ON cf.reviewed_by_user_id = reviewer.id
       ${whereClause}
       ORDER BY cf.created_at DESC`
    );

    const flags = [];
    for (const flag of result.rows) {
      const details = await getContentDetails(client, flag.content_type, flag.content_id);
      flags.push({
        ...flag,
        snippet: details ? details.snippet : null
      });
    }

    return res.status(200).json({ flags });
  } catch (err) {
    console.error('Error fetching flags:', err);
    return res.status(500).json({ message: 'Error fetching flags' });
  } finally {
    client.release();
  }
});

// PUT /api/moderation/flags/:id/approve
router.put('/flags/:id/approve', authenticate, requireAdmin, async (req, res) => {
  const flagId = parseInt(req.params.id, 10);
  if (!flagId) return res.status(400).json({ message: 'Invalid flag ID' });

  const client = await getClient();
  try {
    // Get flag info
    const flagResult = await client.query(
      'SELECT * FROM content_flags WHERE id = $1',
      [flagId]
    );
    if (flagResult.rowCount === 0) return res.status(404).json({ message: 'Flag not found' });
    const flag = flagResult.rows[0];

    // Update flag status
    await client.query(
      `UPDATE content_flags SET status = 'approved', reviewed_by_user_id = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [req.user.id, flagId]
    );

    // Ensure content is hidden
    if (TABLE_MAP[flag.content_type] && flag.content_id) {
      await hideContent(client, flag.content_type, flag.content_id);
    }

    // Check if author should be auto-ejected
    if (flag.content_author_id) {
      const approvedCount = await client.query(
        `SELECT COUNT(*) AS cnt FROM content_flags WHERE content_author_id = $1 AND status = 'approved'`,
        [flag.content_author_id]
      );
      const count = parseInt(approvedCount.rows[0].cnt, 10);

      if (count >= 3) {
        // Check if already in Restricted group
        const restrictedCheck = await client.query(
          `SELECT 1 FROM user_groups ug
           JOIN \`groups\` g ON ug.group_id = g.id
           WHERE ug.user_id = $1 AND g.name = 'Restricted'`,
          [flag.content_author_id]
        );
        if (restrictedCheck.rowCount === 0) {
          await ejectUser(client, flag.content_author_id);
        }
      }
    }

    // Return updated flag
    const updatedResult = await client.query(
      `SELECT cf.*, author.handle AS author_handle, flagger.handle AS flagger_handle, reviewer.handle AS reviewer_handle
       FROM content_flags cf
       LEFT JOIN users author ON cf.content_author_id = author.id
       LEFT JOIN users flagger ON cf.flagged_by_user_id = flagger.id
       LEFT JOIN users reviewer ON cf.reviewed_by_user_id = reviewer.id
       WHERE cf.id = $1`,
      [flagId]
    );

    return res.status(200).json({ flag: updatedResult.rows[0] });
  } catch (err) {
    console.error('Error approving flag:', err);
    return res.status(500).json({ message: 'Error approving flag' });
  } finally {
    client.release();
  }
});

// PUT /api/moderation/flags/:id/restore
router.put('/flags/:id/restore', authenticate, requireAdmin, async (req, res) => {
  const flagId = parseInt(req.params.id, 10);
  if (!flagId) return res.status(400).json({ message: 'Invalid flag ID' });

  const client = await getClient();
  try {
    // Get flag info
    const flagResult = await client.query(
      'SELECT * FROM content_flags WHERE id = $1',
      [flagId]
    );
    if (flagResult.rowCount === 0) return res.status(404).json({ message: 'Flag not found' });
    const flag = flagResult.rows[0];

    // Update flag status
    await client.query(
      `UPDATE content_flags SET status = 'restored', reviewed_by_user_id = $1, reviewed_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [req.user.id, flagId]
    );

    // Restore content visibility
    if (TABLE_MAP[flag.content_type] && flag.content_id) {
      await client.query(
        `UPDATE ${TABLE_MAP[flag.content_type]} SET is_hidden = FALSE, hidden_at = NULL WHERE id = $1`,
        [flag.content_id]
      );
    }

    // Return updated flag
    const updatedResult = await client.query(
      `SELECT cf.*, author.handle AS author_handle, flagger.handle AS flagger_handle, reviewer.handle AS reviewer_handle
       FROM content_flags cf
       LEFT JOIN users author ON cf.content_author_id = author.id
       LEFT JOIN users flagger ON cf.flagged_by_user_id = flagger.id
       LEFT JOIN users reviewer ON cf.reviewed_by_user_id = reviewer.id
       WHERE cf.id = $1`,
      [flagId]
    );

    return res.status(200).json({ flag: updatedResult.rows[0] });
  } catch (err) {
    console.error('Error restoring flag:', err);
    return res.status(500).json({ message: 'Error restoring flag' });
  } finally {
    client.release();
  }
});

// POST /api/moderation/eject/:userId
router.post('/eject/:userId', authenticate, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ message: 'Invalid user ID' });

  const client = await getClient();
  try {
    await ejectUser(client, userId);
    return res.status(200).json({ ejected: true });
  } catch (err) {
    console.error('Error ejecting user:', err);
    return res.status(500).json({ message: 'Error ejecting user' });
  } finally {
    client.release();
  }
});

// POST /api/moderation/reinstate/:userId
router.post('/reinstate/:userId', authenticate, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ message: 'Invalid user ID' });

  const client = await getClient();
  try {
    const groupResult = await client.query(`SELECT id FROM \`groups\` WHERE name = 'Restricted'`);
    if (groupResult.rowCount === 0) return res.status(404).json({ message: 'Restricted group not found' });
    const restrictedGroupId = groupResult.rows[0].id;

    await client.query(
      'DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2',
      [userId, restrictedGroupId]
    );

    return res.status(200).json({ reinstated: true });
  } catch (err) {
    console.error('Error reinstating user:', err);
    return res.status(500).json({ message: 'Error reinstating user' });
  } finally {
    client.release();
  }
});

// GET /api/moderation/keywords
router.get('/keywords', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT id, keyword, is_active, created_at FROM content_filter_keywords ORDER BY created_at DESC'
    );
    return res.status(200).json({ keywords: result.rows });
  } catch (err) {
    console.error('Error fetching keywords:', err);
    return res.status(500).json({ message: 'Error fetching keywords' });
  } finally {
    client.release();
  }
});

// POST /api/moderation/keywords
router.post('/keywords', authenticate, requireAdmin, async (req, res) => {
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ message: 'Keyword is required' });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      'INSERT INTO content_filter_keywords (keyword) VALUES ($1)',
      [keyword.trim().toLowerCase()]
    );
    invalidateCache();
    return res.status(201).json({ keyword: { id: result.insertId, keyword: keyword.trim().toLowerCase(), is_active: true } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || (err.message && err.message.includes('Duplicate'))) {
      return res.status(409).json({ message: 'Keyword already exists' });
    }
    console.error('Error adding keyword:', err);
    return res.status(500).json({ message: 'Error adding keyword' });
  } finally {
    client.release();
  }
});

// DELETE /api/moderation/keywords/:id
router.delete('/keywords/:id', authenticate, requireAdmin, async (req, res) => {
  const keywordId = parseInt(req.params.id, 10);
  if (!keywordId) return res.status(400).json({ message: 'Invalid keyword ID' });

  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM content_filter_keywords WHERE id = $1',
      [keywordId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Keyword not found' });
    invalidateCache();
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Error deleting keyword:', err);
    return res.status(500).json({ message: 'Error deleting keyword' });
  } finally {
    client.release();
  }
});

// GET /api/moderation/flaggers
router.get('/flaggers', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT
         u.id,
         u.handle,
         u.is_flag_banned,
         COUNT(cf.id) AS flag_count
       FROM users u
       JOIN content_flags cf ON cf.flagged_by_user_id = u.id
       GROUP BY u.id, u.handle, u.is_flag_banned
       ORDER BY flag_count DESC`
    );
    return res.status(200).json({ flaggers: result.rows });
  } catch (err) {
    console.error('Error fetching flaggers:', err);
    return res.status(500).json({ message: 'Error fetching flaggers' });
  } finally {
    client.release();
  }
});

// PUT /api/moderation/users/:userId/flag-ban
router.put('/users/:userId/flag-ban', authenticate, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!userId) return res.status(400).json({ message: 'Invalid user ID' });

  const client = await getClient();
  try {
    const userResult = await client.query(
      'SELECT is_flag_banned FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rowCount === 0) return res.status(404).json({ message: 'User not found' });

    const currentValue = userResult.rows[0].is_flag_banned;
    const newValue = !currentValue;

    await client.query(
      'UPDATE users SET is_flag_banned = $1 WHERE id = $2',
      [newValue, userId]
    );

    return res.status(200).json({ is_flag_banned: newValue });
  } catch (err) {
    console.error('Error toggling flag ban:', err);
    return res.status(500).json({ message: 'Error toggling flag ban' });
  } finally {
    client.release();
  }
});

module.exports = router;
