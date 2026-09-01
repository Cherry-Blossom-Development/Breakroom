-- Migration 061: Fuel as a top-level pilot resource
--
-- Fuel joins credits/rations as a HUD-visible pilot stat rather than a
-- generic inventory item -- same reasoning as rations in migration 059:
-- something the ship burns on every warp deserves its own column, not a
-- quantity sitting invisibly in cargo. Existing Fuel Cell purchases already
-- in haulonaut_pilot_inventory (bought before this column existed) are
-- folded into the new column rather than discarded, then removed from
-- inventory so they don't double-count as both a HUD stat and a cargo
-- line going forward.
--
-- Column default (100) must stay in sync with games.js's STARTING_FUEL,
-- for the same reason as credits/rations -- both self-heal spawn and
-- character creation insert a haulonaut_pilots row without specifying fuel
-- and rely on this default.

ALTER TABLE haulonaut_pilots ADD COLUMN fuel INT NOT NULL DEFAULT 100 AFTER rations;

UPDATE haulonaut_pilots hp
JOIN haulonaut_pilot_inventory hi ON hi.game_user_id = hp.game_user_id
JOIN haulonaut_items i ON i.id = hi.item_id AND i.item_key = 'fuel'
SET hp.fuel = hp.fuel + hi.quantity;

DELETE hi FROM haulonaut_pilot_inventory hi
JOIN haulonaut_items i ON i.id = hi.item_id
WHERE i.item_key = 'fuel';
