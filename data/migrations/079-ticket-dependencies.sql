-- Migration 079: Ticket dependencies
-- Optional finish-to-start links between tickets, groundwork for the
-- project GANTT and Burndown charts: a row means ticket_id can't be finished
-- until depends_on_ticket_id is (resolved or closed). A ticket can depend on
-- any number of others. Both tickets must belong to the same company (they
-- may be in different projects) and the graph must stay acyclic -- both
-- enforced in backend/utilities/ticketDependencies.js, since MariaDB can't
-- express either as a constraint.

CREATE TABLE ticket_dependencies (
  ticket_id INT NOT NULL,
  depends_on_ticket_id INT NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, depends_on_ticket_id),
  INDEX idx_ticket_dependencies_depends_on (depends_on_ticket_id),
  CONSTRAINT chk_ticket_dependencies_not_self CHECK (ticket_id <> depends_on_ticket_id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
