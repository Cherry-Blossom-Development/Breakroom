-- Migration 068: Cycle economy rebalance (5x)
--
-- The original economy (migration 066) gave every pilot 24 cycles, one back
-- per real hour, and charged 1 for every piloted action -- warp, planet
-- landing, and each buggy move alike. That made nudging the surface buggy
-- cost exactly as much as a jump to another sector, so exploring a planet
-- ate the same budget as interstellar travel.
--
-- This scales the whole economy up 5x and re-prices the actions:
--   * cap:            24  -> 120
--   * replenish rate: 1/h -> 5/h   (one cycle per 12 min; games.js
--                                   CYCLE_REPLENISH_SECONDS 3600 -> 720)
--   * warp cost:      1   -> 5     (games.js WARP_CYCLE_COST)
--   * landing cost:   1   -> 5     (games.js DOCK_CYCLE_COST)
--   * buggy move:     1   -> 1     (games.js BUGGY_CYCLE_COST, unchanged)
--
-- Net effect: a warp is exactly as scarce as before (5 of 120, one warp's
-- worth of cycles regained every hour), a full bar still takes 24h to
-- refill from empty, and a buggy move is now a fifth as costly in relative
-- terms -- surface exploration no longer competes with travel for the same
-- tight budget.
--
-- The 120 default must stay in sync with games.js's STARTING_CYCLES /
-- MAX_CYCLES (self-heal spawn + character creation insert a haulonaut_pilots
-- row without naming cycles and rely on this default).
--
-- Existing pilots: their current balance is multiplied by 5 (capped at 120)
-- so nobody loses relative standing, and cycles_updated_at is reset to now
-- -- the accrual anchor must restart under the new 12-minute cadence rather
-- than let a stale hours-old anchor dump a windfall at the faster rate on
-- the next read.

ALTER TABLE haulonaut_pilots
  MODIFY COLUMN cycles INT NOT NULL DEFAULT 120;

UPDATE haulonaut_pilots
  SET cycles = LEAST(120, cycles * 5),
      cycles_updated_at = NOW();
