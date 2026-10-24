const express = require('express');
const { sanitizeHtml } = require('../utilities/sanitizeHtml');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { uploadToS3, deleteFromS3 } = require('../utilities/aws-s3');
const { extractToken } = require('../utilities/auth');
const { memberSql } = require('../utilities/greywire');

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
      'SELECT id, handle, first_name, last_name, email, bio, work_bio, photo_path, timezone, city, latitude, longitude, created_at FROM users WHERE handle = $1',
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

// Helper to get friend count for a user
async function getFriendCount(client, userId) {
  const result = await client.query(
    `SELECT COUNT(*) as count FROM friends
     WHERE (user_id = $1 OR friend_id = $2) AND status = 'accepted'`,
    [userId, userId]
  );
  return parseInt(result.rows[0].count) || 0;
}

// Helper to get user's skills
async function getUserSkills(client, userId) {
  const result = await client.query(
    `SELECT s.id, s.name FROM skills s
     JOIN user_skills us ON us.skill_id = s.id
     WHERE us.user_id = $1
     ORDER BY s.name`,
    [userId]
  );
  return result.rows;
}

// Helper to get user's jobs
async function getUserJobs(client, userId) {
  const result = await client.query(
    `SELECT id, title, company, location, start_date, end_date, is_current, description
     FROM user_jobs
     WHERE user_id = $1
     ORDER BY is_current DESC, start_date DESC`,
    [userId]
  );
  return result.rows;
}

// Helper to get user's Musician Profile (Greywire site only, see migration 094)
async function getMusicianProfile(client, userId) {
  const profile = await client.query(
    'SELECT bio, musician_only FROM musician_profiles WHERE user_id = $1',
    [userId]
  );
  const instruments = await client.query(
    `SELECT ui.id, ui.instrument_id, i.name, ui.skill_level, ui.years_playing, ui.is_primary
     FROM user_instruments ui
     JOIN instruments i ON i.id = ui.instrument_id
     WHERE ui.user_id = $1
     ORDER BY ui.is_primary DESC, i.name`,
    [userId]
  );
  const bands = await client.query(
    `SELECT id, band_name, role, start_year, end_year, is_current
     FROM user_band_history
     WHERE user_id = $1
     ORDER BY is_current DESC, COALESCE(end_year, start_year) DESC, start_year DESC, id DESC`,
    [userId]
  );
  return {
    bio: profile.rows[0]?.bio || '',
    musicianOnly: !!profile.rows[0]?.musician_only,
    instruments: instruments.rows.map(i => ({
      id: i.id,
      instrumentId: i.instrument_id,
      name: i.name,
      skillLevel: i.skill_level,
      yearsPlaying: i.years_playing,
      isPrimary: !!i.is_primary
    })),
    bands: bands.rows.map(b => ({
      id: b.id,
      bandName: b.band_name,
      role: b.role,
      startYear: b.start_year,
      endYear: b.end_year,
      isCurrent: !!b.is_current
    }))
  };
}

// Get current user's profile
router.get('/', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const friendCount = await getFriendCount(client, req.user.id);
    const skills = await getUserSkills(client, req.user.id);
    const jobs = await getUserJobs(client, req.user.id);
    const musician = req.site === 'greywire' ? await getMusicianProfile(client, req.user.id) : undefined;
    res.json({
      user: {
        id: req.user.id,
        handle: req.user.handle,
        firstName: req.user.first_name,
        lastName: req.user.last_name,
        email: req.user.email,
        bio: req.user.bio,
        workBio: req.user.work_bio,
        photoPath: req.user.photo_path,
        timezone: req.user.timezone,
        city: req.user.city,
        latitude: req.user.latitude,
        longitude: req.user.longitude,
        createdAt: req.user.created_at,
        friendCount,
        skills,
        jobs,
        musician
      }
    });
  } finally {
    client.release();
  }
});

