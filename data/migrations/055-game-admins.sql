-- Migration 055: Per-game admin roles
--
-- Distinct from the site's admin_access permission (backend/routes/admin.js,
-- AdminUsers/AdminGroups/etc.) which is platform-wide. A game_admins row
-- grants operational control over one specific game (currently: generating
-- a fresh Haulonaut universe, viewing the player roster) without granting
-- any site-wide admin capability. Scoped to the game, not a specific
-- instance, since "admin of Haulonaut" should persist across universe
-- resets. Site admins can grant/revoke rows here (Admin > Games); existing
-- game admins do not manage other game admins in this first pass.

CREATE TABLE game_admins (
  game_id INT NOT NULL,
  user_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (game_id, user_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
