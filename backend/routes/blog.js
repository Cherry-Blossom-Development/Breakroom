const express = require('express');
const router = express.Router();
const { checkAndFilterContent } = require('../utilities/contentFilter');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { uploadToS3 } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');
const { recalcBlogDiscoverActivity } = require('../utilities/discoverActivity');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Configure multer for memory storage (buffer for S3 upload)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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

// =====================
// PUBLIC BLOG ENDPOINTS (no auth required)
// =====================

// Named HTML entities the rich text editor's saved content actually uses
// (&nbsp; from pasted/formatted text is the common offender) -- decoded so
// Discover excerpts read as plain text instead of leaking markup.
const HTML_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Plain-text teaser from a post's (HTML) content -- strips tags, decodes
// entities, collapses whitespace, and clips to maxLen so the Discover
// directory can ship a short excerpt instead of the full post body.
function makeExcerpt(html, maxLen = 160) {
  if (!html) return '';
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + '...';
}

// Directory of blogs the author has opted in to list publicly. Only blogs
// with at least one published (and unmoderated) post are included, so the
// directory doesn't surface empty/placeholder blogs -- same pattern as
// GET /api/gallery/public and GET /api/storefront/public. Also carries the
// title + a short excerpt of the most recent qualifying post, so Discover
// has something to actually show in a blog's preview slot (blogs have no
// cover image the way galleries/showcases do).
// Paginated (limit/offset) and searchable (q) -- see gallery.js's /public
// for the same pattern applied to Discover's Galleries section.
router.get('/public', async (req, res) => {
  const client = await getClient();
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 48);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const q = (req.query.q || '').trim();

  try {
    const searchClause = q
      ? `AND (ub.blog_name LIKE $1 OR u.handle LIKE $1 OR u.first_name LIKE $1 OR u.last_name LIKE $1)`
      : '';
    const searchParams = q ? [`%${q}%`] : [];
    const nextIndex = searchParams.length + 1;

    const countResult = await client.query(
      `SELECT COUNT(*) AS total
       FROM user_blog ub
       JOIN users u ON u.id = ub.user_id
       WHERE ub.is_public = TRUE
         AND EXISTS (SELECT 1 FROM blog_posts bp
                     WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE)
         ${searchClause}`,
      searchParams
    );

    const result = await client.query(
      `SELECT ub.blog_url, ub.blog_name, ub.updated_at,
              u.handle, u.first_name, u.last_name, u.photo_path,
              (SELECT COUNT(*) FROM blog_posts bp
                 WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE) AS post_count,
              (SELECT bp.title FROM blog_posts bp
                 WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE
                 ORDER BY bp.updated_at DESC LIMIT 1) AS latest_post_title,
              (SELECT bp.content FROM blog_posts bp
                 WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE
                 ORDER BY bp.updated_at DESC LIMIT 1) AS latest_post_content
       FROM user_blog ub
       JOIN users u ON u.id = ub.user_id
       WHERE ub.is_public = TRUE
         AND EXISTS (SELECT 1 FROM blog_posts bp
                     WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE)
         ${searchClause}
       ORDER BY ub.discover_activity_at DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...searchParams, limit, offset]
    );

    res.json({
      blogs: result.rows.map(row => ({
        blog_url: row.blog_url,
        blog_name: row.blog_name,
        post_count: row.post_count,
        latest_post_title: row.latest_post_title,
        latest_post_excerpt: makeExcerpt(row.latest_post_content),
        artist: {
          handle: row.handle,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_path: row.photo_path
        }
      })),
      total: countResult.rows[0].total,
      limit,
      offset
    });
  } catch (err) {
    console.error('Error fetching public blog directory:', err);
    res.status(500).json({ message: 'Failed to fetch blogs' });
  } finally {
    client.release();
  }
});

// Get public blog by URL - returns blog info and all published posts
router.get('/public/:blogUrl', async (req, res) => {
  const { blogUrl } = req.params;
  const client = await getClient();

  try {
    // Get blog info and user details
    const blogResult = await client.query(
      `SELECT ub.id, ub.blog_url, ub.blog_name, ub.user_id,
              u.handle, u.first_name, u.last_name, u.photo_path, u.bio
       FROM user_blog ub
       JOIN users u ON ub.user_id = u.id
       WHERE ub.blog_url = $1`,
      [blogUrl]
    );

    if (blogResult.rowCount === 0) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    const blog = blogResult.rows[0];

    // Get all published posts for this user
    const postsResult = await client.query(
      `SELECT id, title, content, created_at, updated_at
       FROM blog_posts
       WHERE user_id = $1 AND is_published = TRUE AND is_hidden = FALSE
       ORDER BY updated_at DESC`,
      [blog.user_id]
    );

    res.json({
      blog: {
        id: blog.id,
        blog_url: blog.blog_url,
        blog_name: blog.blog_name,
        author: {
          handle: blog.handle,
          first_name: blog.first_name,
          last_name: blog.last_name,
          photo_path: blog.photo_path,
          bio: blog.bio
        }
      },
      posts: postsResult.rows
    });
  } catch (err) {
    console.error('Error fetching public blog:', err);
    res.status(500).json({ message: 'Failed to fetch blog' });
  } finally {
    client.release();
  }
});

// Get a single post from a public blog
router.get('/public/:blogUrl/:postId', async (req, res) => {
  const { blogUrl, postId } = req.params;
  const client = await getClient();

  try {
    // Verify blog exists and get post
    const result = await client.query(
      `SELECT bp.id, bp.title, bp.content, bp.created_at, bp.updated_at,
              ub.blog_url, ub.blog_name,
              u.handle, u.first_name, u.last_name, u.photo_path, u.bio
       FROM blog_posts bp
       JOIN users u ON bp.user_id = u.id
       JOIN user_blog ub ON ub.user_id = u.id
       WHERE ub.blog_url = $1 AND bp.id = $2 AND bp.is_published = TRUE AND bp.is_hidden = FALSE`,
      [blogUrl, postId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const row = result.rows[0];
    res.json({
      post: {
        id: row.id,
        title: row.title,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      blog: {
        blog_url: row.blog_url,
        blog_name: row.blog_name,
        author: {
          handle: row.handle,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_path: row.photo_path,
          bio: row.bio
        }
      }
    });
  } catch (err) {
    console.error('Error fetching public blog post:', err);
    res.status(500).json({ message: 'Failed to fetch post' });
  } finally {
    client.release();
  }
});

// =====================
// BLOG SETTINGS ENDPOINTS (auth required)
// =====================

// Get current user's blog settings
router.get('/settings', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, blog_url, blog_name, is_public, created_at
       FROM user_blog
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.json({ settings: null });
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error('Error fetching blog settings:', err);
    res.status(500).json({ message: 'Failed to fetch settings' });
  } finally {
    client.release();
  }
});

// Create blog settings
router.post('/settings', authenticate, async (req, res) => {
  const { blog_url, blog_name, is_public } = req.body;
  const client = await getClient();

  try {
    // Check if user already has settings
    const existing = await client.query(
      'SELECT id FROM user_blog WHERE user_id = $1',
      [req.user.id]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({ message: 'Blog settings already exist. Use PUT to update.' });
    }

    // Use handle as default blog_url if not provided
    const finalBlogUrl = blog_url || req.user.handle;
    const finalBlogName = blog_name || `${req.user.handle}'s Blog`;
    // Defaults to discoverable unless the form explicitly says otherwise --
    // matches the column's own DEFAULT TRUE (migration 076).
    const finalIsPublic = is_public === undefined ? true : !!is_public;

    // Check uniqueness
    const urlCheck = await client.query(
      'SELECT id FROM user_blog WHERE blog_url = $1',
      [finalBlogUrl]
    );

    if (urlCheck.rowCount > 0) {
      return res.status(400).json({ message: 'This blog URL is already taken' });
    }

    await client.query(
      `INSERT INTO user_blog (user_id, blog_url, blog_name, is_public)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, finalBlogUrl, finalBlogName, finalIsPublic]
    );
    await recalcBlogDiscoverActivity(client, req.user.id);

    const result = await client.query(
      'SELECT id, blog_url, blog_name, is_public, created_at FROM user_blog WHERE user_id = $1',
      [req.user.id]
    );

    res.status(201).json({ settings: result.rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'This blog URL is already taken' });
    }
    console.error('Error creating blog settings:', err);
    res.status(500).json({ message: 'Failed to create settings' });
  } finally {
    client.release();
  }
});

// Update blog settings
router.put('/settings', authenticate, async (req, res) => {
  const { blog_url, blog_name, is_public } = req.body;
  const client = await getClient();

  try {
    if (!blog_url || blog_url.trim().length === 0) {
      return res.status(400).json({ message: 'Blog URL is required' });
    }

    // Check if URL is taken by another user
    const urlCheck = await client.query(
      'SELECT id, user_id FROM user_blog WHERE blog_url = $1',
      [blog_url.trim()]
    );

    if (urlCheck.rowCount > 0 && urlCheck.rows[0].user_id !== req.user.id) {
      return res.status(400).json({ message: 'This blog URL is already taken' });
    }

    const result = await client.query(
      `UPDATE user_blog SET blog_url = $1, blog_name = $2, is_public = $3 WHERE user_id = $4`,
      [blog_url.trim(), blog_name || `${req.user.handle}'s Blog`, !!is_public, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Blog settings not found' });
    }
    await recalcBlogDiscoverActivity(client, req.user.id);

    const updated = await client.query(
      'SELECT id, blog_url, blog_name, is_public, created_at FROM user_blog WHERE user_id = $1',
      [req.user.id]
    );

    res.json({ settings: updated.rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'This blog URL is already taken' });
    }
    console.error('Error updating blog settings:', err);
    res.status(500).json({ message: 'Failed to update settings' });
  } finally {
    client.release();
  }
});

