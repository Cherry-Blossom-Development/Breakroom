const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

const FFMPEG_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Converts any audio buffer to a normalized WAV file using two-pass EBU R128 loudnorm.
 * Output spec: 44100 Hz, 16-bit PCM, original channel count (max 2).
 * Target: -14 LUFS integrated, -1 dBTP true peak, LRA=11.
 *
 * @param {Buffer} inputBuffer - Raw audio file bytes (any format FFmpeg supports)
 * @returns {Promise<{buffer: Buffer, durationMs: number|null}>} - Normalized WAV file and duration in ms
 */
async function normalizeToWav(inputBuffer) {
  const tmpPath = `/tmp/br-${crypto.randomUUID()}.audio`;

  try {
    await fs.promises.writeFile(tmpPath, inputBuffer);

    // Pass 1: analyze loudness, detect channel count, and extract duration
    const pass1Result = await runFfmpegPass1(tmpPath);
    const channels = pass1Result.channels;
    const loudnormStats = pass1Result.stats;
    const durationMs = pass1Result.durationMs;

    // Pass 2: apply normalization and convert to WAV, stream to stdout
    const wavBuffer = await runFfmpegPass2(tmpPath, loudnormStats, channels);
    return { buffer: wavBuffer, durationMs };

  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

function runFfmpegPass1(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
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
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on('data', chunk => stderrChunks.push(chunk));

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;

      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        return reject(new Error(`FFmpeg pass 1 failed (code ${code}): ${stderr.slice(-500)}`));
      }

      // Parse channel count from stream info line, e.g. "Audio: pcm_s16le, 48000 Hz, 1 channels"
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

function runFfmpegPass2(inputPath, stats, channels) {
  return new Promise((resolve, reject) => {
    // Build loudnorm filter with measured values from pass 1.
    // If input was silent (-inf), fall back to linear=false so FFmpeg doesn't error.
    const isSilent = stats.input_i === '-inf' || parseFloat(stats.input_i) < -70;

    let audioFilter;
    if (isSilent) {
      // Just resample/convert without loudness adjustment
      audioFilter = 'anull';
    } else {
      audioFilter = [
        `loudnorm=I=-14:TP=-1:LRA=11`,
        `measured_I=${stats.input_i}`,
        `measured_TP=${stats.input_tp}`,
        `measured_LRA=${stats.input_lra}`,
        `measured_thresh=${stats.input_thresh}`,
        `offset=${stats.target_offset}`,
        `linear=true`,
        `print_format=summary`
      ].join(':');
    }

    const args = [
      '-y',
      '-i', inputPath,
      '-af', audioFilter,
      '-ar', '44100',
      '-ac', String(channels),
      '-sample_fmt', 's16',
      '-f', 'wav',
      'pipe:1'
    ];

    const proc = spawn('ffmpeg', args);
    const stdoutChunks = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error('FFmpeg pass 2 timed out'));
    }, FFMPEG_TIMEOUT_MS);

    proc.stdout.on('data', chunk => stdoutChunks.push(chunk));
    proc.stderr.on('data', () => {}); // suppress pass 2 stderr

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;

      if (code !== 0) {
        return reject(new Error(`FFmpeg pass 2 failed (code ${code})`));
      }

      const wavBuffer = Buffer.concat(stdoutChunks);
      if (wavBuffer.length < 44) {
        return reject(new Error('FFmpeg pass 2: output too small to be a valid WAV'));
      }

      resolve(wavBuffer);
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg pass 2 spawn error: ${err.message}`));
    });
  });
}

module.exports = { normalizeToWav };
