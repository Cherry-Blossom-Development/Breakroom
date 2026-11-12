// Shared helpers for creating `sessions` rows. Used by the single-request
// upload (POST /api/sessions, still used by mobile apps and in-browser
// recordings) and by the resumable tus upload (utilities/sessionUploads.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getClient } = require('./db');
const { processSessionAudio } = require('./audio');
const { uploadFileToS3, deleteFromS3 } = require('./aws-s3');
const { isSubscribed } = require('./subscription');
const { isMember } = require('./greywire');

const FREE_LIMITS = { band: 3, individual: 3 };

// Earliest recording date we accept. Catches a year typed as "26" (stored as
// 0026, shown as 1926) while still allowing old recordings to be uploaded.
const MIN_RECORDED_YEAR = 1950;

/**
 * Check a recorded_at value from a client ("YYYY-MM-DD", optionally followed by
 * a time). Empty means "no date". Rejects impossible dates, years before
 * MIN_RECORDED_YEAR, and dates in the future (one day of slack for time zones).
 * @returns {{ value: string|null } | { error: string }}
 */
function validateRecordedAt(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  // setUTCFullYear, not Date.UTC: Date.UTC turns years 0-99 into 1900-1999
  const date = m && new Date(new Date(0).setUTCFullYear(+m[1], +m[2] - 1, +m[3]));
  if (!m || date.getUTCFullYear() !== +m[1] || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3]) {
    return { error: 'The recording date is not a valid date.' };
  }
  const value = `${m[1]}-${m[2]}-${m[3]}`;
  if (+m[1] < MIN_RECORDED_YEAR) {
    return { error: `The recording date (${value}) is before ${MIN_RECORDED_YEAR}. Please check the year.` };
  }
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return { error: `The recording date (${value}) is in the future. Please check the date.` };
  }
  return { value };
}

function normalizeSessionType(sessionType) {
  return sessionType === 'individual' ? 'individual' : sessionType === 'mashup' ? 'mashup' : 'band';
}

/**
 * Enforce free-tier limits: 3 band sessions, 3 individual sessions (per site).
 * Greywire members have no limits on the Greywire site.
 * @returns {Promise<null | {status: number, message: string, requiresSubscription: true}>}
 *   null when the upload is allowed, otherwise the error to return.
 */
async function checkFreeTierLimit(userId, sessionType, site) {
  const client = await getClient();
  try {
    const countResult = await client.query(
      'SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = $1 AND session_type = $2 AND site = $3',
      [userId, sessionType, site]
    );
    const count = parseInt(countResult.rows[0].cnt, 10);
    if (count >= FREE_LIMITS[sessionType] && !(site === 'greywire' && await isMember(client, userId))) {
      const { subscribed } = await isSubscribed(userId);
      if (!subscribed) {
        return {
          status: 402,
          message: `Free accounts are limited to ${FREE_LIMITS[sessionType]} ${sessionType} sessions`,
          requiresSubscription: true,
        };
      }
    }
    return null;
  } finally {
    client.release();
  }
}

/**
 * Normalize an uploaded recording, encode the FLAC master + AAC playback copy,
 * and put both in S3. Work files go in workDir and are always removed.
 * On failure nothing is left in S3.
 *
 * @returns {Promise<{s3Key, fileSize, masterS3Key, masterFileSize, durationMs}>}
 */
async function storeSessionAudio(inputPath, userId, workDir) {
  const base = path.join(workDir, `session-${crypto.randomUUID()}`);
  const masterPath = `${base}.flac`;
  const playbackPath = `${base}.m4a`;
  const stamp = Date.now();
  const s3Key = `sessions/${userId}/${stamp}.m4a`;
  const masterS3Key = `sessions/${userId}/${stamp}.master.flac`;
  const uploaded = [];
  try {
    const { durationMs } = await processSessionAudio(inputPath, masterPath, playbackPath);

    const master = await uploadFileToS3(masterPath, masterS3Key, 'audio/flac');
    if (!master.success) throw new Error('Failed to upload to storage: ' + master.error);
    uploaded.push(masterS3Key);

    const playback = await uploadFileToS3(playbackPath, s3Key, 'audio/mp4');
    if (!playback.success) throw new Error('Failed to upload to storage: ' + playback.error);
    uploaded.push(s3Key);

    return { s3Key, fileSize: playback.size, masterS3Key, masterFileSize: master.size, durationMs };
  } catch (err) {
    for (const key of uploaded) await deleteFromS3(key);
    throw err;
  } finally {
    await fs.promises.unlink(masterPath).catch(() => {});
    await fs.promises.unlink(playbackPath).catch(() => {});
  }
}

/**
 * Insert a sessions row for audio already stored in S3 and return it in the
 * shape the clients expect.
 */
async function insertSession({ userId, name, s3Key, fileSize, masterS3Key = null, masterFileSize = null, mimeType = 'audio/mp4', recordedAt, bandId, sessionType, instrumentId, durationMs, site }) {
  const client = await getClient();
  try {
    const insertResult = await client.query(
      'INSERT INTO sessions (user_id, name, s3_key, master_s3_key, file_size, master_file_size, mime_type, recorded_at, band_id, session_type, instrument_id, normalized, duration_ms, site) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)',
      [userId, name || 'Untitled Session', s3Key, masterS3Key, fileSize, masterFileSize, mimeType, recordedAt || null, bandId, sessionType, instrumentId, 1, durationMs, site]
    );
    const session = await client.query(
      `SELECT s.id, s.name, s.s3_key, s.file_size, s.mime_type, s.uploaded_at, s.recorded_at, s.session_type,
         s.band_id, b.name AS band_name, s.instrument_id, i.name AS instrument_name,
         s.duration_ms,
         NULL AS avg_rating, 0 AS rating_count, NULL AS my_rating
       FROM sessions s
       LEFT JOIN bands b ON b.id = s.band_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       WHERE s.id = $1`,
      [insertResult.insertId]
    );
    return session.rows[0];
  } finally {
    client.release();
  }
}

module.exports = { FREE_LIMITS, MIN_RECORDED_YEAR, normalizeSessionType, validateRecordedAt, checkFreeTierLimit, storeSessionAudio, insertSession };
