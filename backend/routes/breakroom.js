const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { XMLParser } = require('fast-xml-parser');

require('dotenv').config();

// News RSS feed URL (NPR Top Stories)
const NEWS_RSS_URL = 'https://feeds.npr.org/1001/rss.xml';
const NEWS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let newsCache = { data: null, timestamp: 0 };

const SECRET_KEY = process.env.SECRET_KEY;

// Middleware to verify JWT and get user info
const authenticateToken = async (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, SECRET_KEY);

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

// Get current user's layout blocks
router.get('/layout', authenticateToken, async (req, res) => {
  const client = await getClient();
  try {
    const blocks = await client.query(
      `SELECT b.id, b.block_type, b.content_id, b.x, b.y, b.w, b.h, b.title, b.settings,
              cr.name as content_name
       FROM breakroom_blocks b
       LEFT JOIN chat_rooms cr ON b.block_type = 'chat' AND b.content_id = cr.id
       WHERE b.user_id = $1
       ORDER BY b.y, b.x`,
      [req.user.id]
    );

    // Fetch per-breakpoint positions
    const blockIds = blocks.rows.map(b => b.id);
    let positions = {};
    if (blockIds.length > 0) {
      const placeholders = blockIds.map((_, i) => `$${i + 1}`).join(', ');
      const posRows = await client.query(
        `SELECT block_id, col_count, x, y, w, h FROM breakroom_block_positions WHERE block_id IN (${placeholders})`,
        blockIds
      );
      for (const row of posRows.rows) {
        if (!positions[row.block_id]) positions[row.block_id] = {};
        positions[row.block_id][row.col_count] = { x: row.x, y: row.y, w: row.w, h: row.h };
      }
    }

    res.status(200).json({ blocks: blocks.rows, positions });
  } catch (err) {
    console.error('Error fetching layout:', err);
    res.status(500).json({ message: 'Failed to fetch layout' });
  } finally {
    client.release();
  }
});

// Add a new block
router.post('/blocks', authenticateToken, async (req, res) => {
  const { block_type, content_id, x, y, w, h, title, settings } = req.body;

  if (!block_type) {
    return res.status(400).json({ message: 'Block type is required' });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      `INSERT INTO breakroom_blocks (user_id, block_type, content_id, x, y, w, h, title, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id,
        block_type,
        content_id || null,
        x || 0,
        y || 0,
        w || 1,
        h || 1,
        title || null,
        settings ? JSON.stringify(settings) : null
      ]
    );

    // Fetch the created block with content info
    const newBlock = await client.query(
      `SELECT b.id, b.block_type, b.content_id, b.x, b.y, b.w, b.h, b.title, b.settings,
              cr.name as content_name
       FROM breakroom_blocks b
       LEFT JOIN chat_rooms cr ON b.block_type = 'chat' AND b.content_id = cr.id
       WHERE b.id = $1`,
      [result.insertId]
    );

    res.status(201).json({ block: newBlock.rows[0] });
  } catch (err) {
    console.error('Error creating block:', err);
    res.status(500).json({ message: 'Failed to create block' });
  } finally {
    client.release();
  }
});

// Update a single block
router.put('/blocks/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { x, y, w, h, title, settings, content_id } = req.body;

  const client = await getClient();
  try {
    // Verify block belongs to user
    const block = await client.query(
      'SELECT id FROM breakroom_blocks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (block.rowCount === 0) {
      return res.status(404).json({ message: 'Block not found' });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (x !== undefined) { updates.push(`x = $${paramIndex++}`); values.push(x); }
    if (y !== undefined) { updates.push(`y = $${paramIndex++}`); values.push(y); }
    if (w !== undefined) { updates.push(`w = $${paramIndex++}`); values.push(w); }
    if (h !== undefined) { updates.push(`h = $${paramIndex++}`); values.push(h); }
    if (title !== undefined) { updates.push(`title = $${paramIndex++}`); values.push(title); }
    if (settings !== undefined) { updates.push(`settings = $${paramIndex++}`); values.push(JSON.stringify(settings)); }
    if (content_id !== undefined) { updates.push(`content_id = $${paramIndex++}`); values.push(content_id); }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(id);
    await client.query(
      `UPDATE breakroom_blocks SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    // Fetch updated block
    const updated = await client.query(
      `SELECT b.id, b.block_type, b.content_id, b.x, b.y, b.w, b.h, b.title, b.settings,
              cr.name as content_name
       FROM breakroom_blocks b
       LEFT JOIN chat_rooms cr ON b.block_type = 'chat' AND b.content_id = cr.id
       WHERE b.id = $1`,
      [id]
    );

    res.status(200).json({ block: updated.rows[0] });
  } catch (err) {
    console.error('Error updating block:', err);
    res.status(500).json({ message: 'Failed to update block' });
  } finally {
    client.release();
  }
});

