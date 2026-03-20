-- Migration: Breakroom grid layout system
-- Run this after 3-chat-rooms-ownership.sql

-- User breakroom layouts - stores each block's position, size, and content
CREATE TABLE breakroom_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  block_type VARCHAR(32) NOT NULL,    -- 'chat', 'updates', 'calendar', 'weather', 'news', 'blog'
  content_id INT NULL,                 -- e.g., chat_room id
  x INT NOT NULL DEFAULT 0,            -- grid column position
  y INT NOT NULL DEFAULT 0,            -- grid row position
  w INT NOT NULL DEFAULT 1,            -- width in grid units
  h INT NOT NULL DEFAULT 1,            -- height in grid units
  title VARCHAR(64) NULL,              -- optional custom title
  settings JSON NULL,                  -- type-specific settings
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_breakroom_blocks_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
