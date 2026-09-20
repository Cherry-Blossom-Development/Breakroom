-- Migration 076: Discover directory support for Blogs
-- is_public: opt-in flag for listing a user's blog in the Discover browse
-- page, mirroring user_gallery.is_public (migration 050) and
-- user_storefront.is_public (migration 051). Unlike those two, this
-- defaults to TRUE -- existing and new blogs are discoverable unless the
-- author explicitly opts out, per product decision.

ALTER TABLE user_blog
  ADD COLUMN is_public BOOLEAN DEFAULT TRUE AFTER blog_name;

CREATE INDEX idx_blog_public ON user_blog(is_public, updated_at DESC);
