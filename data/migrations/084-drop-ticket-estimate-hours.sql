-- Migration 084: Drop tickets.estimate_hours
-- Superseded by estimate_amount + estimate_unit (migration 083). Apply only
-- after the backend that reads the new columns is deployed.

ALTER TABLE tickets DROP COLUMN estimate_hours;
