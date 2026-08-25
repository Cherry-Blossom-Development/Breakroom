-- Migration 056: Haulonaut pilot location
--
-- haulonaut_pilots: a 1:1 extension of game_users holding where a character
-- currently is. Kept as its own Haulonaut-prefixed table rather than a
-- column on game_users (which stays generic -- other future games shouldn't
-- carry a "current sector" concept that only makes sense for this one), and
-- rather than a game_settings key/value row -- a real FK gives referential
-- integrity and makes "who's in sector X" / "where is character Y" cheap
-- joins instead of key/value lookups.
--
-- current_sector_id cascades on delete like the rest of the Haulonaut
-- tables: if a universe is ever hard-deleted (not just ended -- normal play
-- only ever sets status='ended'), its sectors go and so do any pilot rows
-- pointing at them, rather than leaving a dangling/RESTRICTed reference.

CREATE TABLE haulonaut_pilots (
  game_user_id INT PRIMARY KEY,
  current_sector_id INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (current_sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  INDEX idx_haulonaut_pilots_sector (current_sector_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
