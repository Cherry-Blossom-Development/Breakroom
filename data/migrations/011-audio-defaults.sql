-- Migration 011: Audio defaults
-- Per-user audio preferences that persist across sessions and platforms.
-- Absence of a row means all app defaults apply. Row is created on first save.

CREATE TABLE IF NOT EXISTS audio_defaults (
  user_id           INT NOT NULL,
  echo_cancellation BOOLEAN NOT NULL DEFAULT FALSE,
  noise_suppression BOOLEAN NOT NULL DEFAULT FALSE,
  auto_gain_control BOOLEAN NOT NULL DEFAULT FALSE,
  playback_volume   DECIMAL(3,2) NOT NULL DEFAULT 0.75,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default row for dallas
INSERT INTO audio_defaults (user_id, echo_cancellation, noise_suppression, auto_gain_control, playback_volume)
SELECT id, FALSE, FALSE, FALSE, 0.75 FROM users WHERE handle = 'dallas'
ON DUPLICATE KEY UPDATE user_id = user_id;
