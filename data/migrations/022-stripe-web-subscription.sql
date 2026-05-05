-- Allow 'stripe' as a subscription platform (web checkout)
ALTER TABLE user_subscriptions
  MODIFY COLUMN platform ENUM('google', 'apple', 'promo', 'stripe') NOT NULL;

-- Store Stripe customer IDs for web subscribers
CREATE TABLE IF NOT EXISTS user_stripe_customers (
  user_id INT NOT NULL PRIMARY KEY,
  stripe_customer_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_stripe_customers_ibfk_1 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
