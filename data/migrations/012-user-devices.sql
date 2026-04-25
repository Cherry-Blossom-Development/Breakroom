-- Migration 012: User device tracking
-- Tracks devices registered by each user across all platforms.
-- device_token: UUID generated client-side (localStorage on web, Android ID on Android)
-- system_name:  auto-generated human-readable label, refreshed on every login
-- user_name:    optional custom label set by the user (e.g. "Studio Laptop")

CREATE TABLE IF NOT EXISTS user_devices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  device_token  VARCHAR(64) NOT NULL,
  system_name   VARCHAR(255) NOT NULL,
  user_name     VARCHAR(255) DEFAULT NULL,
  platform      VARCHAR(16) NOT NULL DEFAULT 'web',
  is_emulator   BOOLEAN NOT NULL DEFAULT FALSE,
  device_info   JSON,
  first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_device (user_id, device_token),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
