CREATE TABLE IF NOT EXISTS band_pages (
  band_id INT PRIMARY KEY,
  band_url VARCHAR(100) UNIQUE,
  story TEXT,
  background_photo_key VARCHAR(500),
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bp_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS band_member_instruments (
  band_id INT NOT NULL,
  user_id INT NOT NULL,
  instrument_id INT NOT NULL,
  PRIMARY KEY (band_id, user_id, instrument_id),
  CONSTRAINT fk_bmi_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
  CONSTRAINT fk_bmi_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bmi_instrument FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS band_page_songs (
  band_id INT NOT NULL,
  session_id INT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (band_id, session_id),
  CONSTRAINT fk_bps_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
  CONSTRAINT fk_bps_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
