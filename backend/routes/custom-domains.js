const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;
const SERVER_IP = process.env.CUSTOM_DOMAIN_TARGET_IP || '44.225.148.34';
const RESUBMIT_COOLDOWN_MINUTES = 60;

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

// Bare apex domain only (no protocol, no path, no port). Requires a dotted TLD.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return null;
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split(':')[0];
  return d;
}

function validateDomain(domain) {
  if (!domain) return 'Domain is required.';
  if (IPV4_RE.test(domain)) return 'Please enter a domain name, not an IP address.';
  if (!DOMAIN_RE.test(domain)) return 'That doesn\'t look like a valid domain (e.g. yourdomain.com).';
  if (domain === 'prosaurus.com' || domain.endsWith('.prosaurus.com')) {
    return 'Prosaurus domains can\'t be connected as a custom domain.';
  }
  return null;
}

// POST /api/custom-domains — submit a domain for automated provisioning
router.post('/', authenticate, async (req, res) => {
  const domain = normalizeDomain(req.body.domain);
  const validationError = validateDomain(domain);
  if (validationError) return res.status(400).json({ message: validationError });

  const contentType = req.body.content_type === 'band_page' ? 'band_page' : 'storefront';
  const bandId = contentType === 'band_page' ? req.body.band_id : null;

  let client;
  try {
    client = await getClient();

    if (contentType === 'band_page') {
      if (!bandId) return res.status(400).json({ message: 'A band is required.' });

      const membership = await client.query(
        `SELECT role FROM band_members WHERE band_id = $1 AND user_id = $2 AND status = 'active'`,
        [bandId, req.user.id]
      );
      if (membership.rowCount === 0 || membership.rows[0].role !== 'owner') {
        return res.status(403).json({ message: 'Only the band owner can connect a custom domain.' });
      }

      const bandPage = await client.query(
        `SELECT band_url FROM band_pages WHERE band_id = $1`,
        [bandId]
      );
      if (bandPage.rowCount === 0 || !bandPage.rows[0].band_url) {
        return res.status(400).json({ message: 'Set a band page URL before connecting a custom domain.' });
      }
    }

    // Any existing non-terminal or active claim on this exact domain blocks a new submission.
    const existing = await client.query(
      `SELECT id, user_id, status, updated_at FROM custom_domains
       WHERE domain = $1 ORDER BY created_at DESC LIMIT 1`,
      [domain]
    );

    if (existing.rowCount > 0) {
      const row = existing.rows[0];

      if (row.status === 'removing') {
        return res.status(409).json({ message: 'This domain is still being removed — please try again in a few minutes.' });
      }

      if (row.status !== 'failed') {
        if (row.user_id === req.user.id) {
          return res.status(409).json({ message: 'This domain is already connected (or being connected) to your storefront.' });
        }
        return res.status(409).json({ message: 'This domain is already connected to another storefront.' });
      }

      // status === 'failed' — allow resubmission once the cooldown has passed
      const minutesSince = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
      if (minutesSince < RESUBMIT_COOLDOWN_MINUTES) {
        return res.status(429).json({
          message: `Please wait a bit before retrying this domain (about ${Math.ceil(RESUBMIT_COOLDOWN_MINUTES - minutesSince)} more minute(s)).`
        });
      }
      // Cooldown has passed — remove the stale failed row so a fresh one can be inserted.
      await client.query('DELETE FROM custom_domains WHERE id = $1', [row.id]);
    }

    const result = await client.query(
      `INSERT INTO custom_domains (user_id, content_type, band_id, domain, status) VALUES ($1, $2, $3, $4, 'pending_dns')`,
      [req.user.id, contentType, bandId, domain]
    );

    res.status(201).json({
      id: result.insertId,
      domain,
      status: 'pending_dns',
      dns_records: [
        { type: 'A', host: '@', value: SERVER_IP },
        { type: 'A', host: 'www', value: SERVER_IP }
      ]
    });
  } catch (err) {
    console.error('Failed to submit custom domain:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/custom-domains — current user's domain(s) + status
// No ?band_id= -> storefront domains (today's behavior). ?band_id=X -> that band's domains only.
router.get('/', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();

    let query = `SELECT id, domain, status, error_message, dns_confirmed_at, activated_at, created_at, updated_at
       FROM custom_domains WHERE user_id = $1 AND status != 'removing'`;
    const params = [req.user.id];

    if (req.query.band_id) {
      query += ` AND content_type = 'band_page' AND band_id = $${params.length + 1}`;
      params.push(req.query.band_id);
    } else {
      query += ` AND content_type = 'storefront'`;
    }

    query += ' ORDER BY created_at DESC';

    const result = await client.query(query, params);
    const rows = result.rows.map(row => ({
      ...row,
      dns_records: [
        { type: 'A', host: '@', value: SERVER_IP },
        { type: 'A', host: 'www', value: SERVER_IP }
      ]
    }));
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch custom domains:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// PUT /api/custom-domains/:id/confirm-dns — user asserts they've added the DNS records;
// starts (or restarts) the 48-hour reference window shown in the UI.
router.put('/:id/confirm-dns', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `UPDATE custom_domains SET dns_confirmed_at = NOW() WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Domain not found' });

    const row = await client.query(`SELECT dns_confirmed_at FROM custom_domains WHERE id = $1`, [req.params.id]);
    res.json({ dns_confirmed_at: row.rows[0].dns_confirmed_at });
  } catch (err) {
    console.error('Failed to confirm DNS:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/custom-domains/:id — queue for deprovisioning; host agent tears down + hard-deletes
router.delete('/:id', authenticate, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `UPDATE custom_domains SET status = 'removing' WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Domain not found' });
    res.json({ message: 'Domain removal queued' });
  } catch (err) {
    console.error('Failed to remove custom domain:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/custom-domains/public/by-domain/:hostname  (no auth) — resolves an active
// custom domain to whatever it's connected to (a storefront or a band page).
router.get('/public/by-domain/:hostname', async (req, res) => {
  const hostname = String(req.params.hostname || '').toLowerCase().replace(/^www\./, '');
  let client;
  try {
    client = await getClient();
    const result = await client.query(
      `SELECT cd.content_type, us.store_url, bp.band_url
         FROM custom_domains cd
         LEFT JOIN user_storefront us ON us.user_id = cd.user_id AND cd.content_type = 'storefront'
         LEFT JOIN band_pages bp ON bp.band_id = cd.band_id AND cd.content_type = 'band_page'
        WHERE cd.domain = $1 AND cd.status = 'active'`,
      [hostname]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Domain not found' });

    const row = result.rows[0];
    if (row.content_type === 'storefront' && row.store_url) {
      return res.json({ content_type: 'storefront', store_url: row.store_url });
    }
    if (row.content_type === 'band_page' && row.band_url) {
      return res.json({ content_type: 'band_page', band_url: row.band_url });
    }
    res.status(404).json({ message: 'Domain not found' });
  } catch (err) {
    console.error('Failed to resolve custom domain:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