// Get public profile by handle
router.get('/user/:handle', async (req, res) => {
  const { handle } = req.params;
  const client = await getClient();

  try {
    // On the Greywire site, only members have profiles
    const result = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.bio, u.work_bio, u.photo_path, u.created_at
       FROM users u WHERE u.handle = $1 ${req.site === 'greywire' ? `AND ${memberSql('u')}` : ''}`,
      [handle]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = result.rows[0];
    const friendCount = await getFriendCount(client, user.id);
    const skills = await getUserSkills(client, user.id);
    const jobs = await getUserJobs(client, user.id);
    const musician = req.site === 'greywire' ? await getMusicianProfile(client, user.id) : undefined;
    // The owner can choose to show only their Musician Profile on Greywire
    const musicianOnly = !!musician?.musicianOnly;

    res.json({
      user: {
        id: user.id,
        handle: user.handle,
        firstName: user.first_name,
        lastName: user.last_name,
        bio: musicianOnly ? null : user.bio,
        workBio: musicianOnly ? null : user.work_bio,
        photoPath: user.photo_path,
        createdAt: user.created_at,
        friendCount,
        skills: musicianOnly ? [] : skills,
        jobs: musicianOnly ? [] : jobs,
        musician
      }
    });
  } catch (err) {
    console.error('Error fetching public profile:', err);
    res.status(500).json({ message: 'Failed to fetch profile' });
  } finally {
    client.release();
  }
});

// Update profile (bio, work bio, and basic info)
router.put('/', authenticate, async (req, res) => {
  const { bio, workBio, firstName, lastName } = req.body;
  const client = await getClient();

  try {
    await client.query(
      'UPDATE users SET bio = $1, work_bio = $2, first_name = $3, last_name = $4 WHERE id = $5',
      [sanitizeHtml(bio), sanitizeHtml(workBio), firstName, lastName, req.user.id]
    );

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ message: 'Failed to update profile' });
  } finally {
    client.release();
  }
});

// Update user location (city with geocoding)
router.put('/location', authenticate, async (req, res) => {
  const { city } = req.body;
  const client = await getClient();

  try {
    if (!city || city.trim().length === 0) {
      // Clear location
      await client.query(
        'UPDATE users SET city = NULL, latitude = NULL, longitude = NULL WHERE id = $1',
        [req.user.id]
      );
      return res.json({ message: 'Location cleared' });
    }

    // Geocode the city using Open-Meteo geocoding API
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );

    if (!geoResponse.ok) {
      return res.status(500).json({ message: 'Failed to geocode city' });
    }

    const geoData = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) {
      return res.status(400).json({ message: 'City not found' });
    }

    const location = geoData.results[0];
    const cityName = location.admin1
      ? `${location.name}, ${location.admin1}, ${location.country}`
      : `${location.name}, ${location.country}`;

    await client.query(
      'UPDATE users SET city = $1, latitude = $2, longitude = $3 WHERE id = $4',
      [cityName, location.latitude, location.longitude, req.user.id]
    );

    res.json({
      message: 'Location updated successfully',
      city: cityName,
      latitude: location.latitude,
      longitude: location.longitude
    });
  } catch (err) {
    console.error('Error updating location:', err);
    res.status(500).json({ message: 'Failed to update location' });
  } finally {
    client.release();
  }
});

// Update user timezone
router.put('/timezone', authenticate, async (req, res) => {
  const { timezone } = req.body;
  const client = await getClient();

  try {
    // Validate timezone is a valid IANA timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (e) {
      return res.status(400).json({ message: 'Invalid timezone' });
    }

    await client.query(
      'UPDATE users SET timezone = $1 WHERE id = $2',
      [timezone, req.user.id]
    );

    res.json({ message: 'Timezone updated successfully', timezone });
  } catch (err) {
    console.error('Error updating timezone:', err);
    res.status(500).json({ message: 'Failed to update timezone' });
  } finally {
    client.release();
  }
});

// Upload profile photo
router.post('/photo', authenticate, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const client = await getClient();
  try {
    // Generate S3 key
    const ext = path.extname(req.file.originalname).toLowerCase();
    const s3Key = `profiles/profile_${req.user.id}_${Date.now()}${ext}`;

    // Upload to S3
    const uploadResult = await uploadToS3(req.file.buffer, s3Key, req.file.mimetype);

    if (!uploadResult.success) {
      return res.status(500).json({ message: 'Failed to upload to S3: ' + uploadResult.error });
    }

    // Delete old photo from S3 if exists
    if (req.user.photo_path) {
      await deleteFromS3(req.user.photo_path);
    }

    // Update database with new S3 key
    await client.query(
      'UPDATE users SET photo_path = $1 WHERE id = $2',
      [s3Key, req.user.id]
    );

    res.json({
      message: 'Photo uploaded successfully',
      photoPath: s3Key
    });
  } catch (err) {
    console.error('Error uploading photo:', err);
    res.status(500).json({ message: 'Failed to upload photo' });
  } finally {
    client.release();
  }
});

// Delete profile photo
router.delete('/photo', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    if (req.user.photo_path) {
      // Delete from S3
      await deleteFromS3(req.user.photo_path);

      await client.query(
        'UPDATE users SET photo_path = NULL WHERE id = $1',
        [req.user.id]
      );
    }

    res.json({ message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Error deleting photo:', err);
    res.status(500).json({ message: 'Failed to delete photo' });
  } finally {
    client.release();
  }
});

// Search skills for autocomplete
router.get('/skills/search', authenticate, async (req, res) => {
  const { q } = req.query;
  const client = await getClient();

  try {
    if (!q || q.trim().length === 0) {
      return res.json({ skills: [] });
    }

    const result = await client.query(
      `SELECT id, name FROM skills
       WHERE LOWER(name) LIKE LOWER($1)
       ORDER BY name
       LIMIT 10`,
      [`%${q.trim()}%`]
    );

    res.json({ skills: result.rows });
  } catch (err) {
    console.error('Error searching skills:', err);
    res.status(500).json({ message: 'Failed to search skills' });
  } finally {
    client.release();
  }
});

// Add a skill to user's profile
router.post('/skills', authenticate, async (req, res) => {
  const { name } = req.body;
  const client = await getClient();

  try {
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Skill name is required' });
    }

    const skillName = name.trim();

    // Check if skill exists, create if not
    let skillResult = await client.query(
      'SELECT id, name FROM skills WHERE LOWER(name) = LOWER($1)',
      [skillName]
    );

    let skillId;
    let finalName;

    if (skillResult.rowCount === 0) {
      // Create new skill
      await client.query(
        'INSERT INTO skills (name) VALUES ($1)',
        [skillName]
      );
      skillResult = await client.query(
        'SELECT id, name FROM skills WHERE LOWER(name) = LOWER($1)',
        [skillName]
      );
    }

    skillId = skillResult.rows[0].id;
    finalName = skillResult.rows[0].name;

    // Check if user already has this skill
    const existingLink = await client.query(
      'SELECT id FROM user_skills WHERE user_id = $1 AND skill_id = $2',
      [req.user.id, skillId]
    );

    if (existingLink.rowCount > 0) {
      return res.status(400).json({ message: 'Skill already added' });
    }

    // Add skill to user
    await client.query(
      'INSERT INTO user_skills (user_id, skill_id) VALUES ($1, $2)',
      [req.user.id, skillId]
    );

    res.status(201).json({
      skill: { id: skillId, name: finalName }
    });
  } catch (err) {
    console.error('Error adding skill:', err);
    res.status(500).json({ message: 'Failed to add skill' });
  } finally {
    client.release();
  }
});

// Remove a skill from user's profile
router.delete('/skills/:skillId', authenticate, async (req, res) => {
  const { skillId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'DELETE FROM user_skills WHERE user_id = $1 AND skill_id = $2',
      [req.user.id, skillId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Skill not found' });
    }

    res.json({ message: 'Skill removed successfully' });
  } catch (err) {
    console.error('Error removing skill:', err);
    res.status(500).json({ message: 'Failed to remove skill' });
  } finally {
    client.release();
  }
});

// Add a job to user's profile
router.post('/jobs', authenticate, async (req, res) => {
  const { title, company, location, startDate, endDate, isCurrent, description } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Job title is required' });
    }
    if (!company || company.trim().length === 0) {
      return res.status(400).json({ message: 'Company is required' });
    }
    if (!startDate) {
      return res.status(400).json({ message: 'Start date is required' });
    }

    await client.query(
      `INSERT INTO user_jobs (user_id, title, company, location, start_date, end_date, is_current, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user.id,
        title.trim(),
        company.trim(),
        location?.trim() || null,
        startDate,
        isCurrent ? null : endDate || null,
        isCurrent || false,
        description?.trim() || null
      ]
    );

    // Get the inserted job
    const result = await client.query(
      `SELECT id, title, company, location, start_date, end_date, is_current, description
       FROM user_jobs
       WHERE user_id = $1
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );

    res.status(201).json({ job: result.rows[0] });
  } catch (err) {
    console.error('Error adding job:', err);
    res.status(500).json({ message: 'Failed to add job' });
  } finally {
    client.release();
  }
});

// Update a job
router.put('/jobs/:jobId', authenticate, async (req, res) => {
  const { jobId } = req.params;
  const { title, company, location, startDate, endDate, isCurrent, description } = req.body;
  const client = await getClient();

  try {
    // Verify ownership
    const check = await client.query(
      'SELECT id FROM user_jobs WHERE id = $1 AND user_id = $2',
      [jobId, req.user.id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Job title is required' });
    }
    if (!company || company.trim().length === 0) {
      return res.status(400).json({ message: 'Company is required' });
    }
    if (!startDate) {
      return res.status(400).json({ message: 'Start date is required' });
    }

    await client.query(
      `UPDATE user_jobs
       SET title = $1, company = $2, location = $3, start_date = $4, end_date = $5, is_current = $6, description = $7
       WHERE id = $8 AND user_id = $9`,
      [
        title.trim(),
        company.trim(),
        location?.trim() || null,
        startDate,
        isCurrent ? null : endDate || null,
        isCurrent || false,
        description?.trim() || null,
        jobId,
        req.user.id
      ]
    );

    // Get updated job
    const result = await client.query(
      `SELECT id, title, company, location, start_date, end_date, is_current, description
       FROM user_jobs
       WHERE id = $1`,
      [jobId]
    );

    res.json({ job: result.rows[0] });
  } catch (err) {
    console.error('Error updating job:', err);
    res.status(500).json({ message: 'Failed to update job' });
  } finally {
    client.release();
  }
});

// Delete a job
router.delete('/jobs/:jobId', authenticate, async (req, res) => {
  const { jobId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'DELETE FROM user_jobs WHERE id = $1 AND user_id = $2',
      [jobId, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json({ message: 'Job removed successfully' });
  } catch (err) {
    console.error('Error removing job:', err);
    res.status(500).json({ message: 'Failed to remove job' });
  } finally {
    client.release();
  }
});

// Musician Profile routes exist only on the Greywire site
const greywireOnly = (req, res, next) => {
  if (req.site !== 'greywire') {
    return res.status(404).json({ message: 'Not found' });
  }
  next();
};

const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'professional'];

// Whole number in [min, max], null when blank, or undefined when invalid
function optionalInt(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

// Validate an instrument's details; returns { error } or the cleaned fields
function readInstrumentFields(body) {
  const skillLevel = body.skillLevel || null;
  if (skillLevel && !SKILL_LEVELS.includes(skillLevel)) {
    return { error: 'Invalid skill level' };
  }
  const yearsPlaying = optionalInt(body.yearsPlaying, 0, 100);
  if (yearsPlaying === undefined) {
    return { error: 'Years playing must be a whole number from 0 to 100' };
  }
  return { skillLevel, yearsPlaying, isPrimary: !!body.isPrimary };
}

// Validate a band's details; returns { error } or the cleaned fields
function readBandFields(body) {
  const bandName = body.bandName?.trim();
  if (!bandName) {
    return { error: 'Band name is required' };
  }
  if (bandName.length > 100) {
    return { error: 'Band name must be 100 characters or fewer' };
  }
  const role = body.role?.trim() || null;
  if (role && role.length > 100) {
    return { error: 'Role must be 100 characters or fewer' };
  }
  const maxYear = new Date().getFullYear() + 1;
  const startYear = optionalInt(body.startYear, 1900, maxYear);
  const isCurrent = !!body.isCurrent;
  const endYear = isCurrent ? null : optionalInt(body.endYear, 1900, maxYear);
  if (startYear === undefined || endYear === undefined) {
    return { error: `Years must be between 1900 and ${maxYear}` };
  }
  if (startYear && endYear && endYear < startYear) {
    return { error: 'End year must be after start year' };
  }
  return { bandName, role, startYear, endYear, isCurrent };
}

// Update Musician Profile bio and the musician-only setting
router.put('/musician', greywireOnly, authenticate, async (req, res) => {
  const { bio, musicianOnly } = req.body;
  const client = await getClient();

  try {
    await client.query(
      `INSERT INTO musician_profiles (user_id, bio, musician_only)
       VALUES ($1, $2, $3)
       ON DUPLICATE KEY UPDATE bio = VALUES(bio), musician_only = VALUES(musician_only)`,
      [req.user.id, sanitizeHtml(bio || ''), musicianOnly ? 1 : 0]
    );

    res.json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error updating musician profile:', err);
    res.status(500).json({ message: 'Failed to update musician profile' });
  } finally {
    client.release();
  }
});

// Add an instrument
router.post('/musician/instruments', greywireOnly, authenticate, async (req, res) => {
  const fields = readInstrumentFields(req.body);
  if (fields.error) {
    return res.status(400).json({ message: fields.error });
  }
  const instrumentId = optionalInt(req.body.instrumentId, 1, 2147483647);
  if (!instrumentId) {
    return res.status(400).json({ message: 'Instrument is required' });
  }

  const client = await getClient();
  try {
    const instrument = await client.query('SELECT id FROM instruments WHERE id = $1', [instrumentId]);
    if (instrument.rowCount === 0) {
      return res.status(400).json({ message: 'Unknown instrument' });
    }

    const existing = await client.query(
      'SELECT id FROM user_instruments WHERE user_id = $1 AND instrument_id = $2',
      [req.user.id, instrumentId]
    );
    if (existing.rowCount > 0) {
      return res.status(400).json({ message: 'Instrument already added' });
    }

    // Only one main instrument
    if (fields.isPrimary) {
      await client.query('UPDATE user_instruments SET is_primary = 0 WHERE user_id = $1', [req.user.id]);
    }

    await client.query(
      `INSERT INTO user_instruments (user_id, instrument_id, skill_level, years_playing, is_primary)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, instrumentId, fields.skillLevel, fields.yearsPlaying, fields.isPrimary ? 1 : 0]
    );

    res.status(201).json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error adding instrument:', err);
    res.status(500).json({ message: 'Failed to add instrument' });
  } finally {
    client.release();
  }
});

