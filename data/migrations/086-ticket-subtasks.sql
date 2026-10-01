-- Migration 086: Split a ticket into subtasks
-- Subtasks are ordinary tickets with parent_ticket_id set. The parent's
-- split_mode says what became of it (NULL = never split):
--   hidden   - off every board and chart; still reachable from its
--              subtasks' link
--   category - off the Kanban board, but drawn as a summary bar over its
--              subtasks on the GANTT chart and offered as a filter on the
--              Burndown chart
-- Either way the subtasks carry the work: the charts leave out the
-- parent's own estimate so it isn't counted twice.

ALTER TABLE tickets
  ADD COLUMN parent_ticket_id INT NULL DEFAULT NULL AFTER company_id,
  ADD COLUMN split_mode ENUM('hidden', 'category') NULL DEFAULT NULL AFTER parent_ticket_id,
  ADD INDEX idx_tickets_parent (parent_ticket_id),
  ADD CONSTRAINT fk_tickets_parent FOREIGN KEY (parent_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
