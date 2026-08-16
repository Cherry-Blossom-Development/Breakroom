-- Migration 051: Discover directory support for Artist Showcases
-- is_public: opt-in flag for listing an artist's storefront in the Discover
-- browse page, mirroring user_gallery.is_public (migration 050). Defaults to
-- FALSE so existing storefronts stay unlisted until the artist opts in.

ALTER TABLE user_storefront
  ADD COLUMN is_public BOOLEAN DEFAULT FALSE AFTER page_title;

CREATE INDEX idx_storefront_public ON user_storefront(is_public, updated_at DESC);
