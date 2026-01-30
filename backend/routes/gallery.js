const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3 } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Configure multer for memory storage (buffer for S3 upload)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for artwork
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
// PUBLIC GALLERY ENDPOINTS (no auth required)
// =====================

// Get public gallery by URL - returns gallery info and all published artworks
router.get('/public/:galleryUrl', async (req, res) => {
  const { galleryUrl } = req.params;
  const client = await getClient();

  try {
    // Get gallery info and user details
    const galleryResult = await client.query(
      `SELECT ug.id, ug.gallery_url, ug.gallery_name, ug.user_id,
              u.handle, u.first_name, u.last_name, u.photo_path, u.bio
       FROM user_gallery ug
       JOIN users u ON ug.user_id = u.id
       WHERE ug.gallery_url = $1`,
      [galleryUrl]
    );

    if (galleryResult.rowCount === 0) {
      return res.status(404).json({ message: 'Gallery not found' });
    }

    const gallery = galleryResult.rows[0];

    // Get all published artworks for this user
    const artworksResult = await client.query(
      `SELECT id, title, description, image_path, created_at, updated_at
       FROM gallery_artworks
       WHERE user_id = $1 AND is_published = TRUE
       ORDER BY created_at DESC`,
      [gallery.user_id]
    );

    res.json({
      gallery: {
        id: gallery.id,
        gallery_url: gallery.gallery_url,
        gallery_name: gallery.gallery_name,
        artist: {
          handle: gallery.handle,
          first_name: gallery.first_name,
          last_name: gallery.last_name,
          photo_path: gallery.photo_path,
          bio: gallery.bio
        }
      },
      artworks: artworksResult.rows
    });
  } catch (err) {
    console.error('Error fetching public gallery:', err);
    res.status(500).json({ message: 'Failed to fetch gallery' });
  } finally {
    client.release();
  }
});

// Get a single artwork from a public gallery
router.get('/public/:galleryUrl/:artworkId', async (req, res) => {
  const { galleryUrl, artworkId } = req.params;
  const client = await getClient();

  try {
    // Verify gallery exists and get artwork
    const result = await client.query(
      `SELECT ga.id, ga.title, ga.description, ga.image_path, ga.created_at, ga.updated_at,
              ug.gallery_url, ug.gallery_name,
              u.handle, u.first_name, u.last_name, u.photo_path, u.bio
       FROM gallery_artworks ga
       JOIN users u ON ga.user_id = u.id
       JOIN user_gallery ug ON ug.user_id = u.id
       WHERE ug.gallery_url = $1 AND ga.id = $2 AND ga.is_published = TRUE`,
      [galleryUrl, artworkId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Artwork not found' });
    }

    const row = result.rows[0];
    res.json({
      artwork: {
        id: row.id,
        title: row.title,
        description: row.description,
        image_path: row.image_path,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      gallery: {
        gallery_url: row.gallery_url,
        gallery_name: row.gallery_name,
        artist: {
          handle: row.handle,
          first_name: row.first_name,
          last_name: row.last_name,
          photo_path: row.photo_path,
          bio: row.bio
        }
      }
    });
  } catch (err) {
    console.error('Error fetching public artwork:', err);
    res.status(500).json({ message: 'Failed to fetch artwork' });
  } finally {
    client.release();
  }
});

// =====================
// GALLERY SETTINGS ENDPOINTS (auth required)
// =====================

// Get current user's gallery settings
router.get('/settings', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, gallery_url, gallery_name, created_at
       FROM user_gallery
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.json({ settings: null });
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error('Error fetching gallery settings:', err);
    res.status(500).json({ message: 'Failed to fetch settings' });
  } finally {
    client.release();
  }
});

