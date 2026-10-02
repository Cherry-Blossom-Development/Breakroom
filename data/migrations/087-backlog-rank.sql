-- Migration 087: Manual backlog order
-- The backlog list (Kanban board -> Backlog) can be reordered by dragging.
-- The order is per project -- a ticket can belong to several -- so it lives
-- on the ticket's project link. Lower ranks come first; NULL means never
-- placed (new tickets), which the list shows above the ranked ones in the
-- default priority order. A split parent's rank orders its whole group;
-- its subtasks' ranks order them within the group.

ALTER TABLE ticket_projects
  ADD COLUMN backlog_rank INT NULL DEFAULT NULL,
  ADD INDEX idx_ticket_projects_backlog_rank (project_id, backlog_rank);
