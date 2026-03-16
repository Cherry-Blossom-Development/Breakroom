const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { getIO } = require('../utilities/socket');
const { checkAndFilterContent } = require('../utilities/contentFilter');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Auth middleware (optional - returns user if authenticated, null otherwise)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies.jwtToken;
    if (!token) {
      req.user = null;
      return next();
    }

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query(
      'SELECT id, handle FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (result.rowCount === 0) {
      req.user = null;
      return next();
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    req.user = null;
    next();
  }
};

// Auth middleware (required)
const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.jwtToken;
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

// Emit comment event to post room
const emitToPost = (postId, event, data) => {
  const io = getIO();
  if (io) {
    io.to(`post_${postId}`).emit(event, data);
  }
};

// Get all comments for a post (public)
router.get('/:postId', optionalAuth, async (req, res) => {
  const { postId } = req.params;
  const client = await getClient();

  try {
    // Verify post exists and is published (or user owns it)
    const postCheck = await client.query(
      `SELECT id, user_id, is_published FROM blog_posts WHERE id = $1`,
      [postId]
    );

    if (postCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = postCheck.rows[0];
    if (!post.is_published && (!req.user || req.user.id !== post.user_id)) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Get all non-deleted comments with author info
    const result = await client.query(
      `SELECT
        bc.id, bc.blog_post_id, bc.user_id, bc.parent_id,
        bc.content, bc.created_at, bc.updated_at,
        u.handle as author_handle, u.first_name as author_first_name,
        u.last_name as author_last_name, u.photo_path as author_photo
       FROM blog_comments bc
       JOIN users u ON bc.user_id = u.id
       WHERE bc.blog_post_id = $1 AND bc.is_deleted = FALSE AND bc.is_hidden = FALSE
       ORDER BY bc.created_at ASC`,
      [postId]
    );

    // Organize into threaded structure
    const commentsMap = new Map();
    const topLevelComments = [];

    // First pass: create all comment objects
    result.rows.forEach(row => {
      commentsMap.set(row.id, {
        id: row.id,
        postId: row.blog_post_id,
        userId: row.user_id,
        parentId: row.parent_id,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        author: {
          handle: row.author_handle,
          firstName: row.author_first_name,
          lastName: row.author_last_name,
          photo: row.author_photo
        },
        replies: []
      });
    });

    // Second pass: build tree structure
    commentsMap.forEach(comment => {
      if (comment.parentId) {
        const parent = commentsMap.get(comment.parentId);
        if (parent) {
          parent.replies.push(comment);
        } else {
          // Parent was deleted, treat as top-level
          topLevelComments.push(comment);
        }
      } else {
        topLevelComments.push(comment);
      }
    });

    res.json({ comments: topLevelComments });
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  } finally {
    client.release();
  }
});

// Create a new comment (authenticated)
router.post('/:postId', authenticate, async (req, res) => {
  const { postId } = req.params;
  const { content, parentId } = req.body;
  const client = await getClient();

  try {
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Comment content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ message: 'Comment cannot exceed 2000 characters' });
    }

    // Verify post exists and is published (or user owns it)
    const postCheck = await client.query(
      `SELECT id, user_id, is_published FROM blog_posts WHERE id = $1`,
      [postId]
    );

    if (postCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const post = postCheck.rows[0];
    if (!post.is_published && req.user.id !== post.user_id) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // If parentId provided, verify parent comment exists
    if (parentId) {
      const parentCheck = await client.query(
        `SELECT id FROM blog_comments WHERE id = $1 AND blog_post_id = $2 AND is_deleted = FALSE`,
        [parentId, postId]
      );

      if (parentCheck.rowCount === 0) {
        return res.status(400).json({ message: 'Parent comment not found' });
      }
    }

    // Insert comment
    await client.query(
      `INSERT INTO blog_comments (blog_post_id, user_id, parent_id, content)
       VALUES ($1, $2, $3, $4)`,
      [postId, req.user.id, parentId || null, content.trim()]
    );

    // Get the inserted comment with author info
    const result = await client.query(
      `SELECT
        bc.id, bc.blog_post_id, bc.user_id, bc.parent_id,
        bc.content, bc.created_at, bc.updated_at,
        u.handle as author_handle, u.first_name as author_first_name,
        u.last_name as author_last_name, u.photo_path as author_photo
       FROM blog_comments bc
       JOIN users u ON bc.user_id = u.id
       WHERE bc.user_id = $1 AND bc.blog_post_id = $2
       ORDER BY bc.id DESC LIMIT 1`,
      [req.user.id, postId]
    );

    const row = result.rows[0];
    const comment = {
      id: row.id,
      postId: row.blog_post_id,
      userId: row.user_id,
      parentId: row.parent_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: {
        handle: row.author_handle,
        firstName: row.author_first_name,
        lastName: row.author_last_name,
        photo: row.author_photo
      },
      replies: []
    };

    // Run keyword filter (async, non-blocking to response)
    checkAndFilterContent('comment', comment.id, [content], req.user.id).catch(() => {});

    // Emit real-time event
    emitToPost(postId, 'new_comment', { comment });

    res.status(201).json({ comment });
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ message: 'Failed to create comment' });
  } finally {
    client.release();
  }
});

// Update a comment (owner only)
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const client = await getClient();

  try {
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Comment content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ message: 'Comment cannot exceed 2000 characters' });
    }

    // Verify ownership
    const check = await client.query(
      `SELECT id, blog_post_id, user_id FROM blog_comments WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own comments' });
    }

    const postId = check.rows[0].blog_post_id;

    // Update comment
    await client.query(
      `UPDATE blog_comments SET content = $1 WHERE id = $2`,
      [content.trim(), id]
    );

    // Get updated comment with author info
    const result = await client.query(
      `SELECT
        bc.id, bc.blog_post_id, bc.user_id, bc.parent_id,
        bc.content, bc.created_at, bc.updated_at,
        u.handle as author_handle, u.first_name as author_first_name,
        u.last_name as author_last_name, u.photo_path as author_photo
       FROM blog_comments bc
       JOIN users u ON bc.user_id = u.id
       WHERE bc.id = $1`,
      [id]
    );

    const row = result.rows[0];
    const comment = {
      id: row.id,
      postId: row.blog_post_id,
      userId: row.user_id,
      parentId: row.parent_id,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      author: {
        handle: row.author_handle,
        firstName: row.author_first_name,
        lastName: row.author_last_name,
        photo: row.author_photo
      }
    };

    // Emit real-time event
    emitToPost(postId, 'comment_updated', { comment });

    res.json({ comment });
  } catch (err) {
    console.error('Error updating comment:', err);
    res.status(500).json({ message: 'Failed to update comment' });
  } finally {
    client.release();
  }
});

// Delete a comment (soft delete, owner only)
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Verify ownership
    const check = await client.query(
      `SELECT id, blog_post_id, user_id FROM blog_comments WHERE id = $1 AND is_deleted = FALSE`,
      [id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own comments' });
    }

    const postId = check.rows[0].blog_post_id;

    // Soft delete
    await client.query(
      `UPDATE blog_comments SET is_deleted = TRUE WHERE id = $1`,
      [id]
    );

    // Emit real-time event
    emitToPost(postId, 'comment_deleted', { commentId: parseInt(id), postId });

    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('Error deleting comment:', err);
    res.status(500).json({ message: 'Failed to delete comment' });
  } finally {
    client.release();
  }
});

module.exports = router;
