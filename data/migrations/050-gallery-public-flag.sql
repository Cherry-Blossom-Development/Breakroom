-- Migration 050: Public Galleries directory
-- is_public: opt-in flag for listing an artist's gallery in the Public Galleries
-- browse page. Defaults to FALSE so existing galleries stay unlisted (reachable
-- only by direct URL) until the artist explicitly opts in.

ALTER TABLE user_gallery
  ADD COLUMN is_public BOOLEAN DEFAULT FALSE AFTER gallery_name;

CREATE INDEX idx_gallery_public ON user_gallery(is_public, updated_at DESC);
