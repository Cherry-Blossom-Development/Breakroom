const express = require('express');
const { sanitizeHtml } = require('../utilities/sanitizeHtml');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');

require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Auth middleware - supports both cookie (web) and Authorization header (mobile)
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const result = await client.query(
      'SELECT id, handle, first_name, last_name FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Get all open positions (for employment page)
router.get('/', authenticate, async (req, res) => {
  const { search, location_type, employment_type, company_id } = req.query;
  const client = await getClient();

  try {
    let query = `
      SELECT p.*, c.name as company_name, c.city as company_city, c.state as company_state
      FROM open_positions p
      JOIN companies c ON p.company_id = c.id
      WHERE p.status = 'open'
    `;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (p.title LIKE $${paramIndex} OR p.description LIKE $${paramIndex} OR c.name LIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (location_type) {
      query += ` AND p.location_type = $${paramIndex}`;
      params.push(location_type);
      paramIndex++;
    }

    if (employment_type) {
      query += ` AND p.employment_type = $${paramIndex}`;
      params.push(employment_type);
      paramIndex++;
    }

    if (company_id) {
      query += ` AND p.company_id = $${paramIndex}`;
      params.push(company_id);
      paramIndex++;
    }

    query += ' ORDER BY p.created_at DESC LIMIT 50';

    const result = await client.query(query, params);
    res.json({ positions: result.rows });
  } catch (err) {
    console.error('Error fetching positions:', err);
    res.status(500).json({ message: 'Failed to fetch positions' });
  } finally {
    client.release();
  }
});

// Get single position details
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT p.*, c.name as company_name, c.description as company_description,
              c.city as company_city, c.state as company_state, c.country as company_country,
              c.website as company_website
       FROM open_positions p
       JOIN companies c ON p.company_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Position not found' });
    }

    res.json({ position: result.rows[0] });
  } catch (err) {
    console.error('Error fetching position:', err);
    res.status(500).json({ message: 'Failed to fetch position' });
  } finally {
    client.release();
  }
});

// Get positions for a specific company
router.get('/company/:companyId', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const { status } = req.query;
  const client = await getClient();

  try {
    let query = `
      SELECT p.*, u.handle as created_by_handle, u.first_name as created_by_first_name
      FROM open_positions p
      JOIN users u ON p.created_by = u.id
      WHERE p.company_id = $1
    `;
    const params = [companyId];

    if (status) {
      query += ' AND p.status = $2';
      params.push(status);
    }

    query += ' ORDER BY p.created_at DESC';

    const result = await client.query(query, params);
    res.json({ positions: result.rows });
  } catch (err) {
    console.error('Error fetching company positions:', err);
    res.status(500).json({ message: 'Failed to fetch positions' });
  } finally {
    client.release();
  }
});

// Create a new position (owner/admin only)
router.post('/company/:companyId', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const {
    title, description, department, location_type, city, state, country,
    employment_type, pay_rate_min, pay_rate_max, pay_type, requirements, benefits
  } = req.body;
  const client = await getClient();

  try {
    // Check if user is owner or admin of the company
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, companyId, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to create positions for this company' });
    }

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Position title is required' });
    }

    await client.query(
      `INSERT INTO open_positions
       (company_id, title, description, department, location_type, city, state, country,
        employment_type, pay_rate_min, pay_rate_max, pay_type, requirements, benefits, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [companyId, title.trim(), sanitizeHtml(description) || null, department || null,
       location_type || 'onsite', city || null, state || null, country || null,
       employment_type || 'full-time', pay_rate_min || null, pay_rate_max || null,
       pay_type || 'salary', sanitizeHtml(requirements) || null, sanitizeHtml(benefits) || null, req.user.id]
    );

    // Get the created position
    const positionResult = await client.query(
      'SELECT * FROM open_positions WHERE company_id = $1 AND title = $2 ORDER BY id DESC LIMIT 1',
      [companyId, title.trim()]
    );

    res.status(201).json({
      position: positionResult.rows[0],
      message: 'Position created successfully'
    });
  } catch (err) {
    console.error('Error creating position:', err);
    res.status(500).json({ message: 'Failed to create position' });
  } finally {
    client.release();
  }
});

// Update a position (owner/admin only)
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const {
    title, description, department, location_type, city, state, country,
    employment_type, pay_rate_min, pay_rate_max, pay_type, requirements, benefits, status
  } = req.body;
  const client = await getClient();

  try {
    // Get position to find company
    const positionResult = await client.query(
      'SELECT company_id FROM open_positions WHERE id = $1',
      [id]
    );

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ message: 'Position not found' });
    }

    const companyId = positionResult.rows[0].company_id;

    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, companyId, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to update this position' });
    }

    await client.query(
      `UPDATE open_positions SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        department = COALESCE($3, department),
        location_type = COALESCE($4, location_type),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        country = COALESCE($7, country),
        employment_type = COALESCE($8, employment_type),
        pay_rate_min = COALESCE($9, pay_rate_min),
        pay_rate_max = COALESCE($10, pay_rate_max),
        pay_type = COALESCE($11, pay_type),
        requirements = COALESCE($12, requirements),
        benefits = COALESCE($13, benefits),
        status = COALESCE($14, status)
       WHERE id = $15`,
      [title ?? null, sanitizeHtml(description) ?? null, department ?? null, location_type ?? null,
       city ?? null, state ?? null, country ?? null, employment_type ?? null,
       pay_rate_min ?? null, pay_rate_max ?? null, pay_type ?? null,
       sanitizeHtml(requirements) ?? null, sanitizeHtml(benefits) ?? null, status ?? null, id]
    );

    const updatedResult = await client.query('SELECT * FROM open_positions WHERE id = $1', [id]);
    res.json({ position: updatedResult.rows[0] });
  } catch (err) {
    console.error('Error updating position:', err);
    res.status(500).json({ message: 'Failed to update position' });
  } finally {
    client.release();
  }
});

// Delete a position (owner/admin only)
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Get position to find company
    const positionResult = await client.query(
      'SELECT company_id FROM open_positions WHERE id = $1',
      [id]
    );

    if (positionResult.rowCount === 0) {
      return res.status(404).json({ message: 'Position not found' });
    }

    const companyId = positionResult.rows[0].company_id;

    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, companyId, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to delete this position' });
    }

    await client.query('DELETE FROM open_positions WHERE id = $1', [id]);
    res.json({ message: 'Position deleted successfully' });
  } catch (err) {
    console.error('Error deleting position:', err);
    res.status(500).json({ message: 'Failed to delete position' });
  } finally {
    client.release();
  }
});

module.exports = router;