// Check if a blog URL is available
router.get('/check-url/:blogUrl', authenticate, async (req, res) => {
  const { blogUrl } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'SELECT id, user_id FROM user_blog WHERE blog_url = $1',
      [blogUrl]
    );

    if (result.rowCount === 0) {
      return res.json({ available: true });
    }

    // If it's the current user's URL, it's "available" for them
    if (result.rows[0].user_id === req.user.id) {
      return res.json({ available: true, isOwn: true });
    }

    res.json({ available: false });
  } catch (err) {
    console.error('Error checking blog URL:', err);
    res.status(500).json({ message: 'Failed to check URL' });
  } finally {
    client.release();
  }
});

// =====================
// AUTHENTICATED BLOG ENDPOINTS
// =====================

// Get feed of posts (own + friends' published posts)
router.get('/feed', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT bp.id, bp.title, bp.content, bp.is_published, bp.created_at, bp.updated_at,
              u.id as author_id, u.handle as author_handle, u.first_name as author_first_name,
              u.last_name as author_last_name, u.photo_path as author_photo
       FROM blog_posts bp
       JOIN users u ON bp.user_id = u.id
       WHERE bp.is_published = TRUE AND bp.is_hidden = FALSE
         AND (bp.user_id = $1
              OR bp.user_id IN (
                SELECT CASE
                  WHEN user_id = $1 THEN friend_id
                  ELSE user_id
                END
                FROM friends
                WHERE (user_id = $1 OR friend_id = $1)
                  AND status = 'accepted'
              ))
       ORDER BY bp.updated_at DESC
       LIMIT 20`,
      [req.user.id, req.user.id, req.user.id, req.user.id]
    );

    res.json({ posts: result.rows });
  } catch (err) {
    console.error('Error fetching blog feed:', err);
    res.status(500).json({ message: 'Failed to fetch feed' });
  } finally {
    client.release();
  }
});

// Get a single published post (public view)
router.get('/view/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT bp.id, bp.title, bp.content, bp.is_published, bp.created_at, bp.updated_at,
              u.id as author_id, u.handle as author_handle, u.first_name as author_first_name,
              u.last_name as author_last_name, u.photo_path as author_photo, u.bio as author_bio
       FROM blog_posts bp
       JOIN users u ON bp.user_id = u.id
       WHERE bp.id = $1 AND bp.is_published = TRUE AND bp.is_hidden = FALSE`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('Error fetching blog post:', err);
    res.status(500).json({ message: 'Failed to fetch post' });
  } finally {
    client.release();
  }
});

