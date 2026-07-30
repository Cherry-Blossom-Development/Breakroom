const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { sendMail } = require('../utilities/aws-ses-email');
const { getProcessor } = require('../utilities/payments');
const { ProcessorAuthError } = require('../utilities/payments/errors');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

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

// POST /api/storefront/public/:storeUrl/items/:itemId/checkout  (no auth)
// Square's CreatePayment completes synchronously -- unlike Stripe's PaymentIntent +
// async webhook-confirmation flow, there's no separate "intent" step (hence the renamed
// path, dropping "/intent"). The frontend must tokenize the buyer's card first (Web
// Payments SDK, Phase 4) and send the resulting source_id here; this one request creates
// the order AND completes the charge.
router.post('/public/:storeUrl/items/:itemId/checkout', async (req, res) => {
  const { source_id, buyer_name, buyer_email, ship_to_name, ship_to_address1, ship_to_address2,
          ship_to_city, ship_to_state, ship_to_zip, ship_to_country,
          processor: processorName = 'square' } = req.body;

  if (!source_id || !buyer_name || !buyer_email || !ship_to_name || !ship_to_address1 ||
      !ship_to_city || !ship_to_state || !ship_to_zip) {
    return res.status(400).json({ message: 'All required fields must be filled in.' });
  }

  let processor;
  try {
    processor = getProcessor(processorName);
  } catch (err) {
    return res.status(400).json({ message: err.message });
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

    // Prevent duplicate checkouts (30-min lock). Window is now mostly a formality since
    // CreatePayment completes within the same request, but still guards the brief window
    // between two near-simultaneous requests for the same item.
    const lockCheck = await client.query(
      `SELECT id FROM orders
       WHERE collection_item_id = $1 AND status = 'pending_payment'
       AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)`,
      [item.id]
    );
    if (lockCheck.rowCount > 0) {
      return res.status(409).json({ message: 'This item is currently being purchased. Please try again in a few minutes.' });
    }

    // Seller must have completed Connect for this processor
    const connectResult = await client.query(
      'SELECT processor_account_id FROM user_payment_connect WHERE user_id = $1 AND processor = $2 AND onboarding_complete = 1',
      [sellerUserId, processorName]
    );
    if (connectResult.rowCount === 0) {
      return res.status(400).json({ message: 'Seller has not completed payment setup' });
    }
    const sellerAccountId = connectResult.rows[0].processor_account_id;

    const itemPriceCents = item.price_cents;
    const shippingCostCents = item.shipping_cost_cents || 0;
    const totalCents = itemPriceCents + shippingCostCents;

    const feePercent = await getSellerFeePercent(sellerUserId, client);
    const platformFeeCents = Math.round(totalCents * feePercent / 100);

    // Reserve the item with a pending order row before charging -- same duplicate-
    // prevention lock the Stripe flow used, just a much shorter real-world window now.
    const orderResult = await client.query(
      `INSERT INTO orders
         (collection_item_id, seller_user_id, buyer_name, buyer_email,
          ship_to_name, ship_to_address1, ship_to_address2, ship_to_city,
          ship_to_state, ship_to_zip, ship_to_country,
          item_price_cents, shipping_cost_cents, platform_fee_cents, total_cents,
          payment_processor, payment_connected_account_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'pending_payment')`,
      [item.id, sellerUserId, buyer_name, buyer_email,
       ship_to_name, ship_to_address1, ship_to_address2 || null, ship_to_city,
       ship_to_state, ship_to_zip, country,
       itemPriceCents, shippingCostCents, platformFeeCents, totalCents,
       processorName, sellerAccountId]
    );
    const orderId = orderResult.insertId;

    // Payment creation is dispatched through the processor adapter -- see
    // docs/multi-processor-payments-architecture.md for why the trust model differs
    // per processor (Square requires the seller's own OAuth token for this call; other
    // processors may not).
    let payment;
    try {
      payment = await processor.createPayment({
        sellerUserId,
        sellerAccountId,
        amountCents: totalCents,
        feeCents: platformFeeCents,
        paymentToken: source_id,
        referenceId: orderId
      });
    } catch (paymentErr) {
      await client.query(`UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [orderId]);
      if (paymentErr instanceof ProcessorAuthError) {
        // Seller's connection was revoked since we checked onboarding_complete above --
        // clear the stale row so they're prompted to reconnect rather than silently
        // failing again on the next attempt.
        await client.query('DELETE FROM user_payment_connect WHERE user_id = $1 AND processor = $2', [sellerUserId, processorName]);
        return res.status(400).json({ message: 'Seller has not completed payment setup' });
      }
      throw paymentErr;
    }

    await client.query(
      `UPDATE orders SET status = 'paid', payment_intent_id = $1, updated_at = NOW() WHERE id = $2`,
      [payment.paymentId, orderId]
    );
    await client.query(`UPDATE collection_items SET is_available = 0 WHERE id = $1`, [item.id]);

    // Best-effort confirmation emails -- must NOT surface as a checkout failure to the
    // buyer, since the charge already succeeded by this point.
    try {
      const fmt = cents => `$${(cents / 100).toFixed(2)}`;
      const addr = `${ship_to_address1}${ship_to_address2 ? ', ' + ship_to_address2 : ''}, ${ship_to_city}, ${ship_to_state} ${ship_to_zip}, ${country}`;
      const sellerResult = await client.query('SELECT email, first_name FROM users WHERE id = $1', [sellerUserId]);
      const seller = sellerResult.rows[0];

      await sendMail(
        seller.email,
        'noreply@prosaurus.com',
        `New order: ${item.name}`,
        `<p>Hi ${seller.first_name || 'there'},</p>
         <p>You have a new order on Prosaurus!</p>
         <table style="border-collapse:collapse;width:100%;max-width:480px">
           <tr><td style="padding:6px 0;color:#666">Item</td><td><strong>${item.name}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Amount</td><td>${fmt(itemPriceCents)} + ${fmt(shippingCostCents)} shipping</td></tr>
           <tr><td style="padding:6px 0;color:#666">Buyer</td><td>${buyer_name} &lt;${buyer_email}&gt;</td></tr>
           <tr><td style="padding:6px 0;color:#666">Ship to</td><td>${ship_to_name}<br>${addr}</td></tr>
         </table>
         <p>Log in to <a href="https://www.prosaurus.com/collections/orders">Prosaurus</a> to manage this order.</p>
         <p>— Prosaurus</p>`
      );

      await sendMail(
        buyer_email,
        'noreply@prosaurus.com',
        `Order confirmed: ${item.name}`,
        `<p>Hi ${buyer_name},</p>
         <p>Your order has been confirmed. Here's a summary:</p>
         <table style="border-collapse:collapse;width:100%;max-width:480px">
           <tr><td style="padding:6px 0;color:#666">Item</td><td><strong>${item.name}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Item price</td><td>${fmt(itemPriceCents)}</td></tr>
           <tr><td style="padding:6px 0;color:#666">Shipping</td><td>${fmt(shippingCostCents)}</td></tr>
           <tr><td style="padding:6px 0;color:#666;font-weight:bold">Total</td><td><strong>${fmt(totalCents)}</strong></td></tr>
           <tr><td style="padding:6px 0;color:#666">Ship to</td><td>${ship_to_name}<br>${addr}</td></tr>
         </table>
         <p>The seller will ship your item and you'll receive a tracking number by email.</p>
         <p>— Prosaurus</p>`
      );
    } catch (emailErr) {
      console.error('Order confirmation email failed (order still succeeded):', emailErr);
    }

    res.json({
      order_id: orderId,
      item_price_cents: itemPriceCents,
      shipping_cost_cents: shippingCostCents,
      total_cents: totalCents,
      status: 'paid'
    });
  } catch (err) {
    console.error('Failed to complete checkout:', err);
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
