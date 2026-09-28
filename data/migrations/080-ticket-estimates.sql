-- Migration 080: Ticket time estimates
-- Optional estimated effort per ticket, in hours (e.g. 0.5, 4, 16). Shown on
-- Kanban cards and set by company employees; together with ticket
-- dependencies (migration 079) this is what the project GANTT and Burndown
-- charts will be built from. NULL = not estimated.

ALTER TABLE tickets
  ADD COLUMN estimate_hours DECIMAL(6,2) NULL DEFAULT NULL AFTER priority;
