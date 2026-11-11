const { spawn } = require('child_process');
const fs = require('fs');

// Allow 1 minute of ffmpeg time per 20 MB of input, at least 10 minutes
// (a 2-hour, 1.2 GB recording gets about an hour).
function timeoutForSize(bytes) {
  return Math.max(10 * 60 * 1000, Math.ceil(bytes / (20 * 1024 * 1024)) * 60 * 1000);
}

// AAC bitrate for the playback copy: 128 kbps per channel (256k stereo),
// near-transparent for practice recordings.
const aacBitrate = channels => `${128 * Math.max(1, Math.min(channels, 2))}k`;

/**
 * Turn an uploaded recording into the two files a session stores:
 *   - a lossless FLAC master (kept for mashups / downloads)
 *   - an AAC .m4a copy for playback (about 5x smaller than WAV)
 * Both are loudness-normalized with two-pass EBU R128 loudnorm
 * (-14 LUFS integrated, -1 dBTP true peak, LRA 11), 44100 Hz, original
 * channel count (max 2). The master is 16-bit, matching the WAVs stored before.
 *
 * Disk to disk, so large uploads are never held in memory.
 *
 * @param {string} inputPath - Audio file on disk (any format FFmpeg supports)
 * @param {string} masterPath - Where to write the FLAC master
 * @param {string} playbackPath - Where to write the AAC .m4a
 * @returns {Promise<{durationMs: number|null}>}
 */
async function processSessionAudio(inputPath, masterPath, playbackPath) {
  const { size } = await fs.promises.stat(inputPath);
  const timeoutMs = timeoutForSize(size);
  const { channels, stats, durationMs } = await runFfmpegPass1(inputPath, timeoutMs);

  // If input was silent (-inf), skip loudness adjustment so FFmpeg doesn't error.
  const isSilent = stats.input_i === '-inf' || parseFloat(stats.input_i) < -70;
  const loudnorm = isSilent ? 'anull' : [
    'loudnorm=I=-14:TP=-1:LRA=11',
    `measured_I=${stats.input_i}`,
    `measured_TP=${stats.input_tp}`,
    `measured_LRA=${stats.input_lra}`,
    `measured_thresh=${stats.input_thresh}`,
    `offset=${stats.target_offset}`,
    'linear=true',
    'print_format=summary'
  ].join(':');

  // One decode + normalization, split into both encodes.
  await runFfmpeg([
    '-y', '-nostats',
    '-i', inputPath,
    '-filter_complex', `[0:a]${loudnorm},aresample=44100,asplit=2[master][play]`,
    '-map', '[master]', '-ac', String(channels), '-sample_fmt', 's16', '-c:a', 'flac', '-f', 'flac', masterPath,
    '-map', '[play]', '-ac', String(channels), '-c:a', 'aac', '-b:a', aacBitrate(channels),
    '-movflags', '+faststart', '-f', 'mp4', playbackPath
  ], timeoutMs, 'encode');

  return { durationMs };
}

/**
 * Re-encode an already-normalized session file (e.g. an older stored WAV)
 * into a FLAC master and AAC playback copy, without changing loudness.
 */
async function transcodeSessionAudio(inputPath, masterPath, playbackPath, channels) {
  const { size } = await fs.promises.stat(inputPath);
  await runFfmpeg([
    '-y', '-nostats',
    '-i', inputPath,
    '-map', '0:a', '-sample_fmt', 's16', '-c:a', 'flac', '-f', 'flac', masterPath,
    '-map', '0:a', '-c:a', 'aac', '-b:a', aacBitrate(channels), '-movflags', '+faststart', '-f', 'mp4', playbackPath
  ], timeoutForSize(size), 'transcode');
}

/** Decode any audio file (e.g. a FLAC master) to a 16-bit WAV file. */
async function decodeToWav(inputPath, outputPath) {
  const { size } = await fs.promises.stat(inputPath);
  await runFfmpeg([
    '-y', '-nostats',
    '-i', inputPath,
    '-map', '0:a', '-c:a', 'pcm_s16le', '-f', 'wav', outputPath
  ], timeoutForSize(size * 3), 'decode');
}

/** Channel count of a file's first audio stream (for transcoding stored WAVs). */
function probeChannels(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', inputPath]);
    let out = '';
    proc.stdout.on('data', c => { out += c; });
    proc.on('close', code => code === 0 ? resolve(parseInt(out, 10) || 1) : reject(new Error('ffprobe failed')));
    proc.on('error', reject);
  });
}

function runFfmpeg(args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderrTail = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error(`FFmpeg ${label} timed out`));
    }, timeoutMs);

    proc.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000); });

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) return reject(new Error(`FFmpeg ${label} failed (code ${code}): ${stderrTail.slice(-500)}`));
      resolve();
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg ${label} spawn error: ${err.message}`));
    });
  });
}

function runFfmpegPass1(inputPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-nostats',
      '-i', inputPath,
      '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
      '-f', 'null',
      '/dev/null'
    ];

    const proc = spawn('ffmpeg', args);
    const stderrChunks = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error('FFmpeg pass 1 timed out'));
    }, timeoutMs);

    proc.stderr.on('data', chunk => stderrChunks.push(chunk));

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;

      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        return reject(new Error(`FFmpeg pass 1 failed (code ${code}): ${stderr.slice(-500)}`));
      }

      // Parse channel count from stream info line, e.g. "Audio: pcm_s16le, 48000 Hz, 1 channels".
      // NOTE: ffmpeg prints "mono"/"stereo" rather than "N channels" for common
      // layouts, so in practice this almost always falls back to 1 (mono). That
      // is long-standing behavior the mobile mashup code may rely on; change deliberately.
      const channelMatch = stderr.match(/Audio:.*?(\d+)\s+channel/);
      const channels = channelMatch ? Math.min(parseInt(channelMatch[1], 10), 2) : 1;

      // Parse duration from FFmpeg output, e.g. "Duration: 00:03:45.12" or "Duration: 01:23:45.67"
      let durationMs = null;
      const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseInt(durationMatch[3], 10);
        // Handle fractional seconds (could be 1-3 digits)
        const fracStr = durationMatch[4].padEnd(3, '0').slice(0, 3);
        const milliseconds = parseInt(fracStr, 10);
        durationMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
      }

      // Parse loudnorm JSON from end of stderr
      const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
      if (!jsonMatch) {
        return reject(new Error('FFmpeg pass 1: loudnorm JSON not found in output'));
      }

      let stats;
      try {
        stats = JSON.parse(jsonMatch[0]);
      } catch (e) {
        return reject(new Error('FFmpeg pass 1: failed to parse loudnorm JSON'));
      }

      resolve({ channels, stats, durationMs });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg pass 1 spawn error: ${err.message}`));
    });
  });
}

module.exports = { processSessionAudio, transcodeSessionAudio, decodeToWav, probeChannels };