// Update an instrument's details
router.put('/musician/instruments/:id', greywireOnly, authenticate, async (req, res) => {
  const fields = readInstrumentFields(req.body);
  if (fields.error) {
    return res.status(400).json({ message: fields.error });
  }

  const client = await getClient();
  try {
    const check = await client.query(
      'SELECT id FROM user_instruments WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Instrument not found' });
    }

    if (fields.isPrimary) {
      await client.query('UPDATE user_instruments SET is_primary = 0 WHERE user_id = $1', [req.user.id]);
    }

    await client.query(
      `UPDATE user_instruments SET skill_level = $1, years_playing = $2, is_primary = $3
       WHERE id = $4 AND user_id = $5`,
      [fields.skillLevel, fields.yearsPlaying, fields.isPrimary ? 1 : 0, req.params.id, req.user.id]
    );

    res.json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error updating instrument:', err);
    res.status(500).json({ message: 'Failed to update instrument' });
  } finally {
    client.release();
  }
});

// Remove an instrument
router.delete('/musician/instruments/:id', greywireOnly, authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM user_instruments WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Instrument not found' });
    }

    res.json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error removing instrument:', err);
    res.status(500).json({ message: 'Failed to remove instrument' });
  } finally {
    client.release();
  }
});

// Add a band
router.post('/musician/bands', greywireOnly, authenticate, async (req, res) => {
  const fields = readBandFields(req.body);
  if (fields.error) {
    return res.status(400).json({ message: fields.error });
  }

  const client = await getClient();
  try {
    await client.query(
      `INSERT INTO user_band_history (user_id, band_name, role, start_year, end_year, is_current)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, fields.bandName, fields.role, fields.startYear, fields.endYear, fields.isCurrent ? 1 : 0]
    );

    res.status(201).json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error adding band:', err);
    res.status(500).json({ message: 'Failed to add band' });
  } finally {
    client.release();
  }
});

// Update a band
router.put('/musician/bands/:id', greywireOnly, authenticate, async (req, res) => {
  const fields = readBandFields(req.body);
  if (fields.error) {
    return res.status(400).json({ message: fields.error });
  }

  const client = await getClient();
  try {
    // Verify ownership (an UPDATE that changes nothing reports 0 rows)
    const check = await client.query(
      'SELECT id FROM user_band_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Band not found' });
    }

    await client.query(
      `UPDATE user_band_history
       SET band_name = $1, role = $2, start_year = $3, end_year = $4, is_current = $5
       WHERE id = $6 AND user_id = $7`,
      [fields.bandName, fields.role, fields.startYear, fields.endYear, fields.isCurrent ? 1 : 0, req.params.id, req.user.id]
    );

    res.json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error updating band:', err);
    res.status(500).json({ message: 'Failed to update band' });
  } finally {
    client.release();
  }
});

// Remove a band
router.delete('/musician/bands/:id', greywireOnly, authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'DELETE FROM user_band_history WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Band not found' });
    }

    res.json({ musician: await getMusicianProfile(client, req.user.id) });
  } catch (err) {
    console.error('Error removing band:', err);
    res.status(500).json({ message: 'Failed to remove band' });
  } finally {
    client.release();
  }
});

// Submit account deletion request
router.post('/deletion-request', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    // Prevent duplicate pending requests
    const existing = await client.query(
      `SELECT id FROM account_deletion_requests WHERE user_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ message: 'A deletion request is already pending for this account.' });
    }

    await client.query(
      `INSERT INTO account_deletion_requests (user_id, username) VALUES ($1, $2)`,
      [req.user.id, req.user.handle]
    );

    res.status(200).json({ message: 'Deletion request submitted' });
  } catch (err) {
    console.error('Error submitting deletion request:', err);
    res.status(500).json({ message: 'Failed to submit deletion request' });
  } finally {
    client.release();
  }
});

module.exports = router;
