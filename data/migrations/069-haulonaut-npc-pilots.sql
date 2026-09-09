-- Migration 069: NPC pilots -- system-controlled characters that occupy
-- game_users rows exactly like a human player (user_id and visitor_id both
-- NULL), so they fall out of every existing sector/roster/pilot query for
-- free (loadPilotLocation's playersHere, the admin roster, ...) without any
-- schema change to haulonaut_pilots itself. is_npc is what lets those
-- queries and the admin UI tell the two apart, and lets player-facing
-- counts (game info, admin overview) exclude bots from a "player_count".
--
-- Movement is driven by backend/jobs/haulonautNpcScheduler.js, which reuses
-- the same warp/cycles/fuel/rations/health rules real players are bound by
-- (see games.js's exported `internals`) -- an NPC is just a character
-- nobody is logged into.

ALTER TABLE game_users
  ADD COLUMN is_npc BOOLEAN NOT NULL DEFAULT FALSE AFTER visitor_id;
