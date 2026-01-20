const express = require('express');
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
      'SELECT id, handle FROM users WHERE handle = $1',
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

// Get company info
router.get('/company/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      'SELECT id, name, description, city, state, country FROM companies WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({ company: result.rows[0] });
  } catch (err) {
    console.error('Error fetching company:', err);
    res.status(500).json({ message: 'Failed to fetch company' });
  } finally {
    client.release();
  }
});

// Get tickets for a company's helpdesk (default project only)
router.get('/tickets/:companyId', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at,
              c.name as company_name,
              creator.handle as creator_handle, creator.first_name as creator_first_name,
              creator.last_name as creator_last_name,
              assignee.handle as assignee_handle, assignee.first_name as assignee_first_name,
              assignee.last_name as assignee_last_name
       FROM tickets t
       JOIN companies c ON t.company_id = c.id
       JOIN users creator ON t.creator_id = creator.id
       LEFT JOIN users assignee ON t.assigned_to = assignee.id
       JOIN ticket_projects tp ON t.id = tp.ticket_id
       JOIN projects p ON tp.project_id = p.id AND p.is_default = TRUE
       WHERE t.company_id = $1
       ORDER BY
         CASE t.status
           WHEN 'open' THEN 1
           WHEN 'in_progress' THEN 2
           WHEN 'resolved' THEN 3
           WHEN 'closed' THEN 4
         END,
         CASE t.priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         t.created_at DESC`,
      [companyId]
    );

    res.json({ tickets: result.rows });
  } catch (err) {
    console.error('Error fetching tickets:', err);
    res.status(500).json({ message: 'Failed to fetch tickets' });
  } finally {
    client.release();
  }
});

// Get a single ticket
router.get('/ticket/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at, t.company_id,
              c.name as company_name,
              creator.id as creator_id, creator.handle as creator_handle,
              creator.first_name as creator_first_name, creator.last_name as creator_last_name,
              assignee.id as assignee_id, assignee.handle as assignee_handle,
              assignee.first_name as assignee_first_name, assignee.last_name as assignee_last_name
       FROM tickets t
       JOIN companies c ON t.company_id = c.id
       JOIN users creator ON t.creator_id = creator.id
       LEFT JOIN users assignee ON t.assigned_to = assignee.id
       WHERE t.id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    res.json({ ticket: result.rows[0] });
  } catch (err) {
    console.error('Error fetching ticket:', err);
    res.status(500).json({ message: 'Failed to fetch ticket' });
  } finally {
    client.release();
  }
});

// Create a new ticket
router.post('/tickets', authenticate, async (req, res) => {
  const { company_id, title, description, priority } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    if (!company_id) {
      return res.status(400).json({ message: 'Company ID is required' });
    }

    await client.query(
      `INSERT INTO tickets (company_id, creator_id, title, description, priority)
       VALUES ($1, $2, $3, $4, $5)`,
      [company_id, req.user.id, title.trim(), description || '', priority || 'medium']
    );

    // Get the inserted ticket with all fields needed by mobile
    const result = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at,
              creator.handle as creator_handle, creator.first_name as creator_first_name,
              creator.last_name as creator_last_name
       FROM tickets t
       JOIN users creator ON t.creator_id = creator.id
       WHERE t.creator_id = $1
       ORDER BY t.id DESC LIMIT 1`,
      [req.user.id]
    );

    const ticketId = result.rows[0].id;

    // Associate ticket with the company's default project
    await client.query(
      `INSERT INTO ticket_projects (ticket_id, project_id)
       SELECT $1, id FROM projects WHERE company_id = $2 AND is_default = TRUE`,
      [ticketId, company_id]
    );

    res.status(201).json({ ticket: result.rows[0] });
  } catch (err) {
    console.error('Error creating ticket:', err);
    res.status(500).json({ message: 'Failed to create ticket' });
  } finally {
    client.release();
  }
});

// Update a ticket
router.put('/ticket/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, description, status, priority, assigned_to } = req.body;
  const client = await getClient();

  try {
    // Check if ticket exists
    const check = await client.query('SELECT id, creator_id FROM tickets WHERE id = $1', [id]);
    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (status !== undefined) {
      const validStatuses = ['open', 'backlog', 'on-deck', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      updates.push(`status = $${paramCount++}`);
      values.push(status);
      if (status === 'resolved' || status === 'closed') {
        updates.push(`resolved_at = CURRENT_TIMESTAMP`);
      }
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramCount++}`);
      values.push(assigned_to || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(id);
    await client.query(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated ticket with all fields needed by mobile
    const result = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at,
              creator.handle as creator_handle, creator.first_name as creator_first_name,
              creator.last_name as creator_last_name,
              assignee.handle as assignee_handle, assignee.first_name as assignee_first_name,
              assignee.last_name as assignee_last_name
       FROM tickets t
       JOIN users creator ON t.creator_id = creator.id
       LEFT JOIN users assignee ON t.assigned_to = assignee.id
       WHERE t.id = $1`,
      [id]
    );

    res.json({ ticket: result.rows[0] });
  } catch (err) {
    console.error('Error updating ticket:', err);
    res.status(500).json({ message: 'Failed to update ticket' });
  } finally {
    client.release();
  }
});

module.exports = router;
