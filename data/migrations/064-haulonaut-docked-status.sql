-- Migration 064: Separate "docked at a planet" from "physically out on
-- its surface"
--
-- Migration 062 introduced on_surface_feature_id to mean "landed AND
-- exited the craft" -- but completing the landing sequence (reaching the
-- 'docked' phase) is already its own persistent status, independent of
-- whether the player has since stepped out of the ship. Renaming to
-- docked_feature_id captures the broader meaning: non-null means "landed
-- at this planet feature," whether still inside the ship (on_surface = 0,
-- the newly-added column) or out driving the buggy (on_surface = 1).
--
-- Undocking now only happens by warping away (see the /navigate and
-- /drift changes shipped alongside this migration), which clears both
-- columns -- once the ship leaves orbit, neither "docked" nor "on the
-- surface" applies any more.
--
-- The foreign key constraint keeps its original name
-- (fk_haulonaut_pilots_surface_feature) -- purely cosmetic staleness, not
-- worth a drop-and-recreate on a live table.

ALTER TABLE haulonaut_pilots
  CHANGE COLUMN on_surface_feature_id docked_feature_id INT NULL,
  ADD COLUMN on_surface TINYINT(1) NOT NULL DEFAULT 0 AFTER docked_feature_id;

ALTER TABLE haulonaut_pilots RENAME INDEX idx_haulonaut_pilots_surface_feature TO idx_haulonaut_pilots_docked_feature;
