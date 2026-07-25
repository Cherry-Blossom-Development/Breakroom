-- Generic processor-agnostic rename for the Stripe -> Square migration.
-- See docs/stripe-to-square-migration.md ("Open decisions" #2) for the rationale.

RENAME TABLE user_stripe_connect TO user_payment_connect;

ALTER TABLE user_payment_connect
  CHANGE COLUMN stripe_account_id processor_account_id VARCHAR(255) NOT NULL,
  ADD COLUMN processor ENUM('stripe','square') NOT NULL DEFAULT 'stripe' AFTER user_id;

RENAME TABLE user_stripe_customers TO user_payment_customers;

ALTER TABLE user_payment_customers
  CHANGE COLUMN stripe_customer_id processor_customer_id VARCHAR(255) NOT NULL,
  ADD COLUMN processor ENUM('stripe','square') NOT NULL DEFAULT 'stripe' AFTER user_id;

ALTER TABLE orders
  CHANGE COLUMN stripe_payment_intent_id payment_intent_id VARCHAR(255) DEFAULT NULL,
  CHANGE COLUMN stripe_connected_account_id payment_connected_account_id VARCHAR(255) DEFAULT NULL,
  ADD COLUMN payment_processor ENUM('stripe','square') NOT NULL DEFAULT 'stripe' AFTER total_cents;

-- user_subscriptions.platform is already processor-agnostic (shared with Apple/Google IAP) -- just add 'square'
ALTER TABLE user_subscriptions
  MODIFY COLUMN platform ENUM('google', 'apple', 'promo', 'stripe', 'square') NOT NULL;
