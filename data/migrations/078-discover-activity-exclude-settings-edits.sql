-- Migration 078: Discover activity should not follow settings edits
--
-- Migration 077 added discover_activity_at to rank Discover's Showcases/
-- Galleries/Blogs sections by real content activity instead of settings
-- edits, but its formula still included the settings row's own updated_at
-- in the GREATEST(). Since updated_at has ON UPDATE CURRENT_TIMESTAMP, any
-- settings-only save (bio, name, url, is_public -- no new content at all)
-- bumped updated_at to now, which flowed straight into discover_activity_at
-- and reordered Discover. That's the exact bug 077 was meant to fix.
--
-- backend/utilities/discoverActivity.js now uses created_at (immutable)
-- instead of updated_at in the GREATEST(). This backfills existing rows
-- with the corrected formula so already-polluted timestamps (from settings
-- saves made before this fix) are cleared out immediately, rather than
-- waiting for the next content change to self-correct.

UPDATE user_gallery ug
  SET discover_activity_at = GREATEST(
    ug.created_at,
    COALESCE((SELECT MAX(ga.updated_at) FROM gallery_artworks ga
                WHERE ga.user_id = ug.user_id AND ga.is_published = TRUE), ug.created_at)
  );

UPDATE user_storefront us
  SET discover_activity_at = GREATEST(
    us.created_at,
    COALESCE((SELECT MAX(ci.updated_at) FROM collection_items ci
                WHERE ci.user_id = us.user_id AND ci.image_path IS NOT NULL), us.created_at)
  );

UPDATE user_blog ub
  SET discover_activity_at = GREATEST(
    ub.created_at,
    COALESCE((SELECT MAX(bp.updated_at) FROM blog_posts bp
                WHERE bp.user_id = ub.user_id AND bp.is_published = TRUE AND bp.is_hidden = FALSE), ub.created_at)
  );
