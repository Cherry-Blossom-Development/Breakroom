-- Replace single-user rating column with a per-user ratings table
ALTER TABLE sessions DROP COLUMN rating;

CREATE TABLE IF NOT EXISTS session_ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_session (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
