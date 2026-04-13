-- Migration 009: Notification badge infrastructure
-- Adds per-user notification preferences, chat read tracking,
-- friend request seen tracking, and blog post read tracking.

-- ── User notification settings ──────────────────────────────────────────────
-- One row per user (created on first save; absence = all defaults ON).
CREATE TABLE IF NOT EXISTS user_settings (
  user_id                  INT NOT NULL,
  notifications_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_chat_messages     BOOLEAN NOT NULL DEFAULT TRUE,
  notify_friend_requests   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_blog_comments     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Chat unread tracking ─────────────────────────────────────────────────────
-- last_read_at: timestamp of last time the user "visited" a room.
--   NULL = never read; unread count = messages after this timestamp.
-- notifications_muted: user has silenced badge/flash for this room.
ALTER TABLE users_rooms
  ADD COLUMN IF NOT EXISTS last_read_at        TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Friend request seen tracking ─────────────────────────────────────────────
-- seen_by_recipient: FALSE until the recipient visits the Friends page.
-- Badge count = pending rows where seen_by_recipient = FALSE.
ALTER TABLE friends
  ADD COLUMN IF NOT EXISTS seen_by_recipient BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Blog comment read tracking ───────────────────────────────────────────────
-- One row per (user, post) updated when the post owner visits their post.
-- Blog badge count = author's posts with comments newer than last_read_at.
CREATE TABLE IF NOT EXISTS user_post_last_read (
  user_id     INT NOT NULL,
  post_id     INT NOT NULL,
  last_read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
