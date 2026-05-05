CREATE TABLE IF NOT EXISTS user_shipping_settings (
  id int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id int(11) NOT NULL UNIQUE,
  address_line1 VARCHAR(255) NULL,
  address_line2 VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state_region VARCHAR(100) NULL,
  zip VARCHAR(20) NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'US',
  ship_destinations VARCHAR(50) NOT NULL DEFAULT 'us_only',
  processing_time VARCHAR(50) NOT NULL DEFAULT '1_2_days',
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  CONSTRAINT user_shipping_settings_ibfk_1 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
