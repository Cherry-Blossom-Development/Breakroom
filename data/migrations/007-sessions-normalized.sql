-- Migration 007: Add normalized flag to sessions
-- Tracks whether a session has been processed through the server-side
-- FFmpeg normalization pipeline (EBU R128, 44100Hz WAV output).
-- Existing rows default to 0 (not normalized) since they were uploaded as-is.

ALTER TABLE sessions
  ADD COLUMN normalized TINYINT(1) NOT NULL DEFAULT 0;
