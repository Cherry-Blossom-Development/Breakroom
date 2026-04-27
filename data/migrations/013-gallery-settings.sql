-- Migration 013: Gallery-specific bio and appearance settings
-- bio:      optional gallery description; when NULL the public page falls back to the user's profile bio
-- settings: JSON bag for appearance/customization (background_color, etc.) — extensible without further migrations

ALTER TABLE user_gallery
  ADD COLUMN bio TEXT DEFAULT NULL AFTER gallery_name,
  ADD COLUMN settings JSON DEFAULT NULL AFTER bio;
