const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { sendMail } = require('../utilities/aws-ses-email');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

let _stripe = null;
function getStripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

async function getSellerFeePercent(userId, client) {
  const result = await client.query(
    `SELECT status, expires_at FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (result.rowCount === 0) return 5;
  const sub = result.rows[0];
  const active = sub.status === 'active' && (!sub.expires_at || new Date(sub.expires_at) > new Date());
  return active ? 0 : 5;
}

const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query('SELECT id, handle FROM users WHERE handle = $1', [payload.username]);
    client.release();
    if (result.rowCount === 0) return res.status(401).json({ message: 'User not found' });
    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const parseSettings = (row) => {
  if (row && typeof row.settings === 'string') {
    try { row.settings = JSON.parse(row.settings); } catch { row.settings = {}; }
  }
  return row;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$|^[a-z0-9]{3}$/;

const DEFAULT_SECTIONS = [
  { id: 'content', type: 'content', visible: true },
  { id: 'collections', type: 'collections', visible: true, title: 'My Collections' }
];

// GET /api/storefront/public/:storeUrl  (no auth — must be before /)
router.get('/public/:storeUrl', async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT user_id, page_title, content, settings FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Store not found' });

    const row = parseSettings(result.rows[0]);
    const sections = (row.settings && row.settings.sections) ? row.settings.sections : DEFAULT_SECTIONS;

    const collectionsVisible = sections.some(s => s.type === 'collections' && s.visible);
    let collections = [];
    if (collectionsVisible) {
      const colResult = await client.query(
        'SELECT id, name, settings FROM user_collections WHERE user_id = $1 ORDER BY display_order ASC, created_at ASC',
        [row.user_id]
      );
      collections = colResult.rows.map(c => {
        if (c.settings && typeof c.settings === 'string') {
          try { c.settings = JSON.parse(c.settings); } catch { c.settings = {}; }
        }
        return c;
      });
    }

    res.json({
      page_title: row.page_title,
      content: row.content,
      settings: row.settings,
      sections,
      collections
    });
  } catch (err) {
    console.error('Failed to fetch public storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront/public/:storeUrl/collection/:collectionId  (no auth)
router.get('/public/:storeUrl/collection/:collectionId', async (req, res) => {
  let client;
  try {
    client = await getClient();
    // Resolve storeUrl → user_id
    const storeResult = await client.query(
      'SELECT user_id, page_title, settings FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (storeResult.rowCount === 0) return res.status(404).json({ message: 'Store not found' });

    const { user_id } = storeResult.rows[0];

    // Fetch collection — must belong to this store's owner
    const colResult = await client.query(
      'SELECT id, name, settings FROM user_collections WHERE id = $1 AND user_id = $2',
      [req.params.collectionId, user_id]
    );
    if (colResult.rowCount === 0) return res.status(404).json({ message: 'Collection not found' });

    const collection = parseSettings(colResult.rows[0]);

    // Fetch all gallery items (including sold ones so they show as "Sold")
    const itemResult = await client.query(
      `SELECT id, name, description, image_path, price_cents, is_available, shipping_cost_cents,
              weight_oz, length_in, width_in, height_in
       FROM collection_items
       WHERE collection_id = $1 AND in_gallery = 1
       ORDER BY is_available DESC, display_order ASC, created_at ASC`,
      [req.params.collectionId]
    );

    res.json({
      store_url: req.params.storeUrl,
      store_title: storeResult.rows[0].page_title,
      collection,
      items: itemResult.rows
    });
  } catch (err) {
    console.error('Failed to fetch public collection:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront/public/by-domain/:hostname  (no auth) — resolves an active
// custom domain to its store_url. Deliberately thin: the frontend reuses the
// existing storeUrl-based endpoints for everything else once resolved.
router.get('/public/by-domain/:hostname', async (req, res) => {
  const hostname = String(req.params.hostname || '').toLowerCase().replace(/^www\./, '');
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT us.store_url FROM custom_domains cd
       JOIN user_storefront us ON us.user_id = cd.user_id
       WHERE cd.domain = $1 AND cd.status = 'active'`,
      [hostname]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Domain not found' });
    res.json({ store_url: result.rows[0].store_url });
  } catch (err) {
    console.error('Failed to resolve custom domain:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront/check-url/:storeUrl  (auth required)
router.get('/check-url/:storeUrl', authenticate, async (req, res) => {
  const { storeUrl } = req.params;
  if (!SLUG_RE.test(storeUrl)) {
    return res.json({ available: false, reason: 'Use 3–60 lowercase letters, numbers, or hyphens (no leading/trailing hyphens).' });
  }
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT user_id FROM user_storefront WHERE store_url = $1',
      [storeUrl]
    );
    if (result.rowCount === 0) return res.json({ available: true });
    res.json({ available: result.rows[0].user_id === req.user.id });
  } catch (err) {
    console.error('Failed to check store URL:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/storefront
router.get('/', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      'SELECT id, store_url, page_title, content, settings, external_url, updated_at FROM user_storefront WHERE user_id = $1',
      [req.user.id]
    );
    if (result.rowCount === 0) return res.json(null);
    res.json(parseSettings(result.rows[0]));
  } catch (err) {
    console.error('Failed to fetch storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/storefront — upsert
router.put('/', authenticate, async (req, res) => {
  const { store_url, page_title, content, settings, external_url } = req.body;

  if (store_url && !SLUG_RE.test(store_url)) {
    return res.status(400).json({ message: 'Invalid store URL format.' });
  }

  let client;
  try {
    client = await getClient();

    // If a URL is provided, ensure it isn't taken by someone else
    if (store_url) {
      const conflict = await client.query(
        'SELECT user_id FROM user_storefront WHERE store_url = $1 AND user_id != $2',
        [store_url, req.user.id]
      );
      if (conflict.rowCount > 0) {
        client.release();
        return res.status(409).json({ message: 'That store URL is already taken.' });
      }
    }

    const externalUrlValue = external_url && external_url.trim() ? external_url.trim() : null;

    await client.query(
      `INSERT INTO user_storefront (user_id, store_url, page_title, content, settings, external_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON DUPLICATE KEY UPDATE store_url = $2, page_title = $3, content = $4, settings = $5, external_url = $6`,
      [req.user.id, store_url || null, page_title || '', content || '', JSON.stringify(settings || {}), externalUrlValue]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('Failed to save storefront:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/storefront/public/:storeUrl/contact  (no auth)
router.post('/public/:storeUrl/contact', async (req, res) => {
  const { buyer_name, buyer_email, message, item_name } = req.body;

  if (!buyer_name || !buyer_email || !message) {
    return res.status(400).json({ message: 'Name, email, and message are required.' });
  }

  let client;
  try {
    client = await getClient();

    const storeResult = await client.query(
      `SELECT u.email, u.first_name FROM user_storefront us
       JOIN users u ON us.user_id = u.id
       WHERE us.store_url = $1`,
      [req.params.storeUrl]
    );
    if (storeResult.rowCount === 0) return res.status(404).json({ message: 'Store not found' });

    const { email: sellerEmail, first_name: sellerFirst } = storeResult.rows[0];

    const subject = item_name
      ? `Inquiry about "${item_name}" from ${buyer_name}`
      : `Message from ${buyer_name} via your Prosaurus store`;

    const html = `
      <p>Hi ${sellerFirst || 'there'},</p>
      <p>You have a new inquiry${item_name ? ` about <strong>${item_name}</strong>` : ''} from your Prosaurus store.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p><strong>From:</strong> ${buyer_name} &lt;${buyer_email}&gt;</p>
      ${item_name ? `<p><strong>Item:</strong> ${item_name}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p style="white-space:pre-wrap">${message}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p style="color:#888;font-size:0.9em">Reply directly to this email to respond to ${buyer_name}.</p>
      <p>— Prosaurus</p>`;

    await sendMail(sellerEmail, 'noreply@prosaurus.com', subject, html, buyer_email);

    res.json({ message: 'Message sent' });
  } catch (err) {
    console.error('Failed to send contact email:', err);
    res.status(500).json({ message: 'Failed to send message. Please try again.' });
  } finally {
    if (client) client.release();
  }
});

// ─── Checkout ────────────────────────────────────────────────────────────────

// POST /api/storefront/public/:storeUrl/items/:itemId/checkout/intent  (no auth)
router.post('/public/:storeUrl/items/:itemId/checkout/intent', async (req, res) => {
  const { buyer_name, buyer_email, ship_to_name, ship_to_address1, ship_to_address2,
          ship_to_city, ship_to_state, ship_to_zip, ship_to_country } = req.body;

  if (!buyer_name || !buyer_email || !ship_to_name || !ship_to_address1 ||
      !ship_to_city || !ship_to_state || !ship_to_zip) {
    return res.status(400).json({ message: 'All required fields must be filled in.' });
  }

  const country = ship_to_country || 'US';
  let client;
  try {
    client = await getClient();

    // Resolve store → seller
    const storeResult = await client.query(
      'SELECT user_id FROM user_storefront WHERE store_url = $1',
      [req.params.storeUrl]
    );
    if (storeResult.rowCount === 0) return res.status(404).json({ message: 'Store not found' });
    const sellerUserId = storeResult.rows[0].user_id;

    // Fetch item — must be available and belong to this store
    const itemResult = await client.query(
      `SELECT ci.id, ci.name, ci.price_cents, ci.shipping_cost_cents
       FROM collection_items ci
       JOIN user_collections uc ON ci.collection_id = uc.id
       WHERE ci.id = $1 AND uc.user_id = $2 AND ci.is_available = 1`,
      [req.params.itemId, sellerUserId]
    );
    if (itemResult.rowCount === 0) return res.status(404).json({ message: 'Item not available' });
    const item = itemResult.rows[0];

    if (!item.price_cents) return res.status(400).json({ message: 'Item has no price set' });

    // Prevent duplicate checkouts (30-min lock)
    const lockCheck = await client.query(
      `SELECT id FROM orders
       WHERE collection_item_id = $1 AND status = 'pending_payment'
       AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
      [item.id]
    );
    if (lockCheck.rowCount > 0) {
      return res.status(409).json({ message: 'This item is currently being purchased. Please try again in a few minutes.' });
    }

    // Seller must have Stripe Connect
    const connectResult = await client.query(
      'SELECT stripe_account_id FROM user_stripe_connect WHERE user_id = $1 AND onboarding_complete = 1',
      [sellerUserId]
    );
    if (connectResult.rowCount === 0) {
      return res.status(400).json({ message: 'Seller has not completed payment setup' });
    }
    const stripeAccountId = connectResult.rows[0].stripe_account_id;

    const itemPriceCents = item.price_cents;
    const shippingCostCents = item.shipping_cost_cents || 0;
    const totalCents = itemPriceCents + shippingCostCents;

    const feePercent = await getSellerFeePercent(sellerUserId, client);
    const platformFeeCents = Math.round(totalCents * feePercent / 100);

    let paymentIntent;
    try {
      paymentIntent = await getStripe().paymentIntents.create({
        amount: totalCents,
        currency: 'usd',
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: stripeAccountId },
        metadata: { item_id: String(item.id), seller_user_id: String(sellerUserId), buyer_email, buyer_name }
      });
    } catch (stripeErr) {
      if (stripeErr.code === 'resource_missing') {
        // Seller's Connect account ID is stale — clear it so they re-onboard
        await client.query('DELETE FROM user_stripe_connect WHERE user_id = $1', [sellerUserId]);
        return res.status(400).json({ message: 'Seller has not completed payment setup' });
      }
      throw stripeErr;
    }

    const orderResult = await client.query(
      `INSERT INTO orders
         (collection_item_id, seller_user_id, buyer_name, buyer_email,
          ship_to_name, ship_to_address1, ship_to_address2, ship_to_city,
          ship_to_state, ship_to_zip, ship_to_country,
          item_price_cents, shipping_cost_cents, platform_fee_cents, total_cents,
          stripe_payment_intent_id, stripe_connected_account_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending_payment')`,
      [item.id, sellerUserId, buyer_name, buyer_email,
       ship_to_name, ship_to_address1, ship_to_address2 || null, ship_to_city,
       ship_to_state, ship_to_zip, country,
       itemPriceCents, shippingCostCents, platformFeeCents, totalCents,
       paymentIntent.id, stripeAccountId]
    );

    // Store order_id back in PI metadata for webhook lookup
    await getStripe().paymentIntents.update(paymentIntent.id, {
      metadata: { ...paymentIntent.metadata, order_id: String(orderResult.insertId) }
    });

    res.json({
      client_secret: paymentIntent.client_secret,
      order_id: orderResult.insertId,
      item_price_cents: itemPriceCents,
      shipping_cost_cents: shippingCostCents,
      total_cents: totalCents,
    });
  } catch (err) {
    console.error('Failed to create checkout intent:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// ─── Seller order management ──────────────────────────────────────────────────

// GET /api/storefront/orders  (authenticated)
router.get('/orders', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT o.id, o.status, o.buyer_name, o.buyer_email,
              o.ship_to_name, o.ship_to_address1, o.ship_to_address2,
              o.ship_to_city, o.ship_to_state, o.ship_to_zip, o.ship_to_country,
              o.item_price_cents, o.shipping_cost_cents, o.platform_fee_cents, o.total_cents,
              o.tracking_number, o.tracking_carrier, o.shipped_at,
              o.created_at, o.updated_at,
              ci.name AS item_name, ci.image_path AS item_image
       FROM orders o
       JOIN collection_items ci ON o.collection_item_id = ci.id
       WHERE o.seller_user_id = $1
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch orders:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/storefront/orders/:id/ship  (authenticated)
router.put('/orders/:id/ship', authenticate, async (req, res) => {
  const { tracking_number, tracking_carrier } = req.body;
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `UPDATE orders
       SET status = 'shipped', tracking_number = $1, tracking_carrier = $2,
           shipped_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND seller_user_id = $4 AND status IN ('paid','processing')`,
      [tracking_number || null, tracking_carrier || null, req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Order not found or not ready to ship' });
    }

    // Send tracking email to buyer
    const orderResult = await client.query(
      `SELECT o.buyer_name, o.buyer_email, ci.name AS item_name
       FROM orders o JOIN collection_items ci ON o.collection_item_id = ci.id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (orderResult.rowCount > 0) {
      const o = orderResult.rows[0];
      const trackingLine = tracking_number
        ? `<p>Tracking: <strong>${tracking_carrier || ''} ${tracking_number}</strong></p>`
        : '';
      await sendMail(
        o.buyer_email,
        'noreply@prosaurus.com',
        `Your order has shipped: ${o.item_name}`,
        `<p>Hi ${o.buyer_name},</p>
         <p>Great news — your order of <strong>${o.item_name}</strong> has shipped!</p>
         ${trackingLine}
         <p>Thank you for your purchase.</p>
         <p>— Prosaurus</p>`
      );
    }

    res.json({ message: 'Marked as shipped' });
  } catch (err) {
    console.error('Failed to mark as shipped:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
