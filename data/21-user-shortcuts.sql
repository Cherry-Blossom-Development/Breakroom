-- Migration: User shortcuts for quick navigation
-- Allows users to save custom links for faster access to app locations

CREATE TABLE user_shortcuts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(64) NOT NULL,              -- display name for the shortcut
  url VARCHAR(512) NOT NULL,              -- the URL/path to navigate to
  icon VARCHAR(32) NULL,                  -- optional icon identifier
  sort_order INT NOT NULL DEFAULT 0,      -- for custom ordering
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_shortcuts_user (user_id),
  INDEX idx_user_shortcuts_order (user_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
