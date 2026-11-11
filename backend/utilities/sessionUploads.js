// Resumable session uploads (tus protocol, https://tus.io) for large
// recordings — up to 1.2 GB, about 2 hours of CD-quality WAV.
//
// The browser (tus-js-client) sends the file in small pieces to
// /api/sessions/uploads and can resume after a dropped connection. Pieces are
// written to disk (SESSION_UPLOAD_DIR), never held in memory. When the last
// piece arrives the upload is queued for background processing — ffmpeg
// normalization, S3 upload, sessions row — and the client polls
// GET /api/sessions/processing to learn when it's ready.
//
// Completed uploads stay on disk until processed, so if the backend restarts
// mid-processing they are picked up again on startup.

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getClient } = require('./db');
const { extractToken } = require('./auth');
const { normalizeFileToWav } = require('./audio');
const { uploadFileToS3, deleteFromS3 } = require('./aws-s3');
const { normalizeSessionType, checkFreeTierLimit, insertSession } = require('./sessionRecords');

const UPLOAD_PATH = '/api/sessions/uploads';
const MAX_SESSION_UPLOAD_BYTES = Math.round(1.2 * 1024 ** 3); // 1.2 GB
const UPLOAD_DIR = process.env.SESSION_UPLOAD_DIR || path.join(__dirname, '..', 'session-uploads');
const PARTIAL_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000; // abandoned partial uploads are deleted after a day
const FINISHED_JOB_TTL_MS = 60 * 60 * 1000;        // finished jobs are reported for an hour
const ALLOWED_EXTS = /\.(mp3|wav|aac|ogg|flac|m4a|webm|opus)$/i;

let tusServer = null;
let datastore = null;
let readyPromise = null;

// uploadId -> { uploadId, userId, name, sessionType, status: 'queued'|'processing'|'ready'|'failed', error?, session?, finishedAt? }
const jobs = new Map();
let queue = Promise.resolve(); // process one upload at a time to keep CPU/disk use bounded

function tusError(status_code, message, extra = {}) {
  return { status_code, body: JSON.stringify({ message, ...extra }) };
}

function nodeRequest(req) {
  return req.runtime?.node?.req || req.node?.req;
}

function enqueue(upload) {
  const meta = upload.metadata || {};
  const job = {
    uploadId: upload.id,
    userId: parseInt(meta.user_id, 10),
    name: meta.name || 'Untitled Session',
    sessionType: normalizeSessionType(meta.session_type),
    status: 'queued',
  };
  jobs.set(upload.id, job);
  queue = queue.then(() => processUpload(upload, job)).catch(err => {
    console.error('Session upload queue error:', err);
  });
}

async function processUpload(upload, job) {
  const meta = upload.metadata || {};
  const inputPath = path.join(UPLOAD_DIR, upload.id);
  const outputPath = path.join(UPLOAD_DIR, `${upload.id}.normalized.wav`);
  let s3Key = null;
  job.status = 'processing';
  const started = Date.now();
  try {
    const { durationMs } = await normalizeFileToWav(inputPath, outputPath);

    s3Key = `sessions/${job.userId}/${Date.now()}.wav`;
    const s3Result = await uploadFileToS3(outputPath, s3Key, 'audio/wav');
    if (!s3Result.success) {
      s3Key = null;
      throw new Error('Failed to upload to storage: ' + s3Result.error);
    }

    const session = await insertSession({
      userId: job.userId,
      name: job.name,
      s3Key,
      fileSize: s3Result.size,
      recordedAt: meta.recorded_at || null,
      bandId: meta.band_id ? parseInt(meta.band_id, 10) : null,
      sessionType: job.sessionType,
      instrumentId: meta.instrument_id ? parseInt(meta.instrument_id, 10) : null,
      durationMs,
      site: meta.site,
    });
    job.status = 'ready';
    job.session = session;
    console.log(`Session upload ${upload.id} processed in ${Math.round((Date.now() - started) / 1000)}s -> session ${session.id}`);
  } catch (err) {
    console.error(`Session upload ${upload.id} failed:`, err);
    if (s3Key) await deleteFromS3(s3Key);
    job.status = 'failed';
    job.error = err.message && err.message.startsWith('FFmpeg')
      ? 'This file could not be read as audio.'
      : 'Processing failed. Please try uploading again.';
  } finally {
    job.finishedAt = Date.now();
    await fs.promises.unlink(outputPath).catch(() => {});
    await datastore.remove(upload.id).catch(() => {});
  }
}

