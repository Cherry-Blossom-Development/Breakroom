-- MariaDB/MySQL schema for Art Gallery (Artist Tools)

-- Gallery metadata (one per user)
CREATE TABLE IF NOT EXISTS user_gallery (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  gallery_url VARCHAR(500) NOT NULL,
  gallery_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE INDEX idx_gallery_url (gallery_url),
  UNIQUE INDEX idx_gallery_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Individual artworks (many per user)
CREATE TABLE IF NOT EXISTS gallery_artworks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT NULL,
  image_path VARCHAR(500) NOT NULL,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for faster retrieval by user
CREATE INDEX idx_gallery_artworks_user_id ON gallery_artworks(user_id);

-- Index for public artworks discovery
CREATE INDEX idx_gallery_artworks_published ON gallery_artworks(user_id, is_published, created_at DESC);
