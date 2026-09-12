-- Migration 072: Haulonaut NPC "magnet" behavior
--
-- A magnet NPC periodically abandons its normal random walk (see
-- backend/jobs/haulonautNpcScheduler.js) and takes one hop toward a specific
-- human pilot's CURRENT sector instead, closing the distance over successive
-- pulls until it lands in the same sector -- then resumes its random walk
-- until they drift apart again. Set at spawn time via the admin NPC form's
-- "Magnet" checkbox, only available alongside "Near user" placement (that's
-- where the target pilot is already chosen).
--
-- magnet_turns_remaining is a per-NPC countdown, reseeded to a random 3-7 each
-- time it reaches 0 (see the scheduler) -- "every 5 random turns" rather than
-- a rigid cadence, and independently randomized per NPC so a batch spawned
-- together doesn't pull in lockstep.
--
-- magnet_target_game_user_id -> game_users(id) ON DELETE SET NULL: if the
-- tracked pilot's character is later deleted outright, the magnet just stops
-- pulling (falls back to its random walk) rather than the FK blocking that
-- deletion.

ALTER TABLE haulonaut_pilots
  ADD COLUMN is_magnet BOOLEAN NOT NULL DEFAULT FALSE AFTER health,
  ADD COLUMN magnet_target_game_user_id INT NULL AFTER is_magnet,
  ADD COLUMN magnet_turns_remaining INT NULL AFTER magnet_target_game_user_id,
  ADD CONSTRAINT fk_haulonaut_pilots_magnet_target
    FOREIGN KEY (magnet_target_game_user_id) REFERENCES game_users(id) ON DELETE SET NULL;
