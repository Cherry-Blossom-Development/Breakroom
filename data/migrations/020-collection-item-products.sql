ALTER TABLE collection_items
  ADD COLUMN price_cents INT NULL AFTER description,
  ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 0 AFTER price_cents,
  ADD COLUMN shipping_cost_cents INT NULL AFTER is_available,
  ADD COLUMN weight_oz DECIMAL(8,2) NULL AFTER shipping_cost_cents,
  ADD COLUMN length_in DECIMAL(8,2) NULL AFTER weight_oz,
  ADD COLUMN width_in DECIMAL(8,2) NULL AFTER length_in,
  ADD COLUMN height_in DECIMAL(8,2) NULL AFTER width_in;