// Requeue uploads that finished arriving but were never processed (backend
// restarted mid-processing, e.g. during a deploy).
async function recoverUnprocessedUploads() {
  const ids = await datastore.configstore.list();
  for (const id of ids) {
    try {
      const upload = await datastore.getUpload(id);
      if (upload.size !== undefined && upload.offset === upload.size && upload.metadata?.user_id) {
        console.log(`Requeueing unprocessed session upload ${id}`);
        enqueue(upload);
      }
    } catch (err) {
      console.error(`Could not inspect session upload ${id}:`, err.message || err);
    }
  }
}

async function cleanUp() {
  try {
    const removed = await tusServer.cleanUpExpiredUploads();
    if (removed) console.log(`Removed ${removed} abandoned session upload(s)`);
  } catch (err) {
    console.error('Session upload cleanup failed:', err.message || err);
  }
  const cutoff = Date.now() - FINISHED_JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

async function init() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const { Server } = await import('@tus/server');
    const { FileStore } = await import('@tus/file-store');

    datastore = new FileStore({ directory: UPLOAD_DIR, expirationPeriodInMilliseconds: PARTIAL_UPLOAD_TTL_MS });

    tusServer = new Server({
      path: UPLOAD_PATH,
      datastore,
      maxSize: MAX_SESSION_UPLOAD_BYTES,
      relativeLocation: true,

      // Every request is already authenticated by authenticateUpload below.
      // Make sure people can only touch their own uploads.
      async onIncomingRequest(req, uploadId) {
        if (req.method === 'POST') return;
        const user = nodeRequest(req)?.user;
        const upload = await datastore.getUpload(uploadId);
        if (!user || upload.metadata?.user_id !== String(user.id)) {
          throw tusError(404, 'Upload not found');
        }
      },

      async onUploadCreate(req, upload) {
        const nodeReq = nodeRequest(req);
        const meta = upload.metadata || {};
        if (!upload.size) throw tusError(400, 'Upload size is required');

        const isAudio = /^audio\//.test(meta.filetype || '') || ALLOWED_EXTS.test(meta.filename || '');
        if (!isAudio) throw tusError(400, 'Only audio files are allowed');

        const sessionType = normalizeSessionType(meta.session_type);
        const limitError = await checkFreeTierLimit(nodeReq.user.id, sessionType, nodeReq.site);
        if (limitError) {
          throw tusError(limitError.status, limitError.message, { requiresSubscription: true });
        }

        return {
          metadata: {
            ...meta,
            name: (meta.name || '').trim().slice(0, 255) || 'Untitled Session',
            session_type: sessionType,
            user_id: String(nodeReq.user.id),
            site: nodeReq.site,
          },
        };
      },

      async onUploadFinish(req, upload) {
        enqueue(upload);
        return {};
      },
    });

    await recoverUnprocessedUploads();
    setInterval(cleanUp, 60 * 60 * 1000).unref();
    console.log(`Session uploads ready (dir: ${UPLOAD_DIR})`);
  })();
  return readyPromise;
}

// Express middleware: authenticate the same way routes/sessions.js does.
async function authenticateUpload(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.SECRET_KEY);
    const client = await getClient();
    try {
      const user = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
      if (user.rowCount === 0) return res.status(401).json({ message: 'User not found' });
      req.user = { id: user.rows[0].id, handle: user.rows[0].handle };
    } finally {
      client.release();
    }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

async function handleUpload(req, res) {
  // tus can serve finished files back over GET; we never need that.
  if (req.method === 'GET') return res.status(404).json({ message: 'Not found' });
  try {
    await init();
    await tusServer.handle(req, res);
  } catch (err) {
    console.error('Session upload handler error:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Upload failed' });
  }
}

// Express route: GET /api/sessions/processing — the current user's uploads
// that are being processed, or finished within the last hour.
function listProcessing(userId) {
  return [...jobs.values()]
    .filter(job => job.userId === userId)
    .map(({ uploadId, name, sessionType, status, error, session }) => ({ uploadId, name, sessionType, status, error, session }));
}

function dismissProcessing(userId, uploadId) {
  const job = jobs.get(uploadId);
  if (!job || job.userId !== userId || !job.finishedAt) return false;
  jobs.delete(uploadId);
  return true;
}

module.exports = {
  UPLOAD_PATH,
  MAX_SESSION_UPLOAD_BYTES,
  init,
  authenticateUpload,
  handleUpload,
  listProcessing,
  dismissProcessing,
};
