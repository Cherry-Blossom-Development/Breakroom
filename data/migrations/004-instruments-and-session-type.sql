-- Instruments lookup table
CREATE TABLE IF NOT EXISTS instruments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO instruments (name) VALUES
  ('Guitar'),
  ('Bass'),
  ('Drums'),
  ('Keyboards'),
  ('Vocals'),
  ('Saxophone'),
  ('Trumpet'),
  ('Violin'),
  ('Other');

-- Add session_type flag to sessions table (band = default, individual)
ALTER TABLE sessions
  ADD COLUMN session_type ENUM('band', 'individual') NOT NULL DEFAULT 'band',
  ADD COLUMN instrument_id INT NULL,
  ADD CONSTRAINT fk_sessions_instrument
    FOREIGN KEY (instrument_id) REFERENCES instruments(id) ON DELETE SET NULL;
