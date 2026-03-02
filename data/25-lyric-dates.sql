-- Add user-editable date fields to songs and lyrics tables

ALTER TABLE songs ADD COLUMN song_date DATE DEFAULT NULL AFTER visibility;
UPDATE songs SET song_date = DATE(created_at);

ALTER TABLE lyrics ADD COLUMN lyric_date DATE DEFAULT NULL AFTER status;
UPDATE lyrics SET lyric_date = DATE(created_at);
