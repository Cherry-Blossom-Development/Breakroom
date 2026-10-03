-- Migration 088: Ticket contributors
-- People working on a ticket besides its assignee, each with an optional
-- freeform role ("Reviewer", "Design", ...). Anyone a ticket can be
-- assigned to can be a contributor (see canBeAssigned in
-- backend/utilities/ticketAccess.js).

CREATE TABLE ticket_contributors (
  ticket_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(100) NOT NULL DEFAULT '',
  added_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, user_id),
  INDEX idx_ticket_contributors_user (user_id),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
