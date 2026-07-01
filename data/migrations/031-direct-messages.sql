ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS `type` ENUM('room', 'dm') NOT NULL DEFAULT 'room';

CREATE INDEX IF NOT EXISTS idx_chat_rooms_type ON chat_rooms(`type`);
