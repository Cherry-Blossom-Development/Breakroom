-- Migration 059: Pilot resources -- Credits (money) and Rations (food)
--
-- Both added to haulonaut_pilots rather than the generic game_users table,
-- matching migration 056's reasoning for current_sector_id: these are
-- Haulonaut-specific ship/pilot resources, not something every future game
-- needs. Every pilot starts with the same stake and both drop by a small
-- fixed amount on every warp (see the /navigate route in games.js), clamped
-- at 0 rather than going negative. The column defaults here must stay in
-- sync with games.js's STARTING_CREDITS / STARTING_RATIONS constants, since
-- both self-heal spawn and character creation insert a haulonaut_pilots row
-- without specifying these columns and rely on the DB default. Ways to
-- replenish either resource are a separate follow-up -- for now they only
-- ever go down.

ALTER TABLE haulonaut_pilots
  ADD COLUMN credits INT NOT NULL DEFAULT 1000 AFTER current_sector_id,
  ADD COLUMN rations INT NOT NULL DEFAULT 100 AFTER credits;
