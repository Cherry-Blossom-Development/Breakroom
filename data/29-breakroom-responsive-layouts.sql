-- Migration: Per-breakpoint widget layout positions
-- Run this after 28-*.sql

CREATE TABLE breakroom_block_positions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  block_id   INT NOT NULL,
  col_count  TINYINT NOT NULL,  -- 1, 2, 3, 4, or 5
  x          INT NOT NULL DEFAULT 0,
  y          INT NOT NULL DEFAULT 0,
  w          INT NOT NULL,
  h          INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (block_id) REFERENCES breakroom_blocks(id) ON DELETE CASCADE,
  UNIQUE KEY uq_block_col (block_id, col_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
