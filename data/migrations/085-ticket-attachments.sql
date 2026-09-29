-- Migration 085: Ticket attachments
-- Files (images, spreadsheets, documents, ...) attached to a ticket. The
-- file itself lives in S3 under tickets/<ticket id>/; this row references
-- it. Files are never linked from S3 directly -- the backend streams them
-- after checking ticket access (private projects must stay private).

CREATE TABLE ticket_attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  uploaded_by INT NULL,
  s3_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  size_bytes INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket_attachments_ticket (ticket_id, created_at),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
