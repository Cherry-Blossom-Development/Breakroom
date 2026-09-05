-- Migration 065: Track which surface cells the buggy has actually visited
--
-- revealed_cells (migration 063) is fog-of-war sight -- moving near a cell
-- reveals it without ever physically visiting it. visited_cells is
-- narrower: only the exact cells the buggy has stood on. This is what
-- drives "see whatever is in the area upon arriving in that area" --
-- POST /drive-buggy rolls one landing event the first time the buggy
-- reaches a cell, using this column (not revealed_cells) to know whether
-- that cell is actually new.
--
-- Added nullable and backfilled rather than given a JSON default -- MySQL/
-- MariaDB's historical restrictions on TEXT/JSON column defaults make a
-- literal default unreliable across versions, and every row already
-- existing at this point has a real ship_x/ship_y to backfill from (the
-- buggy always starts parked on the ship's own cell).

ALTER TABLE haulonaut_surface_maps ADD COLUMN visited_cells JSON NULL AFTER revealed_cells;

UPDATE haulonaut_surface_maps
SET visited_cells = CONCAT('[', (ship_y * grid_width + ship_x), ']')
WHERE visited_cells IS NULL;

ALTER TABLE haulonaut_surface_maps MODIFY COLUMN visited_cells JSON NOT NULL;
