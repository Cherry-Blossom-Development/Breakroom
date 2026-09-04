-- Migration 062: Persistent ship-vs-surface location
--
-- haulonaut_pilots.on_surface_feature_id: NULL means "aboard the ship" (the
-- only state that existed before this migration); a feature id means the
-- character has exited the craft onto that haulonaut_sector_features row's
-- surface (feature_type = 'planet'). Stored on the pilot itself, alongside
-- current_sector_id, since the ship's sector doesn't change while
-- surface-side -- there's nothing else to derive this from.
--
-- ON DELETE SET NULL, not CASCADE: unlike current_sector_id (whose CASCADE
-- reflects "the whole universe was hard-deleted, so the pilot row itself is
-- meaningless too"), losing a single feature row must never take the pilot
-- row down with it. Falling back to "aboard the ship" is always a safe,
-- recoverable state; the pilot record itself must survive.

ALTER TABLE haulonaut_pilots
  ADD COLUMN on_surface_feature_id INT NULL AFTER current_sector_id,
  ADD CONSTRAINT fk_haulonaut_pilots_surface_feature
    FOREIGN KEY (on_surface_feature_id) REFERENCES haulonaut_sector_features(id) ON DELETE SET NULL,
  ADD INDEX idx_haulonaut_pilots_surface_feature (on_surface_feature_id);
