CREATE TABLE IF NOT EXISTS scheduled_chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  room_id INT NOT NULL,
  message_text TEXT NOT NULL,
  scheduled_at DATETIME NOT NULL,
  warning_minutes INT NOT NULL DEFAULT 10,
  indicator_text VARCHAR(255) DEFAULT '- sent via scheduled message',
  status ENUM('pending', 'warning_sent', 'confirmed', 'sent', 'cancelled') NOT NULL DEFAULT 'pending',
  is_editing TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_scheduled TINYINT(1) NOT NULL DEFAULT 0;
