-- Migration 038: Basic analytics tracking
-- Tracks site visits (anonymous + registered), login events, and adds a
-- signup_platform column to users. Also adds is_internal to flag staff/test
-- accounts out of all analytics counts.

ALTER TABLE users ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN signup_platform ENUM('web','android','ios') NOT NULL DEFAULT 'web';

CREATE TABLE analytics_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  visitor_id VARCHAR(64) NOT NULL,
  user_id INT NULL,
  platform ENUM('web','android','ios') NOT NULL DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_visits_created (created_at),
  INDEX idx_visits_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE analytics_logins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  platform ENUM('web','android','ios') NOT NULL DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_logins_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
