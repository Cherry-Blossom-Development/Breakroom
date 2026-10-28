-- Migration: Add duration_ms column to sessions table
-- This column stores the duration of audio sessions in milliseconds

ALTER TABLE sessions ADD COLUMN duration_ms INT NULL AFTER normalized;
