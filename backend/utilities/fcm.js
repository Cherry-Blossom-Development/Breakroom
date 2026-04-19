const path = require('path');
const { getClient } = require('./db');

let adminApp = null;

function getAdminApp() {
  if (adminApp) return adminApp;

  const admin = require('firebase-admin');

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  let credential;
  if (serviceAccountJson) {
    credential = admin.credential.cert(JSON.parse(serviceAccountJson));
  } else if (serviceAccountPath) {
    const resolved = path.resolve(serviceAccountPath);
    credential = admin.credential.cert(require(resolved));
  } else {
    throw new Error('Firebase service account not configured (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH)');
  }

  adminApp = admin.initializeApp({ credential });
  return adminApp;
}

/**
 * Send an FCM data message to all registered devices for a single user.
 * @param {number} userId
 * @param {Object} payload  key/value pairs (all values will be coerced to strings)
 */
async function sendToUser(userId, payload) {
  return sendToUsers([userId], payload);
}

/**
 * Send an FCM data message to all registered devices for a list of users.
 * @param {number[]} userIds
 * @param {Object} payload
 */
async function sendToUsers(userIds, payload) {
  if (!userIds || userIds.length === 0) return;

  const client = await getClient();
  let tokens;
  try {
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await client.query(
      `SELECT fcm_token FROM user_fcm_tokens WHERE user_id IN (${placeholders})`,
      userIds
    );
    tokens = result.rows.map(r => r.fcm_token);
  } finally {
    client.release();
  }

  if (tokens.length === 0) return;
  await sendToTokens(tokens, payload);
}

/**
 * Send an FCM data message to a list of raw tokens.
 * Stale tokens (registration-token-not-registered) are pruned automatically.
 * @param {string[]} tokens
 * @param {Object} payload
 */
async function sendToTokens(tokens, payload) {
  if (!tokens || tokens.length === 0) return;

  try {
    getAdminApp();
  } catch (err) {
    console.error('[FCM] Firebase not configured, skipping notification:', err.message);
    return;
  }

  // FCM data payloads only accept string values
  const data = {};
  for (const [k, v] of Object.entries(payload)) {
    data[k] = String(v);
  }

  try {
    const messaging = require('firebase-admin').messaging();

    // Build notification title and body based on payload type
    let title = 'Breakroom';
    let body = 'You have a new notification';

    if (data.type === 'chat_message') {
      title = data.roomName || 'Chat';
      body = `${data.senderHandle}: ${data.message}`;
    } else if (data.type === 'friend_request') {
      title = 'Friend Request';
      body = `${data.senderHandle} sent you a friend request`;
    } else if (data.type === 'blog_comment') {
      title = 'New Comment';
      body = `${data.commenterHandle}: ${data.comment}`;
    }

    // Include both notification (for iOS background) and data payload
    const message = {
      tokens,
      data,
      notification: {
        title,
        body
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await messaging.sendEachForMulticast(message);

    // Prune stale tokens
    const staleTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success &&
          resp.error?.code === 'messaging/registration-token-not-registered') {
        staleTokens.push(tokens[idx]);
      }
    });

    if (staleTokens.length > 0) {
      const client = await getClient();
      try {
        const placeholders = staleTokens.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `DELETE FROM user_fcm_tokens WHERE fcm_token IN (${placeholders})`,
          staleTokens
        );
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.error('[FCM] Error sending notification:', err.message);
  }
}

module.exports = { sendToUser, sendToUsers };
