-- Breakroom Updates table
-- Stores auto-generated update summaries based on commits

CREATE TABLE IF NOT EXISTS breakroom_updates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  commit_hash VARCHAR(40),
  summary TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed with initial updates based on recent development
INSERT INTO breakroom_updates (commit_hash, summary, created_at) VALUES
(NULL, 'Introducing the Tool Shed! A new hub for productivity tools. First up: Lyric Lab - a tool for musicians to capture lyric ideas, organize them into songs, and collaborate with other songwriters.', '2025-01-27 12:00:00'),
(NULL, 'Added Widget blocks to the Breakroom! You can now add Placeholder, Breakroom Updates, Calendar/Time, and Weather widgets to your dashboard layout.', '2024-12-30 12:00:00'),
(NULL, 'Email verification page redesigned with a modern look featuring loading spinners, success/error states with gradient icons, and styled action buttons.', '2024-12-30 10:00:00'),
(NULL, 'Professional email templates now live! Signup verification emails feature branded styling with gradient headers, value propositions, and call-to-action buttons.', '2024-12-30 08:00:00'),
(NULL, 'System emails moved to database storage. Email templates can now be managed without code changes via the system_emails table.', '2024-12-30 07:00:00'),
(NULL, 'Fixed Breakroom grid resize functionality. Blocks now properly save their new sizes when resized using the drag handle.', '2024-12-29 18:00:00'),
(NULL, 'Image sharing in chat rooms! You can now upload and share images directly in chat conversations.', '2024-12-29 16:00:00'),
(NULL, 'Friends system launched! Send friend requests, accept/decline requests, manage your friends list, and block users.', '2024-12-29 14:00:00'),
(NULL, 'Public profile pages are now available. View any user profile by visiting their handle URL.', '2024-12-29 12:00:00'),
(NULL, 'Breakroom layout system added. Create a personalized dashboard with resizable and draggable blocks.', '2024-12-28 15:00:00'),
(NULL, 'Redis-powered real-time messaging! Socket.IO now uses Redis adapter for seamless cross-server communication.', '2024-12-28 10:00:00'),
(NULL, 'Chat rooms with real-time messaging are here! Create rooms, invite friends, and chat in real-time.', '2024-12-27 12:00:00'),
(NULL, 'Database migrated from PostgreSQL to MariaDB for improved performance and compatibility.', '2024-12-25 09:00:00');
