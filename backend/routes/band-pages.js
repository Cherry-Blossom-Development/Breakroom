const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { getS3Url, streamFromS3 } = require('../utilities/aws-s3');

// GET /api/band-page/:bandUrl — public: full band page data
router.get('/:bandUrl', async (req, res) => {
  const client = await getClient();
  try {
    const page = await client.query(
      `SELECT bp.band_id, bp.story, bp.background_photo_key, bp.favicon_key,
              b.name AS band_name
       FROM band_pages bp
       JOIN bands b ON b.id = bp.band_id
       WHERE bp.band_url = $1 AND bp.is_published = 1`,
      [req.params.bandUrl]
    );
    if (page.rowCount === 0) return res.status(404).json({ message: 'Band page not found' });

    const { band_id, story, background_photo_key, favicon_key, band_name } = page.rows[0];

    // Active members with their instruments
    const members = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.photo_path,
              GROUP_CONCAT(i.name ORDER BY i.name SEPARATOR ', ') AS instruments
       FROM band_members bm
       JOIN users u ON u.id = bm.user_id
       LEFT JOIN band_member_instruments bmi ON bmi.band_id = bm.band_id AND bmi.user_id = bm.user_id
       LEFT JOIN instruments i ON i.id = bmi.instrument_id
       WHERE bm.band_id = $1 AND bm.status = 'active'
       GROUP BY u.id, u.handle, u.first_name, u.last_name, u.photo_path
       ORDER BY bm.role = 'owner' DESC, u.handle`,
      [band_id]
    );

    // Featured songs in display order
    const songs = await client.query(
      `SELECT s.id, s.name, s.mime_type, s.recorded_at,
              u.handle AS uploader_handle,
              i.name AS instrument_name
       FROM band_page_songs bps
       JOIN sessions s ON s.id = bps.session_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       WHERE bps.band_id = $1
       ORDER BY bps.display_order ASC`,
      [band_id]
    );

    res.json({
      band_name,
      story,
      background_photo_url: getS3Url(background_photo_key),
      favicon_url: getS3Url(favicon_key),
      members: members.rows.map(m => ({
        ...m,
        photo_url: m.photo_path ? `/api/uploads/${m.photo_path}` : null,
        instruments: m.instruments ? m.instruments.split(', ') : []
      })),
      songs: songs.rows
    });
  } catch (err) {
    console.error('Error fetching band page:', err);
    res.status(500).json({ message: 'Failed to load band page' });
  } finally {
    client.release();
  }
});

// GET /api/band-page/:bandUrl/songs/:sessionId/stream — public audio stream for band page songs
router.get('/:bandUrl/songs/:sessionId/stream', async (req, res) => {
  const client = await getClient();
  try {
    // Verify session is actually featured on this published band page
    const check = await client.query(
      `SELECT s.s3_key, s.mime_type
       FROM band_page_songs bps
       JOIN band_pages bp ON bp.band_id = bps.band_id
       JOIN sessions s ON s.id = bps.session_id
       WHERE bp.band_url = $1 AND bps.session_id = $2 AND bp.is_published = 1`,
      [req.params.bandUrl, req.params.sessionId]
    );
    if (check.rowCount === 0) return res.status(404).json({ message: 'Song not found' });

    await streamFromS3(check.rows[0].s3_key, req, res);
  } catch (err) {
    console.error('Error streaming band page song:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to stream audio' });
  } finally {
    client.release();
  }
});

module.exports = router;
