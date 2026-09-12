-- Migration 073: Correct Haulonaut NPC magnet behavior -- beeline, not a
-- periodic single hop
--
-- Migration 072 pulled a magnet NPC one hop toward its target every ~5
-- random turns. The intended behavior is different: a magnet wanders
-- randomly for exactly MAGNET_RANDOM_TURNS turns (5, see the constant in
-- backend/routes/games.js), then commits to homing -- taking a shortest-path
-- hop toward its target EVERY turn (an actual beeline) until it lands in the
-- target's current sector, at which point it stops, sits still for that
-- tick, and starts a fresh wander phase.
--
-- magnet_homing tracks which phase a magnet is currently in. The existing
-- magnet_turns_remaining column (migration 072) is repurposed rather than
-- replaced -- it now counts down the wander phase specifically and is
-- irrelevant while magnet_homing is true; any in-flight value on an existing
-- magnet NPC (created under 072's randomized-interval scheme) still works
-- fine as a plain countdown under the new fixed-5 scheme, no backfill needed.

ALTER TABLE haulonaut_pilots
  ADD COLUMN magnet_homing BOOLEAN NOT NULL DEFAULT FALSE AFTER magnet_turns_remaining;
