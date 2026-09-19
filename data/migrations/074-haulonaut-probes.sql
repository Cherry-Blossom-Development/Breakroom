-- Migration 074: Recon probes
--
-- A probe is a purchasable, one-time-use item (haulonaut_items, see
-- migration 060) that a pilot deploys from Cargo instead of consuming
-- directly. Deploying picks one of three mission types (explore
-- undiscovered space, search for something in the catalog, or find another
-- trader) and hands the mission to backend/jobs/haulonautProbeScheduler.js,
-- which resolves it on the same 5-minute tick cadence
-- haulonautNpcScheduler.js already uses -- reusing that clock rather than
-- inventing a second one. A pilot may only have one active mission at a
-- time (enforced in app code, same style as the NPC magnet state machine --
-- no DB constraint for it).
--
-- Not every outpost/planet sells probes (sells_probe on the generic
-- haulonaut_sector_features table, alongside feature_type, rather than a
-- new join table -- this is the first restricted item and a boolean column
-- is the simplest thing that could work; a real per-item-per-feature catalog
-- is a natural follow-up if a second restricted item shows up). Existing
-- features get a deterministic subset seeded below (every 3rd trading_outpost
-- or planet feature by id) so this migration produces identical results in
-- every environment; the sector-content generator (haulonautUniverse.js)
-- rolls the same odds for newly generated universes going forward.
ALTER TABLE haulonaut_sector_features
  ADD COLUMN sells_probe BOOLEAN NOT NULL DEFAULT FALSE AFTER description;

UPDATE haulonaut_sector_features
  SET sells_probe = TRUE
  WHERE feature_type IN ('trading_outpost', 'planet') AND id % 3 = 0;

INSERT INTO haulonaut_items (item_key, name, category, description, base_price) VALUES
  ('probe', 'Recon Probe', 'equipment', 'A disposable automated probe. Deploy it from Cargo to explore undiscovered space, search for something specific, or locate other traders -- it reports back once its mission completes.', 150);

-- One row per deployed probe. search_item_id is only set for mission_type =
-- 'search'. result_sector_id is the sector the probe's finding is in
-- (explore/search); traders missions leave it null and put the found
-- pilot's name/location straight into result_summary instead -- another
-- pilot's current sector is a live, moving fact, not worth a stale FK.
-- The row itself doubles as the "mailbox": GET .../probes returns whichever
-- mission is still active, plus the most recent completed/failed one that
-- hasn't been acknowledged yet, so a report waits for the player whether or
-- not they were online in real time (see haulonaut_trade_offers for the
-- same pending-row pattern, and haulonaut_probe_report for the live
-- socket push).
CREATE TABLE haulonaut_probe_missions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_user_id INT NOT NULL,
  mission_type ENUM('explore', 'search', 'traders') NOT NULL,
  search_item_id INT NULL,
  origin_sector_id INT NOT NULL,
  status ENUM('active', 'completed', 'failed') NOT NULL DEFAULT 'active',
  ticks_elapsed INT NOT NULL DEFAULT 0,
  ticks_to_complete INT NOT NULL,
  result_sector_id INT NULL,
  result_summary TEXT NULL,
  deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  acknowledged_at TIMESTAMP NULL,
  FOREIGN KEY (game_user_id) REFERENCES game_users(id) ON DELETE CASCADE,
  FOREIGN KEY (search_item_id) REFERENCES haulonaut_items(id) ON DELETE SET NULL,
  FOREIGN KEY (origin_sector_id) REFERENCES haulonaut_sectors(id) ON DELETE CASCADE,
  FOREIGN KEY (result_sector_id) REFERENCES haulonaut_sectors(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
