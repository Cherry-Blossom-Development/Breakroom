CREATE TABLE IF NOT EXISTS collection_items (
  id int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  collection_id int(11) NOT NULL,
  user_id int(11) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_path VARCHAR(500) NULL,
  display_order int(11) NOT NULL DEFAULT 0,
  settings longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`settings`)),
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  INDEX idx_collection_id (collection_id),
  INDEX idx_user_id (user_id),
  CONSTRAINT collection_items_ibfk_1 FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