// Create gallery settings
router.post('/settings', authenticate, async (req, res) => {
  const { gallery_url, gallery_name } = req.body;
  const client = await getClient();

  try {
    // Check if user already has settings
    const existing = await client.query(
      'SELECT id FROM user_gallery WHERE user_id = $1',
      [req.user.id]
    );

    if (existing.rowCount > 0) {
      return res.status(400).json({ message: 'Gallery settings already exist. Use PUT to update.' });
    }

    // Use handle as default gallery_url if not provided
    const finalGalleryUrl = gallery_url || req.user.handle;
    const finalGalleryName = gallery_name || `${req.user.handle}'s Gallery`;

    // Check uniqueness
    const urlCheck = await client.query(
      'SELECT id FROM user_gallery WHERE gallery_url = $1',
      [finalGalleryUrl]
    );

    if (urlCheck.rowCount > 0) {
      return res.status(400).json({ message: 'This gallery URL is already taken' });
    }

    await client.query(
      `INSERT INTO user_gallery (user_id, gallery_url, gallery_name)
       VALUES ($1, $2, $3)`,
      [req.user.id, finalGalleryUrl, finalGalleryName]
    );

    const result = await client.query(
      'SELECT id, gallery_url, gallery_name, created_at FROM user_gallery WHERE user_id = $1',
      [req.user.id]
    );

    res.status(201).json({ settings: result.rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'This gallery URL is already taken' });
    }
    console.error('Error creating gallery settings:', err);
    res.status(500).json({ message: 'Failed to create settings' });
  } finally {
    client.release();
  }
});

// Update gallery settings
router.put('/settings', authenticate, async (req, res) => {
  const { gallery_url, gallery_name } = req.body;
  const client = await getClient();

  try {
    if (!gallery_url || gallery_url.trim().length === 0) {
      return res.status(400).json({ message: 'Gallery URL is required' });
    }

    // Check if URL is taken by another user
    const urlCheck = await client.query(
      'SELECT id, user_id FROM user_gallery WHERE gallery_url = $1',
      [gallery_url.trim()]
    );

    if (urlCheck.rowCount > 0 && urlCheck.rows[0].user_id !== req.user.id) {
      return res.status(400).json({ message: 'This gallery URL is already taken' });
    }

    const result = await client.query(
      `UPDATE user_gallery SET gallery_url = $1, gallery_name = $2 WHERE user_id = $3`,
      [gallery_url.trim(), gallery_name || `${req.user.handle}'s Gallery`, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Gallery settings not found' });
    }

    const updated = await client.query(
      'SELECT id, gallery_url, gallery_name, created_at FROM user_gallery WHERE user_id = $1',
      [req.user.id]
    );

    res.json({ settings: updated.rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'This gallery URL is already taken' });
    }
    console.error('Error updating gallery settings:', err);
    res.status(500).json({ message: 'Failed to update settings' });
  } finally {
    client.release();
  }
});

// Check if a gallery URL is available
router.get('/check-url/:galleryUrl', authenticate, async (req, res) => {
  const { galleryUrl } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'SELECT id, user_id FROM user_gallery WHERE gallery_url = $1',
      [galleryUrl]
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
    console.error('Error checking gallery URL:', err);
    res.status(500).json({ message: 'Failed to check URL' });
  } finally {
    client.release();
  }
});

// =====================
// ARTWORK ENDPOINTS (auth required)
// =====================

// Get all artworks for current user
router.get('/artworks', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, title, description, image_path, is_published, created_at, updated_at
       FROM gallery_artworks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({ artworks: result.rows });
  } catch (err) {
    console.error('Error fetching artworks:', err);
    res.status(500).json({ message: 'Failed to fetch artworks' });
  } finally {
    client.release();
  }
});

// Get a single artwork by ID (must belong to current user)
router.get('/artworks/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT id, title, description, image_path, is_published, created_at, updated_at
       FROM gallery_artworks
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Artwork not found' });
    }

    res.json({ artwork: result.rows[0] });
  } catch (err) {
    console.error('Error fetching artwork:', err);
    res.status(500).json({ message: 'Failed to fetch artwork' });
  } finally {
    client.release();
  }
});

