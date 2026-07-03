ALTER TABLE custom_domains
  ADD COLUMN content_type ENUM('storefront','band_page') NOT NULL DEFAULT 'storefront' AFTER user_id,
  ADD COLUMN band_id INT NULL AFTER content_type,
  ADD CONSTRAINT fk_custom_domains_band FOREIGN KEY (band_id) REFERENCES bands(id) ON DELETE CASCADE;