// Batch update layout (for drag-drop save)
router.put('/layout', authenticateToken, async (req, res) => {
  const { blocks } = req.body;

  if (!Array.isArray(blocks)) {
    return res.status(400).json({ message: 'Blocks array is required' });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();

    for (const block of blocks) {
      if (!block.id) continue;

      await client.query(
        `UPDATE breakroom_blocks SET x = $1, y = $2, w = $3, h = $4
         WHERE id = $5 AND user_id = $6`,
        [block.x, block.y, block.w, block.h, block.id, req.user.id]
      );
    }

    await client.commit();
    res.status(200).json({ message: 'Layout saved' });
  } catch (err) {
    await client.rollback();
    console.error('Error saving layout:', err);
    res.status(500).json({ message: 'Failed to save layout' });
  } finally {
    client.release();
  }
});

// Save layout positions for a specific column count
router.put('/layout/:colCount', authenticateToken, async (req, res) => {
  const colCount = parseInt(req.params.colCount);
  if (![1, 2, 3, 4, 5].includes(colCount)) {
    return res.status(400).json({ message: 'Invalid column count (must be 1-5)' });
  }

  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ message: 'Items array is required' });
  }

  const client = await getClient();
  try {
    await client.beginTransaction();

    // Get user's block IDs for ownership check
    const userBlocks = await client.query(
      'SELECT id FROM breakroom_blocks WHERE user_id = $1',
      [req.user.id]
    );
    const ownedIds = new Set(userBlocks.rows.map(b => b.id));

    for (const item of items) {
      if (!item.id || !ownedIds.has(item.id)) continue;

      await client.query(
        `INSERT INTO breakroom_block_positions (block_id, col_count, x, y, w, h)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON DUPLICATE KEY UPDATE x = $7, y = $8, w = $9, h = $10`,
        [item.id, colCount, item.x, item.y, item.w, item.h, item.x, item.y, item.w, item.h]
      );
    }

    await client.commit();
    res.status(200).json({ message: 'Layout saved' });
  } catch (err) {
    await client.rollback();
    console.error('Error saving responsive layout:', err);
    res.status(500).json({ message: 'Failed to save layout' });
  } finally {
    client.release();
  }
});

// Get breakroom updates (public endpoint)
router.get('/updates', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const offset = parseInt(req.query.offset) || 0;

  const client = await getClient();
  try {
    const updates = await client.query(
      `SELECT id, summary, commit_hash, created_at
       FROM breakroom_updates
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await client.query('SELECT COUNT(*) as count FROM breakroom_updates');

    res.status(200).json({
      updates: updates.rows,
      total: total.rows[0].count,
      limit,
      offset
    });
  } catch (err) {
    console.error('Error fetching updates:', err);
    res.status(500).json({ message: 'Failed to fetch updates' });
  } finally {
    client.release();
  }
});

// Get news feed (public endpoint, cached)
router.get('/news', async (req, res) => {
  const now = Date.now();

  // Return cached data if still valid
  if (newsCache.data && (now - newsCache.timestamp) < NEWS_CACHE_DURATION) {
    return res.status(200).json(newsCache.data);
  }

  try {
    const response = await fetch(NEWS_RSS_URL);
    if (!response.ok) {
      throw new Error('Failed to fetch news feed');
    }

    const xmlText = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    const result = parser.parse(xmlText);

    // Extract items from RSS feed
    const channel = result.rss?.channel;
    if (!channel) {
      throw new Error('Invalid RSS format');
    }

    const items = (channel.item || []).slice(0, 20).map(item => ({
      title: item.title || '',
      link: item.link || '',
      description: item.description?.replace(/<[^>]*>/g, '').substring(0, 200) || '',
      pubDate: item.pubDate || '',
      source: 'NPR'
    }));

    const data = {
      title: channel.title || 'News',
      items,
      lastUpdated: new Date().toISOString()
    };

    // Update cache
    newsCache = { data, timestamp: now };

    res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching news:', err);

    // Return stale cache if available
    if (newsCache.data) {
      return res.status(200).json(newsCache.data);
    }

    res.status(500).json({ message: 'Failed to fetch news' });
  }
});

// Delete a block
router.delete('/blocks/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM breakroom_blocks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Block not found' });
    }

    res.status(200).json({ message: 'Block deleted' });
  } catch (err) {
    console.error('Error deleting block:', err);
    res.status(500).json({ message: 'Failed to delete block' });
  } finally {
    client.release();
  }
});

module.exports = router;
