-- Migration 039: Per-feature usage tracking
-- Records one row per (session, feature) touch, mirroring the analytics_visits
-- pattern. Feature keys are a fixed application-level registry, not a FK.

CREATE TABLE analytics_feature_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  feature VARCHAR(64) NOT NULL,
  visitor_id VARCHAR(64) NOT NULL,
  user_id INT NULL,
  platform ENUM('web','android','ios') NOT NULL DEFAULT 'web',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_feature_usage_created (created_at),
  INDEX idx_feature_usage_feature (feature),
  INDEX idx_feature_usage_platform (platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
