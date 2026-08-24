-- Migration 054: Haulonaut -- first real game, plus the "game instance"
-- concept every persistent-world game will need.
--
-- game_instances: a single run of a game's universe/world/season -- "we will
-- start and stop many such games" means each start is a new row here, not a
-- reset of existing data. For Haulonaut, one instance = one generated
-- 1000-sector universe. Other future games may never need more than one
-- instance, but the concept belongs on `games` in general, not baked into
-- Haulonaut's own tables.
--
-- game_users / game_settings (migration 053) are recreated here scoped to
-- game_instance_id instead of game_id -- a character belongs to a specific
-- universe run, not the game in the abstract, so when a new Haulonaut
-- universe starts, old characters don't carry over into it. Both tables are
-- still empty (no game has shipped yet), so this is a clean recreate rather
-- than an ALTER.
--
-- haulonaut_sectors / haulonaut_sector_links: the universe graph. Sectors
-- are numbered 1..N within an instance; links are stored as directed pairs
-- (from_sector_id -> to_sector_id) with both directions inserted for every
-- connection the generator makes, so "what can I warp to from here" is a
-- single indexed lookup rather than a two-sided OR query. Nothing about
-- ports, planets, or trading yet -- just the map.

DROP TABLE IF EXISTS game_settings;
DROP TABLE IF EXISTS game_users;

CREATE TABLE game_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id INT NOT NULL,
  name VARCHAR(128) NOT NULL,
  status ENUM('setup', 'active', 'ended') NOT NULL DEFAULT 'setup',
  started_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  INDEX idx_game_instances_game (game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_instance_id INT NOT NULL,
  user_id INT NULL,
  visitor_id VARCHAR(64) NULL,
  display_name VARCHAR(64) NOT NULL,
  status ENUM('active', 'dead', 'abandoned') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  died_at TIMESTAMP NULL,
  FOREIGN KEY (game_instance_id) REFERENCES game_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_game_users_instance_user (game_instance_id, user_id),
  INDEX idx_game_users_instance_visitor (game_instance_id, visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_settings (
  game_user_id INT NOT NULL,
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_user_id, setting_key),
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE haulonaut_sectors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_instance_id INT NOT NULL,
  sector_number INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_instance_id) REFERENCES game_instances(id) ON DELETE CASCADE,
  UNIQUE KEY uq_haulonaut_sector (game_instance_id, sector_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE haulonaut_sector_links (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_instance_id INT NOT NULL,
  from_sector_id INT NOT NULL,
  to_sector_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_instance_id) REFERENCES game_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (from_sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  FOREIGN KEY (to_sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  UNIQUE KEY uq_haulonaut_link (from_sector_id, to_sector_id),
  INDEX idx_haulonaut_links_instance (game_instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO games (game_key, name, description, is_active)
VALUES (
  'haulonaut',
  'Haulonaut',
  'A text-based space trading and exploration game in the Trade Wars / BBS door-game tradition. Haul cargo, chart a universe of sectors, and make (or lose) your fortune.',
  TRUE
)
ON DUPLICATE KEY UPDATE game_key = game_key;
