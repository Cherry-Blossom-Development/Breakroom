-- Content Moderation Schema
-- Date: 2026-03-15

-- =====================================
-- Schema changes to existing tables
-- =====================================

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;

ALTER TABLE blog_comments
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;

ALTER TABLE gallery_artworks
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;

ALTER TABLE lyrics
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_flag_banned BOOLEAN DEFAULT FALSE;

-- =====================================
-- New tables
-- =====================================

CREATE TABLE IF NOT EXISTS content_flags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  content_type VARCHAR(50) NOT NULL,
  content_id INT NULL,
  content_author_id INT NULL,
  flagged_by_user_id INT NULL,
  reason TEXT NULL,
  status ENUM('pending', 'approved', 'restored') DEFAULT 'pending',
  reviewed_by_user_id INT NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flagged_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (content_author_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_flags_content (content_type, content_id),
  INDEX idx_flags_status (status),
  INDEX idx_flags_author (content_author_id),
  INDEX idx_flags_flagged_by (flagged_by_user_id),
  INDEX idx_flags_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  blocker_user_id INT NOT NULL,
  blocked_user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE INDEX idx_blocks_unique (blocker_user_id, blocked_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_filter_keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  keyword VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX idx_keywords_keyword (keyword)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================
-- Notification seed data for content reports
-- =====================================

INSERT IGNORE INTO event_types (type, description)
  VALUES ('content_reported', 'A user has flagged or blocked content');

INSERT INTO notification_types (name, description, display_type, event_id, repeat_rule, is_active)
SELECT
  'Content Report',
  'A content report has been submitted. Review it in the moderation panel at /admin/moderation.',
  'popup',
  id,
  'forever',
  TRUE
FROM event_types WHERE type = 'content_reported';

INSERT INTO notification_type_groups (notification_type_id, group_id)
SELECT nt.id, g.id
FROM notification_types nt
JOIN event_types et ON nt.event_id = et.id
JOIN `groups` g ON g.name = 'Administrator'
WHERE et.type = 'content_reported';
