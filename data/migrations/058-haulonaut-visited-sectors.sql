-- Migration 058: Per-character visited-sector tracking
--
-- haulonaut_visited_sectors: which sectors a given character has actually
-- been to (not just seen as a warp option from somewhere they've visited).
-- Many-to-many between game_users and haulonaut_sectors, so a character's
-- full visited set is just "every sector_id with a row for their
-- game_user_id" -- no per-sector or per-instance ceiling on how many rows
-- that can be. first/last_visited_at kept (cheap, and useful groundwork for
-- anything recency-based later) even though the initial use is just a
-- boolean "have I been here" check.

CREATE TABLE haulonaut_visited_sectors (
  game_user_id INT NOT NULL,
  sector_id INT NOT NULL,
  first_visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_user_id, sector_id),
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  INDEX idx_visited_sectors_sector (sector_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
