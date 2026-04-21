const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const { AppStoreServerAPIClient, Environment, SignedDataVerifier } = require('@apple/app-store-server-library');
const fs = require('fs');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;

const isSandbox = process.env.SUBSCRIPTION_ENV !== 'production';

// --- Google Play auth client (lazy-initialized) ---
let googleAuth;
function getGoogleAuth() {
  if (!googleAuth) {
    googleAuth = new GoogleAuth({
      keyFile: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  }
  return googleAuth;
}

async function verifyGooglePurchase(purchaseToken, productId) {
  const auth = getGoogleAuth();
  const authClient = await auth.getClient();
  const { token } = await authClient.getAccessToken();
  const pkg = process.env.GOOGLE_PLAY_PACKAGE_NAME;
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Play API error ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Apple App Store client (lazy-initialized) ---
let appleClient;
let appleVerifier;
function getAppleClient() {
  if (!appleClient) {
    const privateKey = fs.readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8');
    const env = isSandbox ? Environment.SANDBOX : Environment.PRODUCTION;
    appleClient = new AppStoreServerAPIClient(
      privateKey,
      process.env.APPLE_KEY_ID,
      process.env.APPLE_ISSUER_ID,
      process.env.APPLE_BUNDLE_ID,
      env
    );
  }
  return appleClient;
}

function getAppleVerifier() {
  if (!appleVerifier) {
    const privateKey = fs.readFileSync(process.env.APPLE_PRIVATE_KEY_PATH, 'utf8');
    const env = isSandbox ? Environment.SANDBOX : Environment.PRODUCTION;
    appleVerifier = new SignedDataVerifier(
      [],    // apple root certs — empty = use built-in roots from the library
      true,  // enable online revocation checks
      env,
      process.env.APPLE_BUNDLE_ID
    );
  }
  return appleVerifier;
}

// --- Shared auth middleware ---
const authenticate = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// GET /api/subscriptions/me — return current user's subscription status
router.get('/me', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT platform, status, expires_at, created_at FROM user_subscriptions WHERE user_id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) {
      return res.json({ subscribed: false, subscription: null });
    }
    const sub = result.rows[0];
    const active = sub.status === 'active' && (!sub.expires_at || new Date(sub.expires_at) > new Date());
    res.json({ subscribed: active, subscription: sub });
  } catch (err) {
    console.error('Error fetching subscription:', err);
    res.status(500).json({ message: 'Failed to fetch subscription' });
  } finally {
    client.release();
  }
});

// POST /api/subscriptions/google/verify — verify a Google Play purchase and activate subscription
router.post('/google/verify', authenticate, async (req, res) => {
  const { purchaseToken, productId } = req.body;
  if (!purchaseToken || !productId) {
    return res.status(400).json({ message: 'purchaseToken and productId are required' });
  }

  let purchase;
  try {
    purchase = await verifyGooglePurchase(purchaseToken, productId);
  } catch (err) {
    console.error('Google Play verification error:', err);
    return res.status(400).json({ message: 'Purchase verification failed' });
  }

  // paymentState: 0=pending, 1=received, 2=free trial, 3=pending deferred upgrade
  if (purchase.paymentState === 0) {
    return res.status(402).json({ message: 'Payment pending' });
  }

  const expiresAt = purchase.expiryTimeMillis
    ? new Date(parseInt(purchase.expiryTimeMillis, 10))
    : null;

  const client = await getClient();
  try {
    await client.query(
      `INSERT INTO user_subscriptions (user_id, platform, platform_subscription_id, status, expires_at)
       VALUES ($1, 'google', $2, 'active', $3)
       ON DUPLICATE KEY UPDATE
         platform = 'google',
         platform_subscription_id = $2,
         status = 'active',
         expires_at = $3,
         updated_at = NOW()`,
      [req.user.id, purchaseToken, expiresAt]
    );
    res.json({ message: 'Subscription activated', expires_at: expiresAt });
  } catch (err) {
    console.error('Error saving Google subscription:', err);
    res.status(500).json({ message: 'Failed to save subscription' });
  } finally {
    client.release();
  }
});

