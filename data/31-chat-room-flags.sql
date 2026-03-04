-- Migration: Add discoverable and is_default flags to chat_rooms
ALTER TABLE chat_rooms
  ADD COLUMN discoverable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
