-- Creation Logs Schema
-- Date: 2026-05-01
-- Tracks the device/browser context at the time any record is created.

CREATE TABLE IF NOT EXISTS creation_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  reference_table VARCHAR(64)  NOT NULL,
  reference_id    INT          NOT NULL,
  user_id         INT          NULL,
  ip_address      VARCHAR(45)  NULL,
  user_agent      TEXT         NULL,
  device_type     VARCHAR(32)  NULL,
  browser_name    VARCHAR(64)  NULL,
  browser_version VARCHAR(32)  NULL,
  os_name         VARCHAR(64)  NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cl_reference  (reference_table, reference_id),
  INDEX idx_cl_user       (user_id),
  INDEX idx_cl_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
