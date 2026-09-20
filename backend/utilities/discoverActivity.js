// Recalculates and persists each Discover-eligible entity's
// discover_activity_at (migration 077) -- the "last meaningful activity"
// timestamp used to order the Showcases/Galleries/Blogs sections on the
// Discover page. Computed as the more recent of the settings row's own
// updated_at and the newest QUALIFYING child row -- the same rows each
// entity's '/public' directory query already counts (published artwork,
// imaged product, published+unhidden post). Call one of these after any
// save that could move it: the entity's own settings, or create/update/
// delete of its child content. Keeping this precomputed means Discover's
// ORDER BY is a plain indexed column read, not a live cross-table
// aggregate recomputed on every page load.

async function recalcGalleryDiscoverActivity(client, userId) {
  await client.query(
    `UPDATE user_gallery
     SET discover_activity_at = GREATEST(
       updated_at,
       COALESCE((SELECT MAX(updated_at) FROM gallery_artworks WHERE user_id = $1 AND is_published = TRUE), updated_at)
     )
     WHERE user_id = $1`,
    [userId]
  );
}

async function recalcStorefrontDiscoverActivity(client, userId) {
  await client.query(
    `UPDATE user_storefront
     SET discover_activity_at = GREATEST(
       updated_at,
       COALESCE((SELECT MAX(updated_at) FROM collection_items WHERE user_id = $1 AND image_path IS NOT NULL), updated_at)
     )
     WHERE user_id = $1`,
    [userId]
  );
}

async function recalcBlogDiscoverActivity(client, userId) {
  await client.query(
    `UPDATE user_blog
     SET discover_activity_at = GREATEST(
       updated_at,
       COALESCE((SELECT MAX(updated_at) FROM blog_posts WHERE user_id = $1 AND is_published = TRUE AND is_hidden = FALSE), updated_at)
     )
     WHERE user_id = $1`,
    [userId]
  );
}

module.exports = {
  recalcGalleryDiscoverActivity,
  recalcStorefrontDiscoverActivity,
  recalcBlogDiscoverActivity
};
