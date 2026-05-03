ALTER TABLE user_storefront
  ADD COLUMN store_url VARCHAR(100) NULL UNIQUE AFTER user_id;
