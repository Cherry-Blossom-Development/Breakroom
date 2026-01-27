const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

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

// Helper: Check if user can access a song (owner or collaborator)
const canAccessSong = async (client, songId, userId) => {
  const result = await client.query(
    `SELECT s.id, s.user_id, s.visibility,
            (SELECT role FROM song_collaborators WHERE song_id = s.id AND user_id = $2) as collab_role
     FROM songs s
     WHERE s.id = $1`,
    [songId, userId]
  );

  if (result.rowCount === 0) return { access: false, song: null };

  const song = result.rows[0];

  // Owner has full access
  if (song.user_id === userId) {
    return { access: true, song, role: 'owner' };
  }

  // Collaborator access
  if (song.collab_role) {
    return { access: true, song, role: song.collab_role };
  }

  // Public songs are viewable by all
  if (song.visibility === 'public') {
    return { access: true, song, role: 'viewer' };
  }

  return { access: false, song: null };
};

// Helper: Check if user can edit a song
const canEditSong = async (client, songId, userId) => {
  const { access, song, role } = await canAccessSong(client, songId, userId);
  if (!access) return false;
  return role === 'owner' || role === 'editor';
};

// =====================
// SONGS ENDPOINTS
// =====================

// Get all songs for current user (owned + collaborating)
router.get('/songs', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT s.*, u.handle as owner_handle, u.first_name as owner_first_name,
              'owner' as role,
              (SELECT COUNT(*) FROM lyrics WHERE song_id = s.id) as lyric_count
       FROM songs s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1
       UNION
       SELECT s.*, u.handle as owner_handle, u.first_name as owner_first_name,
              sc.role,
              (SELECT COUNT(*) FROM lyrics WHERE song_id = s.id) as lyric_count
       FROM songs s
       JOIN users u ON s.user_id = u.id
       JOIN song_collaborators sc ON sc.song_id = s.id
       WHERE sc.user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    res.json({ songs: result.rows });
  } catch (err) {
    console.error('Error fetching songs:', err);
    res.status(500).json({ message: 'Failed to fetch songs' });
  } finally {
    client.release();
  }
});

