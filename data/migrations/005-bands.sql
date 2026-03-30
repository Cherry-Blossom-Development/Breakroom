CREATE TABLE IF NOT EXISTS bands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bands_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS band_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  band_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'member') NOT NULL DEFAULT 'member',
  status ENUM('active', 'invited', 'declined') NOT NULL DEFAULT 'invited',
  invited_by INT NULL,
  joined_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_band_member (band_id, user_id),
  CONSTRAINT fk_band_members_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
  CONSTRAINT fk_band_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_band_members_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
