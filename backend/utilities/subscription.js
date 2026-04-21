const { getClient } = require('./db');

async function isSubscribed(userId) {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT status, platform, expires_at FROM user_subscriptions
       WHERE user_id = $1 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    if (result.rowCount === 0) return { subscribed: false };
    const { status, platform, expires_at } = result.rows[0];
    return { subscribed: true, status, platform, expires_at };
  } finally {
    client.release();
  }
}

module.exports = { isSubscribed };
