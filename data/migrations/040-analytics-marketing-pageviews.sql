-- Migration 040: Pre-signup marketing pageview tracking
-- Records one row per (session, page) touch on the public /explore pages,
-- mirroring analytics_feature_usage but kept separate since this is
-- anonymous pre-signup interest, not authenticated in-app usage.
-- signup_visitor_id lets a later signup be correlated back to whichever
-- marketing pages that visitor_id had viewed (see GET /api/analytics/marketing-pages).

CREATE TABLE analytics_marketing_pageviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page VARCHAR(64) NOT NULL,
  visitor_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_marketing_pageviews_created (created_at),
  INDEX idx_marketing_pageviews_page (page),
  INDEX idx_marketing_pageviews_visitor (visitor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN signup_visitor_id VARCHAR(64) NULL;
