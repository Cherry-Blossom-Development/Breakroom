-- Migration 096: Lossless master + compressed playback copy for sessions
-- New uploads store two files in S3:
--   s3_key        -> AAC 256 kbps .m4a used for all playback (mime_type audio/mp4)
--   master_s3_key -> lossless FLAC master, served decoded as WAV by
--                    GET /api/sessions/:id/master.wav (mashups)
-- Older sessions have master_s3_key NULL and s3_key pointing at a normalized
-- WAV until they are converted.

ALTER TABLE sessions
  ADD COLUMN master_s3_key VARCHAR(500) NULL AFTER s3_key,
  ADD COLUMN master_file_size BIGINT NULL AFTER file_size;
