-- Migration 081: Ticket status history
-- One row per status change (and one for the initial status when a ticket
-- is created), written by the ticket create/update routes. Gives the GANTT
-- chart real start/finish times for work (first move to in_progress, last
-- move to resolved/closed) and the Burndown chart a timeline that survives
-- reopening -- tickets.resolved_at alone gets overwritten.
--
-- No backfill: status changes before this migration were never recorded,
-- so history starts empty for existing tickets and the charts fall back to
-- created_at / resolved_at for them.

CREATE TABLE ticket_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  changed_by INT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket_status_history_ticket (ticket_id, changed_at),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
