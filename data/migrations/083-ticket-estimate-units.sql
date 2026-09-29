-- Migration 083: Ticket estimates as an amount + unit
-- Replaces tickets.estimate_hours (migration 080) with the number the person
-- entered and the unit they chose -- '3 days' is stored as (3, 'days'), not
-- converted to hours. Consumers that need a common scale (the GANTT chart)
-- convert at read time. Both NULL = not estimated.
--
-- Existing estimates were entered in hours, so they carry over as hours.
-- estimate_hours is dropped separately (migration 084) once the backend that
-- stops reading it is deployed.

ALTER TABLE tickets
  ADD COLUMN estimate_amount DECIMAL(6,2) NULL DEFAULT NULL AFTER priority,
  ADD COLUMN estimate_unit ENUM('hours', 'days', 'weeks', 'months') NULL DEFAULT NULL AFTER estimate_amount;

UPDATE tickets
SET estimate_amount = estimate_hours, estimate_unit = 'hours'
WHERE estimate_hours IS NOT NULL;