// Get all posts for current user
router.get('/posts', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, title, content, is_published, created_at, updated_at
       FROM blog_posts
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    res.json({ posts: result.rows });
  } catch (err) {
    console.error('Error fetching blog posts:', err);
    res.status(500).json({ message: 'Failed to fetch posts' });
  } finally {
    client.release();
  }
});

// Get a single post by ID (must belong to current user)
router.get('/posts/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, title, content, is_published, created_at, updated_at
       FROM blog_posts
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('Error fetching blog post:', err);
    res.status(500).json({ message: 'Failed to fetch post' });
  } finally {
    client.release();
  }
});

// Create a new post
router.post('/posts', authenticate, async (req, res) => {
  const { title, content, isPublished } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Auto-create blog settings if they don't exist
    const existingBlog = await client.query(
      'SELECT id FROM user_blog WHERE user_id = $1',
      [req.user.id]
    );

    if (existingBlog.rowCount === 0) {
      // Create default blog settings with handle as URL
      try {
        await client.query(
          `INSERT INTO user_blog (user_id, blog_url, blog_name)
           VALUES ($1, $2, $3)`,
          [req.user.id, req.user.handle, `${req.user.handle}'s Blog`]
        );
      } catch (blogErr) {
        // If handle is taken, append user ID
        if (blogErr.code === 'ER_DUP_ENTRY') {
          await client.query(
            `INSERT INTO user_blog (user_id, blog_url, blog_name)
             VALUES ($1, $2, $3)`,
            [req.user.id, `${req.user.handle}-${req.user.id}`, `${req.user.handle}'s Blog`]
          );
        } else {
          throw blogErr;
        }
      }
    }

    await client.query(
      `INSERT INTO blog_posts (user_id, title, content, is_published)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, title.trim(), content || '', isPublished || false]
    );
    await recalcBlogDiscoverActivity(client, req.user.id);

    // Get the inserted post
    const result = await client.query(
      `SELECT id, title, content, is_published, created_at, updated_at
       FROM blog_posts
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    const post = result.rows[0];
    // Run keyword filter (async, non-blocking to response)
    checkAndFilterContent('post', post.id, [title, content || ''], req.user.id).catch(() => {});

    res.status(201).json({ post });
  } catch (err) {
    console.error('Error creating blog post:', err);
    res.status(500).json({ message: 'Failed to create post' });
  } finally {
    client.release();
  }
});

