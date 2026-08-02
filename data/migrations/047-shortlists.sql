-- Migration 047: Shortlists
-- Band-owned, named groups of recordings for evaluation, plus a threaded discussion
-- attached to each recording. See docs discussion in the Breakroom session that added
-- this — any active band member can create/rename/delete a shortlist, add/remove any
-- recording (band, individual, or mashup) uploaded by a current bandmate, and comment.

CREATE TABLE IF NOT EXISTS shortlists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  band_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_shortlists_band_id (band_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shortlist_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shortlist_id INT NOT NULL,
  session_id INT NOT NULL,
  added_by INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_shortlist_session (shortlist_id, session_id),
  FOREIGN KEY (shortlist_id) REFERENCES shortlists(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(id),
  INDEX idx_shortlist_sessions_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One level of threading only (parent_id), matching blog_comments' shape
-- (data/17-blog-comments.sql) -- replies don't nest further.
CREATE TABLE IF NOT EXISTS session_comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_id INT NULL,
  content TEXT NOT NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES session_comments(id) ON DELETE CASCADE,
  INDEX idx_session_comments_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