// Create a new artwork (with image upload)
router.post('/artworks', authenticate, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Image file is required' });
  }

  const { title, description, isPublished } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Auto-create gallery settings if they don't exist
    const existingGallery = await client.query(
      'SELECT id FROM user_gallery WHERE user_id = $1',
      [req.user.id]
    );

    if (existingGallery.rowCount === 0) {
      // Create default gallery settings with handle as URL
      try {
        await client.query(
          `INSERT INTO user_gallery (user_id, gallery_url, gallery_name)
           VALUES ($1, $2, $3)`,
          [req.user.id, req.user.handle, `${req.user.handle}'s Gallery`]
        );
      } catch (galleryErr) {
        // If handle is taken, append user ID
        if (galleryErr.code === 'ER_DUP_ENTRY') {
          await client.query(
            `INSERT INTO user_gallery (user_id, gallery_url, gallery_name)
             VALUES ($1, $2, $3)`,
            [req.user.id, `${req.user.handle}-${req.user.id}`, `${req.user.handle}'s Gallery`]
          );
        } else {
          throw galleryErr;
        }
      }
    }

    // Upload image to S3
    const ext = path.extname(req.file.originalname).toLowerCase();
    const s3Key = `gallery/${req.user.id}/art_${Date.now()}${ext}`;

    const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);
    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload image: ' + uploadResult.error });
    }

    // Insert artwork record
    await client.query(
      `INSERT INTO gallery_artworks (user_id, title, description, image_path, is_published)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, title.trim(), description || null, s3Key, isPublished === 'true' || isPublished === true]
    );

    // Get the inserted artwork
    const result = await client.query(
      `SELECT id, title, description, image_path, is_published, created_at, updated_at
       FROM gallery_artworks
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    res.status(201).json({ artwork: result.rows[0] });
  } catch (err) {
    console.error('Error creating artwork:', err);
    res.status(500).json({ message: 'Failed to create artwork' });
  } finally {
    client.release();
  }
});

// Update artwork metadata (not the image)
router.put('/artworks/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, description, isPublished } = req.body;
  const client = await getClient();

  try {
    // Verify ownership
    const check = await client.query(
      'SELECT id FROM gallery_artworks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Artwork not found' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    await client.query(
      `UPDATE gallery_artworks
       SET title = $1, description = $2, is_published = $3
       WHERE id = $4 AND user_id = $5`,
      [title.trim(), description || null, isPublished || false, id, req.user.id]
    );

    // Get updated artwork
    const result = await client.query(
      `SELECT id, title, description, image_path, is_published, created_at, updated_at
       FROM gallery_artworks
       WHERE id = $1`,
      [id]
    );

    res.json({ artwork: result.rows[0] });
  } catch (err) {
    console.error('Error updating artwork:', err);
    res.status(500).json({ message: 'Failed to update artwork' });
  } finally {
    client.release();
  }
});

// Delete an artwork (including S3 cleanup)
router.delete('/artworks/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Get artwork to retrieve S3 key
    const artwork = await client.query(
      'SELECT id, image_path FROM gallery_artworks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (artwork.rowCount === 0) {
      return res.status(404).json({ message: 'Artwork not found' });
    }

    const s3Key = artwork.rows[0].image_path;

    // Delete from database
    await client.query(
      'DELETE FROM gallery_artworks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    // Delete from S3
    if (s3Key) {
      const deleteResult = await deleteFromS3(s3Key);
      if (!deleteResult.success) {
        console.warn('Failed to delete S3 object:', s3Key, deleteResult.error);
        // Don't fail the request, the DB record is already deleted
      }
    }

    res.json({ message: 'Artwork deleted successfully' });
  } catch (err) {
    console.error('Error deleting artwork:', err);
    res.status(500).json({ message: 'Failed to delete artwork' });
  } finally {
    client.release();
  }
});

module.exports = router;
