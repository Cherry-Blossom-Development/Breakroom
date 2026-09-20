-- Migration 077: Discover ordering by real activity, not settings edits
--
-- Discover's three sections (Showcases, Galleries, Blogs -- see the
-- '/public' endpoints in storefront.js, gallery.js, blog.js) used to sort
-- each list by user_storefront/user_gallery/user_blog.updated_at. That
-- column only moves when the artist edits the page's own settings (name,
-- url, bio, ...) -- adding a new product, artwork, or post never touched
-- it, so an artist who kept posting fresh work without ever revisiting
-- Settings would silently sink to the bottom.
--
-- discover_activity_at is the real "last meaningful activity" timestamp:
-- the more recent of the settings row's own updated_at and the newest
-- QUALIFYING child row -- the same rows each '/public' query already
-- counts (published artwork, imaged product, published+unhidden post).
-- It's recalculated and written back by
-- backend/utilities/discoverActivity.js, called from every save endpoint
-- that could move it, so Discover's ORDER BY stays a plain indexed column
-- read instead of a live cross-table aggregate on every page load.
--
-- Backfilled here from current data so existing listings sort correctly
-- immediately, before any new save triggers a recalculation.

ALTER TABLE user_gallery
  ADD COLUMN discover_activity_at TIMESTAMP NULL AFTER is_public;
UPDATE user_gallery ug
  SET discover_activity_at = GREATEST(
    ug.updated_at,
    COALESCE((SELECT MAX(ga.updated_at) FROM gallery_artworks ga
                WHERE ga.user_id = ug.user_id AND ga.is_published = TRUE), ug.updated_at)
  );
DROP INDEX idx_gallery_public ON user_gallery;
CREATE INDEX idx_gallery_public ON user_gallery(is_public, discover_activity_at DESC);

ALTER TABLE user_storefront
  ADD COLUMN discover_activity_at TIMESTAMP NULL AFTER is_public;
UPDATE user_storefront us
  SET discover_activity_at = GREATEST(
    us.updated_at,
    COALESCE((SELECT MAX(ci.updated_at) FROM collection_items ci
                WHERE ci.user_id = us.user_id AND ci.image_path IS NOT NULL), us.updated_at)
  );
DROP INDEX idx_storefront_public ON user_storefront;
CREATE INDEX idx_storefront_public ON user_storefront(is_public, discover_activity_at DESC);

ALTER TABLE user_blog
  ADD COLUMN discover_activity_at TIMESTAMP NULL AFTER is_public;
UPDATE user_blog ub
  SET discover_activity_at = GREATEST(
    ub.updated_at,
    COALESCE((SELECT MAX(bp.updated_at) FROM blog_posts bp
                WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE), ub.updated_at)
  );
DROP INDEX idx_blog_public ON user_blog;
CREATE INDEX idx_blog_public ON user_blog(is_public, discover_activity_at DESC);
