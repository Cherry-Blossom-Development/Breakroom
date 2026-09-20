-- Migration 075: Magnetic Tracking Buoys
--
-- A buoy is a purchasable Cargo item (haulonaut_items, see migration 060)
-- that isn't deployed toward a mission like a probe (migration 074) -- it's
-- dropped in whatever sector the owner is currently in and just sits there,
-- invisible to everyone else. The first other *human* pilot (NPCs excluded,
-- same reasoning as the NPC magnet logic never targeting another NPC) to
-- warp or drift into that sector has it silently attach to their ship; from
-- then on it tracks that ship's live location back to the owner for as long
-- as the game runs -- there's no detach/expire mechanic. Attachment is
-- handled in app code (backend/routes/games.js's attachBuoysInSector,
-- called from /navigate and /drift right after current_sector_id moves),
-- not a DB trigger.
--
-- A buoy's current location is never stored directly: while `status` is
-- 'dropped', it's `sector_id` (where it was left); once 'attached', the
-- owner's GET .../buoys instead joins straight through to the target
-- pilot's live haulonaut_pilots.current_sector_id, so it can never go stale
-- the way a copied/cached location would the moment the target moves again.
INSERT INTO haulonaut_items (item_key, name, category, description, base_price) VALUES
  ('tracking_buoy', 'Magnetic Tracking Buoy', 'equipment', 'Drop it in a sector and forget it -- invisible to everyone but you. The first other ship to pass through latches onto it, and it starts transmitting that ship''s location back to you for as long as the game runs.', 300);

CREATE TABLE haulonaut_tracking_buoys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_game_user_id INT NOT NULL,
  sector_id INT NOT NULL,
  status ENUM('dropped', 'attached') NOT NULL DEFAULT 'dropped',
  attached_game_user_id INT NULL,
  dropped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  attached_at TIMESTAMP NULL,
  FOREIGN KEY (owner_game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  FOREIGN KEY (attached_game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  INDEX idx_buoy_sector_status (sector_id, status),
  INDEX idx_buoy_owner (owner_game_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