// Update a post
router.put('/posts/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, content, isPublished } = req.body;
  const client = await getClient();

  try {
    // Verify ownership
    const check = await client.query(
      'SELECT id FROM blog_posts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    await client.query(
      `UPDATE blog_posts
       SET title = $1, content = $2, is_published = $3
       WHERE id = $4 AND user_id = $5`,
      [title.trim(), content || '', isPublished || false, id, req.user.id]
    );
    await recalcBlogDiscoverActivity(client, req.user.id);

    // Get updated post
    const result = await client.query(
      `SELECT id, title, content, is_published, created_at, updated_at
       FROM blog_posts
       WHERE id = $1`,
      [id]
    );

    res.json({ post: result.rows[0] });
  } catch (err) {
    console.error('Error updating blog post:', err);
    res.status(500).json({ message: 'Failed to update post' });
  } finally {
    client.release();
  }
});

// Delete a post
router.delete('/posts/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'DELETE FROM blog_posts WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }
    await recalcBlogDiscoverActivity(client, req.user.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error('Error deleting blog post:', err);
    res.status(500).json({ message: 'Failed to delete post' });
  } finally {
    client.release();
  }
});

// Upload image for blog content
router.post('/upload-image', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    // Generate S3 key
    const ext = path.extname(req.file.originalname).toLowerCase();
    const s3Key = `blog/${req.user.id}/img_${Date.now()}${ext}`;

    // Upload to S3
    const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);

    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload image: ' + uploadResult.error });
    }

    // Return the URL path that can be used in the editor
    res.json({
      url: `/api/uploads/${s3Key}`
    });
  } catch (err) {
    console.error('Error uploading blog image:', err);
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

module.exports = router;
