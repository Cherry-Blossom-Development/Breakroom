-- Migration 067: Crew health -- a pilot vitals stat that rations feed
--
-- Rations no longer gate warping (see the /navigate route in games.js): a
-- pilot with fuel and cycles can always warp. What running dry on rations
-- costs instead is health. Every warp either feeds the crew from that
-- warp's rations draw (health regens a little, WARP_HEALTH_REGEN) or, if
-- there were no rations to draw, starves them (health drops hard,
-- WARP_STARVATION_DAMAGE). Health reaching 0 kills the character --
-- game_users.status flips to 'dead' and died_at is set, the same
-- end-state the roster/landing pages already render.
--
-- Lives on haulonaut_pilots alongside credits/rations/fuel/cycles, matching
-- migrations 059/061/066: a Haulonaut-specific pilot resource, not
-- something the generic game_users table should carry. The default (100)
-- must stay in sync with games.js's STARTING_HEALTH / MAX_HEALTH, since the
-- self-heal spawn path and character creation insert a haulonaut_pilots row
-- without naming health and rely on this default. Every pilot already
-- existing at migration time starts at full health.

ALTER TABLE haulonaut_pilots
  ADD COLUMN health INT NOT NULL DEFAULT 100 AFTER fuel;
