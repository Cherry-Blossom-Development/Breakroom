-- MariaDB/MySQL schema for Lyrics (Musician Tools)

-- Songs table for grouping lyrics into song projects
CREATE TABLE IF NOT EXISTS songs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  genre VARCHAR(100) DEFAULT NULL,
  status ENUM('idea', 'writing', 'complete', 'recorded', 'released') DEFAULT 'idea',
  visibility ENUM('private', 'collaborators', 'public') DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for faster retrieval by user
CREATE INDEX idx_songs_user_id ON songs(user_id);

-- Index for public songs discovery
CREATE INDEX idx_songs_visibility ON songs(visibility, created_at DESC);

-- Lyrics table for storing lyric snippets and sections
CREATE TABLE IF NOT EXISTS lyrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  song_id INT DEFAULT NULL,
  title VARCHAR(255) DEFAULT NULL,
  content TEXT NOT NULL,
  section_type ENUM('idea', 'verse', 'chorus', 'bridge', 'pre-chorus', 'hook', 'intro', 'outro', 'other') DEFAULT 'idea',
  section_order INT DEFAULT NULL,
  mood VARCHAR(100) DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  status ENUM('draft', 'in-progress', 'complete', 'archived') DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for faster retrieval by user
CREATE INDEX idx_lyrics_user_id ON lyrics(user_id);

-- Index for faster retrieval by song
CREATE INDEX idx_lyrics_song_id ON lyrics(song_id);

-- Index for ordering lyrics within a song
CREATE INDEX idx_lyrics_song_order ON lyrics(song_id, section_order);

-- Song collaborators table for sharing songs with other users
CREATE TABLE IF NOT EXISTS song_collaborators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  song_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('viewer', 'editor') DEFAULT 'editor',
  invited_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_song_collaborator (song_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for finding all songs a user collaborates on
CREATE INDEX idx_song_collaborators_user_id ON song_collaborators(user_id);
