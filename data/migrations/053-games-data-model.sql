-- Migration 053: Core data model for the Games section
--
-- games: catalog of games available under the Games section (migration 052's
-- 'games' feature flag gates visibility of the section as a whole; this table
-- is the list of individual games shown inside it once it's live). Starts
-- empty -- no game exists yet, this just lays the groundwork.
--
-- game_users: a player identity ("character") within one game. Deliberately
-- decoupled from the platform `users` table:
--   - A real account (user_id) can have MANY game_users per game, so dying
--     and starting a fresh character is just a new row, not a reset of an
--     existing one -- history stays queryable via `status`.
--   - user_id is nullable and visitor_id (matching the convention already
--     used by analytics_visits/signup_visitor_id, migrations 038/040) is
--     populated instead for people who aren't Prosaurus users yet. If they
--     sign up later, visitor_id stays on the row as a permanent record while
--     user_id gets backfilled to link the same character to their new
--     account -- same correlation pattern signup_visitor_id already uses.
--   - ON DELETE SET NULL (not CASCADE) on user_id mirrors analytics_visits:
--     deleting an account shouldn't erase game history/leaderboard rows,
--     just orphan them the same way an anonymous visit already is.
--
-- game_settings: generic per-game_user key/value store (score, level,
-- inventory, preferences, whatever a given game needs to persist) so future
-- games don't each need their own bespoke settings table.

CREATE TABLE games (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_key VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id INT NOT NULL,
  user_id INT NULL,
  visitor_id VARCHAR(64) NULL,
  display_name VARCHAR(64) NOT NULL,
  status ENUM('active', 'dead', 'abandoned') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  died_at TIMESTAMP NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_game_users_game_user (game_id, user_id),
  INDEX idx_game_users_game_visitor (game_id, visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_settings (
  game_user_id INT NOT NULL,
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_user_id, setting_key),
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
