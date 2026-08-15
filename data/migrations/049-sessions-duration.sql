-- Add duration_ms column to sessions table to store audio duration in milliseconds
-- This will be populated during upload by extracting duration from audio files

ALTER TABLE sessions ADD COLUMN duration_ms INT UNSIGNED DEFAULT NULL;

-- Create an index for efficient sorting/filtering by duration
CREATE INDEX idx_sessions_duration ON sessions(duration_ms);
