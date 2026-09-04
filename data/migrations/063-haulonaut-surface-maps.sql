-- Migration 063: Per-character planet surface exploration maps
--
-- haulonaut_surface_maps: one row per (character, planet feature) a
-- character has ever exited the craft onto -- private fog-of-war state, not
-- shared across players who visit the same planet. Keyed by
-- (game_user_id, feature_id) since a character can visit many planets over
-- a game and each visit's map must resume independently; the composite PK
-- also makes "does this pair already have a map" a single indexed lookup.
-- Revisiting the SAME planet across multiple landings resumes this same
-- row forever -- it's never reset, matching "the buggy is exactly where
-- you left it."
--
-- ship_x/ship_y: the buggy's fixed launch point, chosen once (grid center)
-- when the row is first created and never moved again -- the ship stays
-- parked. buggy_x/buggy_y is the character's current position, persisted
-- on every move so a reload resumes exactly in place.
--
-- revealed_cells: a JSON array of already-explored row-major cell indices
-- (index = y * grid_width + x), following this codebase's existing
-- JSON-column convention (settings/songs/device_info elsewhere in
-- data/migrations/) rather than introducing a bitmap/blob type with no
-- precedent here -- at this grid size the array stays tiny even fully
-- revealed.
--
-- grid_width/grid_height are stored per-row, not just an app constant, so a
-- future change to the default map size can't strand characters with
-- existing, differently-sized maps mid-game.
--
-- Both FKs CASCADE: this table only ever holds derived exploration
-- progress, never the pilot's core existence -- if the character or the
-- planet itself goes away, this row going with it is correct, matching
-- every other per-character Haulonaut side-table (haulonaut_visited_sectors,
-- haulonaut_pilot_inventory).

CREATE TABLE haulonaut_surface_maps (
  game_user_id INT NOT NULL,
  feature_id INT NOT NULL,
  grid_width INT NOT NULL DEFAULT 12,
  grid_height INT NOT NULL DEFAULT 8,
  ship_x INT NOT NULL,
  ship_y INT NOT NULL,
  buggy_x INT NOT NULL,
  buggy_y INT NOT NULL,
  revealed_cells JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (game_user_id, feature_id),
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (feature_id) REFERENCES haulonaut_sector_features(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
