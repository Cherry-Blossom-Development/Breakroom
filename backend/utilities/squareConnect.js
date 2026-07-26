// Lazy access-token refresh for connected Square sellers. Access tokens expire in 30
// days; refresh tokens (code-flow, non-PKCE grant, which is what we use) are multi-use
// and never expire, so there's no separate expiry to track for them.
//
// Refresh happens on demand, right before a Square API call needs to act on a seller's
// behalf (e.g. CreatePayment at checkout) -- not on a schedule. Connect payments only
// happen when someone buys something, so a polling job would mostly do nothing.

const { SquareError } = require('square');
const { getClient } = require('./db');
const { getSquare, getSquareClientForToken } = require('./square');
const tokenCrypto = require('./token-crypto');

const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000; // refresh a day early rather than cutting it close

// Returns { accessToken, merchantId } for the user's connected Square account, refreshing
// first if the stored access token is expired or close to it. Throws if the user has no
// connected Square account.
async function getValidAccessToken(userId) {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT processor_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at
       FROM user_payment_connect WHERE user_id = $1 AND processor = $2`,
      [userId, 'square']
    );

    if (result.rowCount === 0) {
      throw new Error(`No connected Square account for user ${userId}`);
    }

    const row = result.rows[0];
    const expiresAt = new Date(row.token_expires_at);
    const needsRefresh = Number.isNaN(expiresAt.getTime()) || (expiresAt.getTime() - Date.now()) < REFRESH_BUFFER_MS;

    if (!needsRefresh) {
      return {
        accessToken: tokenCrypto.decrypt(row.access_token_encrypted),
        merchantId: row.processor_account_id
      };
    }

    const refreshToken = tokenCrypto.decrypt(row.refresh_token_encrypted);
    const tokenResponse = await getSquare().oAuth.obtainToken({
      clientId: process.env.SQUARE_APPLICATION_ID,
      clientSecret: process.env.SQUARE_APPLICATION_SECRET,
      refreshToken,
      grantType: 'refresh_token'
    });

    const { accessToken, refreshToken: newRefreshToken, expiresAt: newExpiresAt, merchantId } = tokenResponse;

    await client.query(
      `UPDATE user_payment_connect
       SET access_token_encrypted = $1, refresh_token_encrypted = $2, token_expires_at = $3
       WHERE user_id = $4 AND processor = $5`,
      [tokenCrypto.encrypt(accessToken), tokenCrypto.encrypt(newRefreshToken), new Date(newExpiresAt), userId, 'square']
    );

    return { accessToken, merchantId: merchantId || row.processor_account_id };
  } finally {
    client.release();
  }
}

// Verifies a connected seller's account is genuinely active on Square's side, rather
// than trusting the locally cached `onboarding_complete` flag. If Square reports the
// connection is no longer authorized (401/403 -- seller revoked access from their own
// Square Dashboard, or Square itself restricted the account), the local row is deleted
// so the seller is offered a fresh /connect/start instead of a falsely "connected" UI.
// A transient/network failure does NOT delete the connection -- that would force a
// seller to reconnect over a momentary blip, which is worse than briefly showing a
// stale status.
async function checkConnectionStatus(userId) {
  let accessToken, merchantId;
  try {
    ({ accessToken, merchantId } = await getValidAccessToken(userId));
  } catch (err) {
    return 'not_connected';
  }

  try {
    const sellerClient = getSquareClientForToken(accessToken);
    const { merchant } = await sellerClient.merchants.get({ merchantId });
    return merchant && merchant.status === 'ACTIVE' ? 'active' : 'pending';
  } catch (err) {
    if (err instanceof SquareError && (err.statusCode === 401 || err.statusCode === 403)) {
      const client = await getClient();
      try {
        await client.query(
          'DELETE FROM user_payment_connect WHERE user_id = $1 AND processor = $2',
          [userId, 'square']
        );
      } finally {
        client.release();
      }
      return 'not_connected';
    }
    console.error(`Square merchant status check failed for user ${userId} (non-auth error):`, err.message);
    return 'pending';
  }
}

module.exports = { getValidAccessToken, checkConnectionStatus };