// Get a single song with its lyrics
router.get('/songs/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const { access, song, role } = await canAccessSong(client, id, req.user.id);

    if (!access) {
      return res.status(404).json({ message: 'Song not found' });
    }

    // Get full song details
    const songResult = await client.query(
      `SELECT s.*, u.handle as owner_handle, u.first_name as owner_first_name, u.last_name as owner_last_name
       FROM songs s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [id]
    );

    // Get lyrics for this song
    const lyricsResult = await client.query(
      `SELECT l.*, u.handle as author_handle, u.first_name as author_first_name
       FROM lyrics l
       JOIN users u ON l.user_id = u.id
       WHERE l.song_id = $1
       ORDER BY l.section_order ASC, l.created_at ASC`,
      [id]
    );

    // Get collaborators
    const collabResult = await client.query(
      `SELECT sc.*, u.handle, u.first_name, u.last_name
       FROM song_collaborators sc
       JOIN users u ON sc.user_id = u.id
       WHERE sc.song_id = $1`,
      [id]
    );

    res.json({
      song: { ...songResult.rows[0], role },
      lyrics: lyricsResult.rows,
      collaborators: collabResult.rows
    });
  } catch (err) {
    console.error('Error fetching song:', err);
    res.status(500).json({ message: 'Failed to fetch song' });
  } finally {
    client.release();
  }
});

// Create a new song
router.post('/songs', authenticate, async (req, res) => {
  const { title, description, genre, status, visibility } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    await client.query(
      `INSERT INTO songs (user_id, title, description, genre, status, visibility)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user.id,
        title.trim(),
        description || null,
        genre || null,
        status || 'idea',
        visibility || 'private'
      ]
    );

    // Get the inserted song
    const result = await client.query(
      `SELECT * FROM songs WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    res.status(201).json({ song: result.rows[0] });
  } catch (err) {
    console.error('Error creating song:', err);
    res.status(500).json({ message: 'Failed to create song' });
  } finally {
    client.release();
  }
});

// Update a song
router.put('/songs/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, description, genre, status, visibility } = req.body;
  const client = await getClient();

  try {
    const canEdit = await canEditSong(client, id, req.user.id);
    if (!canEdit) {
      return res.status(403).json({ message: 'Not authorized to edit this song' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    await client.query(
      `UPDATE songs
       SET title = $1, description = $2, genre = $3, status = $4, visibility = $5
       WHERE id = $6`,
      [title.trim(), description || null, genre || null, status || 'idea', visibility || 'private', id]
    );

    const result = await client.query('SELECT * FROM songs WHERE id = $1', [id]);
    res.json({ song: result.rows[0] });
  } catch (err) {
    console.error('Error updating song:', err);
    res.status(500).json({ message: 'Failed to update song' });
  } finally {
    client.release();
  }
});

// Delete a song (owner only)
router.delete('/songs/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'DELETE FROM songs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Song not found or not authorized' });
    }

    res.json({ message: 'Song deleted successfully' });
  } catch (err) {
    console.error('Error deleting song:', err);
    res.status(500).json({ message: 'Failed to delete song' });
  } finally {
    client.release();
  }
});

// =====================
// COLLABORATORS ENDPOINTS
// =====================

// Add a collaborator to a song (owner only)
router.post('/songs/:id/collaborators', authenticate, async (req, res) => {
  const { id } = req.params;
  const { handle, role } = req.body;
  const client = await getClient();

  try {
    // Verify ownership
    const songCheck = await client.query(
      'SELECT id FROM songs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (songCheck.rowCount === 0) {
      return res.status(403).json({ message: 'Only the song owner can add collaborators' });
    }

    // Find user by handle
    const userResult = await client.query(
      'SELECT id, handle, first_name, last_name FROM users WHERE handle = $1',
      [handle]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const collaborator = userResult.rows[0];

    // Can't add yourself
    if (collaborator.id === req.user.id) {
      return res.status(400).json({ message: 'Cannot add yourself as a collaborator' });
    }

    // Add collaborator
    await client.query(
      `INSERT INTO song_collaborators (song_id, user_id, role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON DUPLICATE KEY UPDATE role = $3`,
      [id, collaborator.id, role || 'editor', req.user.id]
    );

    res.status(201).json({
      collaborator: {
        user_id: collaborator.id,
        handle: collaborator.handle,
        first_name: collaborator.first_name,
        last_name: collaborator.last_name,
        role: role || 'editor'
      }
    });
  } catch (err) {
    console.error('Error adding collaborator:', err);
    res.status(500).json({ message: 'Failed to add collaborator' });
  } finally {
    client.release();
  }
});

// Remove a collaborator from a song (owner only)
router.delete('/songs/:id/collaborators/:userId', authenticate, async (req, res) => {
  const { id, userId } = req.params;
  const client = await getClient();

  try {
    // Verify ownership
    const songCheck = await client.query(
      'SELECT id FROM songs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (songCheck.rowCount === 0) {
      return res.status(403).json({ message: 'Only the song owner can remove collaborators' });
    }

    await client.query(
      'DELETE FROM song_collaborators WHERE song_id = $1 AND user_id = $2',
      [id, userId]
    );

    res.json({ message: 'Collaborator removed' });
  } catch (err) {
    console.error('Error removing collaborator:', err);
    res.status(500).json({ message: 'Failed to remove collaborator' });
  } finally {
    client.release();
  }
});

// =====================
// LYRICS ENDPOINTS
// =====================

// Get all standalone lyrics (not in a song) for current user
router.get('/standalone', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT * FROM lyrics
       WHERE user_id = $1 AND song_id IS NULL
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    res.json({ lyrics: result.rows });
  } catch (err) {
    console.error('Error fetching standalone lyrics:', err);
    res.status(500).json({ message: 'Failed to fetch lyrics' });
  } finally {
    client.release();
  }
});

// Get a single lyric
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT l.*, u.handle as author_handle, u.first_name as author_first_name
       FROM lyrics l
       JOIN users u ON l.user_id = u.id
       WHERE l.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Lyric not found' });
    }

    const lyric = result.rows[0];

    // Check access: own lyric, or part of accessible song
    if (lyric.user_id !== req.user.id) {
      if (lyric.song_id) {
        const { access } = await canAccessSong(client, lyric.song_id, req.user.id);
        if (!access) {
          return res.status(403).json({ message: 'Not authorized to view this lyric' });
        }
      } else {
        // Standalone lyric belonging to someone else
        return res.status(403).json({ message: 'Not authorized to view this lyric' });
      }
    }

    res.json({ lyric });
  } catch (err) {
    console.error('Error fetching lyric:', err);
    res.status(500).json({ message: 'Failed to fetch lyric' });
  } finally {
    client.release();
  }
});

// Create a new lyric
router.post('/', authenticate, async (req, res) => {
  const { song_id, title, content, section_type, section_order, mood, notes, status } = req.body;
  const client = await getClient();

  try {
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    // If assigning to a song, verify edit access
    if (song_id) {
      const canEdit = await canEditSong(client, song_id, req.user.id);
      if (!canEdit) {
        return res.status(403).json({ message: 'Not authorized to add lyrics to this song' });
      }
    }

    await client.query(
      `INSERT INTO lyrics (user_id, song_id, title, content, section_type, section_order, mood, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        req.user.id,
        song_id || null,
        title || null,
        content.trim(),
        section_type || 'idea',
        section_order || null,
        mood || null,
        notes || null,
        status || 'draft'
      ]
    );

    const result = await client.query(
      `SELECT * FROM lyrics WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    res.status(201).json({ lyric: result.rows[0] });
  } catch (err) {
    console.error('Error creating lyric:', err);
    res.status(500).json({ message: 'Failed to create lyric' });
  } finally {
    client.release();
  }
});

// Update a lyric
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { song_id, title, content, section_type, section_order, mood, notes, status } = req.body;
  const client = await getClient();

  try {
    // Get existing lyric
    const existing = await client.query('SELECT * FROM lyrics WHERE id = $1', [id]);

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Lyric not found' });
    }

    const lyric = existing.rows[0];

    // Check edit permissions
    let canEdit = lyric.user_id === req.user.id;

    if (!canEdit && lyric.song_id) {
      canEdit = await canEditSong(client, lyric.song_id, req.user.id);
    }

    if (!canEdit) {
      return res.status(403).json({ message: 'Not authorized to edit this lyric' });
    }

    // If moving to a different song, verify access to new song
    if (song_id && song_id !== lyric.song_id) {
      const canEditNewSong = await canEditSong(client, song_id, req.user.id);
      if (!canEditNewSong) {
        return res.status(403).json({ message: 'Not authorized to add lyrics to that song' });
      }
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    await client.query(
      `UPDATE lyrics
       SET song_id = $1, title = $2, content = $3, section_type = $4,
           section_order = $5, mood = $6, notes = $7, status = $8
       WHERE id = $9`,
      [
        song_id !== undefined ? song_id : lyric.song_id,
        title || null,
        content.trim(),
        section_type || 'idea',
        section_order !== undefined ? section_order : lyric.section_order,
        mood || null,
        notes || null,
        status || 'draft',
        id
      ]
    );

    const result = await client.query('SELECT * FROM lyrics WHERE id = $1', [id]);
    res.json({ lyric: result.rows[0] });
  } catch (err) {
    console.error('Error updating lyric:', err);
    res.status(500).json({ message: 'Failed to update lyric' });
  } finally {
    client.release();
  }
});

// Delete a lyric
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Get existing lyric
    const existing = await client.query('SELECT * FROM lyrics WHERE id = $1', [id]);

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Lyric not found' });
    }

    const lyric = existing.rows[0];

    // Check delete permissions (owner of lyric, or editor of song)
    let canDelete = lyric.user_id === req.user.id;

    if (!canDelete && lyric.song_id) {
      canDelete = await canEditSong(client, lyric.song_id, req.user.id);
    }

    if (!canDelete) {
      return res.status(403).json({ message: 'Not authorized to delete this lyric' });
    }

    await client.query('DELETE FROM lyrics WHERE id = $1', [id]);
    res.json({ message: 'Lyric deleted successfully' });
  } catch (err) {
    console.error('Error deleting lyric:', err);
    res.status(500).json({ message: 'Failed to delete lyric' });
  } finally {
    client.release();
  }
});

// Reorder lyrics within a song
router.put('/songs/:songId/reorder', authenticate, async (req, res) => {
  const { songId } = req.params;
  const { lyricOrder } = req.body; // Array of { id, section_order }
  const client = await getClient();

  try {
    const canEdit = await canEditSong(client, songId, req.user.id);
    if (!canEdit) {
      return res.status(403).json({ message: 'Not authorized to edit this song' });
    }

    // Update each lyric's order
    for (const item of lyricOrder) {
      await client.query(
        'UPDATE lyrics SET section_order = $1 WHERE id = $2 AND song_id = $3',
        [item.section_order, item.id, songId]
      );
    }

    res.json({ message: 'Lyrics reordered successfully' });
  } catch (err) {
    console.error('Error reordering lyrics:', err);
    res.status(500).json({ message: 'Failed to reorder lyrics' });
  } finally {
    client.release();
  }
});

module.exports = router;