// POST /api/subscriptions/apple/verify — verify an Apple StoreKit purchase and activate subscription
router.post('/apple/verify', authenticate, async (req, res) => {
  const { originalTransactionId } = req.body;
  if (!originalTransactionId) {
    return res.status(400).json({ message: 'originalTransactionId is required' });
  }

  let subscriptionStatuses;
  try {
    const appleApiClient = getAppleClient();
    subscriptionStatuses = await appleApiClient.getAllSubscriptionStatuses(originalTransactionId);
  } catch (err) {
    console.error('Apple App Store verification error:', err);
    return res.status(400).json({ message: 'Purchase verification failed' });
  }

  // Find the most recent active subscription across all product groups
  let expiresAt = null;
  let isActive = false;
  for (const group of subscriptionStatuses.data) {
    for (const item of group.lastTransactions) {
      // status: 1=active, 2=expired, 3=billing retry, 4=billing grace period, 5=revoked
      if (item.status === 1 || item.status === 4) {
        isActive = true;
        const decoded = await getAppleVerifier().verifyAndDecodeTransaction(item.signedTransactionInfo);
        if (decoded.expiresDate) {
          const exp = new Date(decoded.expiresDate);
          if (!expiresAt || exp > expiresAt) expiresAt = exp;
        }
      }
    }
  }

  if (!isActive) {
    return res.status(402).json({ message: 'No active subscription found' });
  }

  const client = await getClient();
  try {
    await client.query(
      `INSERT INTO user_subscriptions (user_id, platform, platform_subscription_id, status, expires_at)
       VALUES ($1, 'apple', $2, 'active', $3)
       ON DUPLICATE KEY UPDATE
         platform = 'apple',
         platform_subscription_id = $2,
         status = 'active',
         expires_at = $3,
         updated_at = NOW()`,
      [req.user.id, originalTransactionId, expiresAt]
    );
    res.json({ message: 'Subscription activated', expires_at: expiresAt });
  } catch (err) {
    console.error('Error saving Apple subscription:', err);
    res.status(500).json({ message: 'Failed to save subscription' });
  } finally {
    client.release();
  }
});

// POST /api/subscriptions/google/webhook — Google Play Real-Time Developer Notifications (Pub/Sub push)
router.post('/google/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const body = JSON.parse(req.body.toString());
    const data = JSON.parse(Buffer.from(body.message.data, 'base64').toString());
    const notification = data.subscriptionNotification;

    // Acknowledge immediately — Pub/Sub resends if we don't respond 200 quickly
    res.status(200).end();

    if (!notification) return; // test notification or one-time product, not a subscription

    const { purchaseToken, productId, notificationType } = notification;

    // notificationType reference:
    // 1=RECOVERED, 2=RENEWED, 4=PURCHASED, 7=RESTARTED → active
    // 3=CANCELED, 5=ON_HOLD, 6=IN_GRACE_PERIOD, 12=EXPIRED, 13=REVOKED → update status
    const activeTypes = [1, 2, 4, 7];
    const cancelledTypes = [3];
    const expiredTypes = [12, 13];
    const gracePeriodTypes = [6];

    let newStatus;
    if (activeTypes.includes(notificationType)) {
      newStatus = 'active';
    } else if (cancelledTypes.includes(notificationType)) {
      newStatus = 'cancelled';
    } else if (expiredTypes.includes(notificationType)) {
      newStatus = 'expired';
    } else if (gracePeriodTypes.includes(notificationType)) {
      newStatus = 'grace_period';
    } else {
      return; // ON_HOLD (5), RESTARTED handled above, PRICE_CHANGE_CONFIRMED etc — no action needed
    }

    // Re-verify to get latest expiry time
    let expiresAt = null;
    try {
      const purchase = await verifyGooglePurchase(purchaseToken, productId);
      expiresAt = purchase.expiryTimeMillis
        ? new Date(parseInt(purchase.expiryTimeMillis, 10))
        : null;
    } catch (err) {
      console.error('Google webhook re-verification failed:', err);
    }

    const client = await getClient();
    try {
      await client.query(
        `UPDATE user_subscriptions
         SET status = $1, expires_at = $2, updated_at = NOW()
         WHERE platform_subscription_id = $3 AND platform = 'google'`,
        [newStatus, expiresAt, purchaseToken]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Google webhook error:', err);
    res.status(200).end(); // Always 200 to prevent Pub/Sub retry storms
  }
});

