-- Square OAuth requires storing per-seller access/refresh tokens, unlike Stripe Connect
-- (which only needed the account id). Tokens are stored encrypted at rest -- see
-- backend/utilities/token-crypto.js.

ALTER TABLE user_payment_connect
  ADD COLUMN access_token_encrypted TEXT NULL AFTER processor_account_id,
  ADD COLUMN refresh_token_encrypted TEXT NULL AFTER access_token_encrypted,
  ADD COLUMN token_expires_at DATETIME NULL AFTER refresh_token_encrypted;
