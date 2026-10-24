-- Migration 094: Musician profiles (Greywire site)
-- Greywire members can add a Musician Profile: a music bio, the instruments
-- they play and the bands they've been in. Instruments point at the shared
-- instruments list (004) so a later search such as "guitarists near me" can
-- match on instrument_id together with users.latitude/longitude. Bands are
-- free text because most past bands were never set up in Sessions.

-- One row per user who has saved a Musician Profile.
CREATE TABLE musician_profiles (
  user_id INT PRIMARY KEY,
  bio TEXT NULL,
  musician_only TINYINT(1) NOT NULL DEFAULT 0,  -- others see only the musician profile on Greywire
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Instruments a user plays.
CREATE TABLE user_instruments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  instrument_id INT NOT NULL,
  skill_level ENUM('beginner', 'intermediate', 'advanced', 'professional') NULL,
  years_playing SMALLINT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_instruments (user_id, instrument_id),
  INDEX idx_user_instruments_instrument (instrument_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Bands a user has been in, past and present.
CREATE TABLE user_band_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  band_name VARCHAR(100) NOT NULL,
  role VARCHAR(100) NULL,               -- e.g. "Lead guitar, backing vocals"
  start_year SMALLINT NULL,
  end_year SMALLINT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_band_history_user (user_id),
  INDEX idx_user_band_history_name (band_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- More instruments to pick from. These also appear in the Sessions dropdowns.
-- The first nine are 004's list again, for databases built from schema only.
INSERT IGNORE INTO instruments (name) VALUES
  ('Guitar'),
  ('Bass'),
  ('Drums'),
  ('Keyboards'),
  ('Vocals'),
  ('Saxophone'),
  ('Trumpet'),
  ('Violin'),
  ('Other'),
  ('Acoustic Guitar'),
  ('Banjo'),
  ('Cello'),
  ('Clarinet'),
  ('DJ / Turntables'),
  ('Double Bass'),
  ('Flute'),
  ('Harmonica'),
  ('Lap Steel'),
  ('Mandolin'),
  ('Organ'),
  ('Pedal Steel'),
  ('Percussion'),
  ('Piano'),
  ('Synthesizer'),
  ('Trombone'),
  ('Ukulele'),
  ('Viola');
