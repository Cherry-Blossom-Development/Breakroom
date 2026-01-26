-- Add video_path column to chat_messages table
ALTER TABLE chat_messages ADD COLUMN video_path VARCHAR(255) DEFAULT NULL;