// POST /api/subscriptions/apple/webhook — Apple App Store Server Notifications (signed JWS)
router.post('/apple/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  // Always 200 immediately — Apple retries on non-200
  res.status(200).end();

  try {
    const body = JSON.parse(req.body.toString());
    const { signedPayload } = body;
    if (!signedPayload) return;

    const notification = await getAppleVerifier().verifyAndDecodeNotification(signedPayload);
    const { notificationType, data } = notification;
    if (!data) return;

    const transactionInfo = await getAppleVerifier().verifyAndDecodeTransaction(data.signedTransactionInfo);
    const { originalTransactionId, expiresDate } = transactionInfo;
    const expiresAt = expiresDate ? new Date(expiresDate) : null;

    // notificationType reference:
    // SUBSCRIBED, DID_RENEW → active
    // EXPIRED, REVOKE → expired
    // DID_FAIL_TO_RENEW (with gracePeriod) → grace_period
    // DID_FAIL_TO_RENEW (no grace) → cancelled
    const activeTypes = ['SUBSCRIBED', 'DID_RENEW'];
    const expiredTypes = ['EXPIRED', 'REVOKE'];
    const failedTypes = ['DID_FAIL_TO_RENEW'];

    let newStatus;
    if (activeTypes.includes(notificationType)) {
      newStatus = 'active';
    } else if (expiredTypes.includes(notificationType)) {
      newStatus = 'expired';
    } else if (failedTypes.includes(notificationType)) {
      // subtype GRACE_PERIOD means Apple is still retrying billing
      newStatus = notification.subtype === 'GRACE_PERIOD' ? 'grace_period' : 'cancelled';
    } else {
      return;
    }

    const client = await getClient();
    try {
      await client.query(
        `UPDATE user_subscriptions
         SET status = $1, expires_at = $2, updated_at = NOW()
         WHERE platform_subscription_id = $3 AND platform = 'apple'`,
        [newStatus, expiresAt, originalTransactionId]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Apple webhook error:', err);
  }
});

// POST /api/subscriptions/admin/grant — grant or revoke a promo subscription (requires create_billing permission)
router.post('/admin/grant', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    // Check create_billing permission
    const perm = await client.query(
      `SELECT up.id FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = $1 AND p.name = 'create_billing'
       UNION
       SELECT gp.id FROM user_groups ug
       JOIN group_permissions gp ON gp.group_id = ug.group_id
       JOIN permissions p ON p.id = gp.permission_id
       WHERE ug.user_id = $1 AND p.name = 'create_billing'
       LIMIT 1`,
      [req.user.id]
    );
    if (perm.rowCount === 0) return res.status(403).json({ message: 'Permission denied' });

    const { handle, action } = req.body; // action: 'grant' | 'revoke'
    if (!handle || !['grant', 'revoke'].includes(action)) {
      return res.status(400).json({ message: 'handle and action (grant|revoke) are required' });
    }

    const target = await client.query('SELECT id FROM users WHERE handle = $1', [handle.trim()]);
    if (target.rowCount === 0) return res.status(404).json({ message: 'User not found' });
    const targetId = target.rows[0].id;

    if (action === 'grant') {
      await client.query(
        `INSERT INTO user_subscriptions (user_id, platform, platform_subscription_id, status, expires_at)
         VALUES ($1, 'promo', 'promo', 'active', NULL)
         ON DUPLICATE KEY UPDATE
           platform = 'promo',
           platform_subscription_id = 'promo',
           status = 'active',
           expires_at = NULL,
           updated_at = NOW()`,
        [targetId]
      );
      res.json({ message: `Promo subscription granted to @${handle}` });
    } else {
      await client.query(
        `UPDATE user_subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`,
        [targetId]
      );
      res.json({ message: `Subscription revoked for @${handle}` });
    }
  } catch (err) {
    console.error('Error managing promo subscription:', err);
    res.status(500).json({ message: 'Failed to update subscription' });
  } finally {
    client.release();
  }
});

module.exports = router;
