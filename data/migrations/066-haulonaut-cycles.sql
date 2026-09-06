-- Migration 066: Cycles -- a wall-clock action budget
--
-- Cycles cap the amount of world-changing action a pilot can take per day.
-- A pilot has at most 24 (one per hour of the day) and spends one on each
-- warp (POST /navigate), each planet landing (POST /dock), and each buggy
-- move to a new surface cell (POST /drive-buggy). Trading, plotting
-- courses, launching, exiting the craft, and passive drift cost nothing --
-- only piloted travel burns a cycle.
--
-- Replenishment is lazy and time-based, never scheduled: cycles_updated_at
-- is the accrual anchor, and games.js's replenishCycles() grants
-- floor((now - anchor) / 1 hour) cycles (capped at 24) whenever a pilot row
-- is read, advancing the anchor by whole hours consumed so partial-hour
-- progress is preserved. This makes replenishment identical whether the
-- player is online, backgrounded, or logged out -- it's purely a function
-- of elapsed real time. While a pilot is at the 24 cap the anchor is kept
-- at "now" so a long-idle full bar never banks overflow to dump the instant
-- one cycle is spent; the hourly clock effectively starts on the first
-- spend that drops below the cap.
--
-- Both columns live on haulonaut_pilots alongside credits/rations/fuel,
-- matching migration 059's reasoning -- a Haulonaut-specific pilot resource,
-- not something the generic game_users table should carry. The cycles
-- default (24) must stay in sync with games.js's STARTING_CYCLES /
-- MAX_CYCLES, since the self-heal spawn path and character creation insert a
-- haulonaut_pilots row without naming cycles and rely on this default.
--
-- cycles_updated_at is a plain DEFAULT CURRENT_TIMESTAMP with NO
-- "ON UPDATE" clause (unlike the table's existing updated_at) -- the
-- replenish logic sets it explicitly and it must not move on every
-- unrelated pilot UPDATE. Every pilot already existing at migration time
-- starts full, with the anchor set to the moment this runs.

ALTER TABLE haulonaut_pilots
  ADD COLUMN cycles INT NOT NULL DEFAULT 24 AFTER fuel,
  ADD COLUMN cycles_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER cycles;
