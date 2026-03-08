-- Add platform column to breakroom_updates for device-specific filtering
-- Values: 'all' (web/iOS/Android), 'ios' (iOS only), 'android' (Android only)
-- Web always shows all updates regardless of platform

ALTER TABLE breakroom_updates
  ADD COLUMN platform ENUM('all','ios','android') NOT NULL DEFAULT 'all' AFTER summary;

-- Flag Android-only updates
UPDATE breakroom_updates SET platform = 'android' WHERE id IN (29, 30);

-- Flag iOS-only updates
UPDATE breakroom_updates SET platform = 'ios' WHERE id IN (36, 37);

-- Split ID 28 (was "working on Android... also working on iPhone") → android only
UPDATE breakroom_updates SET
  platform = 'android',
  summary = 'Work has begun on the Android mobile application! Login, signup, basic chat, and a basic Breakroom home page are now up and running.'
WHERE id = 28;

-- Add iOS counterpart for ID 28
INSERT INTO breakroom_updates (commit_hash, summary, platform, created_at)
VALUES (NULL, 'Work has begun on the iPhone app! More details to follow.', 'ios', '2026-01-12 12:00:00');

-- Split ID 40 (was "both apps awaiting review + upcoming features") → keep 'all' for feature notes, add platform-specific app store entries
UPDATE breakroom_updates SET
  platform = 'all',
  summary = 'Upcoming features in development: 48-hour login sliding window (so you stay logged in without daily re-authentication), and a 1-week chat lookback default on initial load (older messages are still accessible by scrolling back).'
WHERE id = 40;

INSERT INTO breakroom_updates (commit_hash, summary, platform, created_at)
VALUES
  (NULL, 'The iPhone app has been submitted to the App Store and is awaiting review!', 'ios', '2026-03-02 12:00:00'),
  (NULL, 'The Android app has been submitted to the Google Play Store and is awaiting review!', 'android', '2026-03-02 12:00:00');

-- New updates for features added since 2026-03-02

-- Android-specific fixes and improvements
INSERT INTO breakroom_updates (commit_hash, summary, platform, created_at) VALUES
  (NULL, 'Company Portal search results are now tappable on Android - tapping a company in search results opens the full company page directly.', 'android', '2026-03-05 10:00:00'),
  (NULL, 'Fixed: the Team tab on company pages now correctly shows employees for all users, not just employees of that company.', 'android', '2026-03-05 10:30:00'),
  (NULL, 'HTML tags are no longer visible in ticket descriptions and job listings on Android - content now displays cleanly as intended.', 'android', '2026-03-05 11:00:00'),
  (NULL, 'Employment page on Android updated: improved intro text, job descriptions now strip HTML correctly, and the page header and job list scroll together.', 'android', '2026-03-05 11:30:00'),
  (NULL, 'Ticket editing on Android is now restricted to the creator of the ticket, matching the web app behavior.', 'android', '2026-03-05 12:00:00');

-- All-platform updates (web + Android)
INSERT INTO breakroom_updates (commit_hash, summary, platform, created_at) VALUES
  (NULL, 'Forgot your password? A self-service password reset flow is now available on both web and Android. Enter your email, receive a reset link, and set a new password.', 'all', '2026-03-08 09:00:00'),
  (NULL, 'Lyric Lab improvements: songs and ideas now support a date field so you can track when inspiration struck. New "Create & Add Lyric" button lets you write your first lyric immediately after creating a song.', 'all', '2026-03-08 09:30:00'),
  (NULL, 'Ticket improvements: descriptions now support rich text formatting. Ticket editing is restricted to the original creator. Help Desk visibility controls added so tickets can be marked internal-only.', 'all', '2026-03-08 10:00:00'),
  (NULL, 'Chat rooms overhauled: rooms can now be marked as discoverable so anyone can join. Descriptions are now required when creating a room. You can leave any chat room, and discoverable rooms appear in the Add Block widget picker.', 'all', '2026-03-08 10:30:00'),
  (NULL, 'Chat performance improved: messages now load using an efficient limit-based pagination system instead of time-window scanning. This is faster and more reliable for rooms with long histories.', 'all', '2026-03-08 11:00:00'),
  (NULL, 'Minor improvements: friend search now shows full names only (handles are no longer exposed), and two new music genres added to Lyric Lab suggestions: Goth and Industrial.', 'all', '2026-03-08 11:30:00');
