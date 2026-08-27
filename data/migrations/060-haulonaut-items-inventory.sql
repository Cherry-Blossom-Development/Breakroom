-- Migration 060: Outpost items and player inventory
--
-- haulonaut_items: a small global catalog of purchasable things, shared
-- across every Haulonaut universe -- item definitions don't vary per
-- instance. For this first version every outpost sells the entire catalog
-- at its listed base_price; per-outpost stock/pricing variation is a
-- natural follow-up, not built here.
--
-- haulonaut_pilot_inventory: the "data storage location for stuff a user
-- has" -- a simple game_user_id/item_id/quantity ledger. Rations are the
-- one deliberate exception: buying the 'rations' item (see games.js's
-- /purchase route) adds straight to haulonaut_pilots.rations, the stat
-- that already exists and is already shown in the HUD, rather than
-- becoming its own inventory line. Everything else (fuel, weapons, ship
-- parts, ...) has no existing top-level stat, so it lives here instead.

CREATE TABLE haulonaut_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_key VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  description TEXT NULL,
  base_price INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE haulonaut_pilot_inventory (
  game_user_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_user_id, item_id),
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES haulonaut_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO haulonaut_items (item_key, name, category, description, base_price) VALUES
  ('rations', 'Rations', 'resource', 'Restocks your ship''s food stores.', 4),
  ('fuel', 'Fuel Cell', 'resource', 'Compressed reaction mass for the warp drive.', 6),
  ('laser_cannon', 'Laser Cannon', 'weapon', 'A ship-mounted energy weapon.', 250),
  ('shield_generator', 'Shield Generator', 'ship_part', 'Projects a deflector field around the hull.', 400),
  ('hull_plating', 'Hull Plating', 'ship_part', 'Reinforced armor plating for the outer hull.', 180);
