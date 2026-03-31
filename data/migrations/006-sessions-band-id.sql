ALTER TABLE sessions
  ADD COLUMN band_id INT NULL,
  ADD CONSTRAINT fk_sessions_band
    FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE SET NULL;
