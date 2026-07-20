-- Migration 042: System chat bot account
-- Creates the "Prosaurus" system account that posts automated messages (e.g.
-- the new-member welcome message in backend/routes/authentication.js). Every
-- chat_messages row requires a real, non-null user_id, so automated messages
-- need a real account rather than a NULL "system" sender.
--
-- hash/salt are left NULL, making password login impossible (login compares
-- a computed hash against users.hash with ===, which a string can never
-- equal null). is_internal is TRUE so it's excluded from all analytics and
-- never receives a real_user_number.

INSERT INTO users (handle, first_name, last_name, email, email_verified, hash, salt, is_internal)
SELECT 'Prosaurus', 'Prosaurus', NULL, 'bot@prosaurus.com', TRUE, NULL, NULL, TRUE
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'Prosaurus');
