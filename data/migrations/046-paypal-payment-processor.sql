-- Additive enum change to support PayPal as a second payment processor alongside
-- Square. See docs/multi-processor-payments-architecture.md. No renames, no data
-- migration -- existing rows are untouched, this only widens what new rows can be.

ALTER TABLE user_payment_connect   MODIFY COLUMN processor ENUM('stripe','square','paypal') NOT NULL;
ALTER TABLE user_payment_customers MODIFY COLUMN processor ENUM('stripe','square','paypal') NOT NULL;
ALTER TABLE orders                 MODIFY COLUMN payment_processor ENUM('stripe','square','paypal') NOT NULL DEFAULT 'stripe';
ALTER TABLE user_subscriptions     MODIFY COLUMN platform ENUM('google','apple','promo','stripe','square','paypal') NOT NULL;
