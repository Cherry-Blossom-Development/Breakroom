CREATE TABLE IF NOT EXISTS band_email_invites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  band_id INT NOT NULL,
  invited_by INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(36) NOT NULL UNIQUE,
  status ENUM('pending', 'accepted', 'expired') NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bei_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
  CONSTRAINT fk_bei_user FOREIGN KEY (invited_by) REFERENCES users(id)
);
