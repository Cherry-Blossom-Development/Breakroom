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

// Get all projects for a company
router.get('/company/:companyId', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public,
              p.created_at, p.updated_at,
              (SELECT COUNT(*) FROM ticket_projects tp WHERE tp.project_id = p.id) as ticket_count
       FROM projects p
       WHERE p.company_id = $1
       ORDER BY p.is_default DESC, p.title`,
      [companyId]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  } finally {
    client.release();
  }
});

// Get a single project with its tickets
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const projectResult = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public,
              p.company_id, p.created_at, p.updated_at,
              c.name as company_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const ticketsResult = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at,
              creator.handle as creator_handle, creator.first_name as creator_first_name,
              creator.last_name as creator_last_name,
              assignee.handle as assignee_handle, assignee.first_name as assignee_first_name,
              assignee.last_name as assignee_last_name
       FROM tickets t
       JOIN ticket_projects tp ON t.id = tp.ticket_id
       JOIN users creator ON t.creator_id = creator.id
       LEFT JOIN users assignee ON t.assigned_to = assignee.id
       WHERE tp.project_id = $1
       ORDER BY
         CASE t.status
           WHEN 'backlog' THEN 1
           WHEN 'on-deck' THEN 2
           WHEN 'in_progress' THEN 3
           WHEN 'resolved' THEN 4
           WHEN 'closed' THEN 5
           ELSE 6
         END,
         CASE t.priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
         END,
         t.created_at DESC`,
      [id]
    );

    res.json({
      project: projectResult.rows[0],
      tickets: ticketsResult.rows
    });
  } catch (err) {
    console.error('Error fetching project:', err);
    res.status(500).json({ message: 'Failed to fetch project' });
  } finally {
    client.release();
  }
});

// Create a new project
router.post('/', authenticate, async (req, res) => {
  const { company_id, title, description } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    if (!company_id) {
      return res.status(400).json({ message: 'Company ID is required' });
    }

    // Verify user has permission (is employee of company)
    const authResult = await client.query(
      `SELECT is_owner, is_admin FROM employees
       WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.user.id, company_id]
    );

    if (authResult.rowCount === 0) {
      return res.status(403).json({ message: 'Not authorized to create projects for this company' });
    }

    await client.query(
      `INSERT INTO projects (company_id, title, description, is_public)
       VALUES ($1, $2, $3, FALSE)`,
      [company_id, title.trim(), description || null]
    );

    // Get the inserted project
    const result = await client.query(
      `SELECT id, title, description, is_default, is_active, is_public, created_at
       FROM projects
       WHERE company_id = $1
       ORDER BY id DESC LIMIT 1`,
      [company_id]
    );

    res.status(201).json({ project: result.rows[0] });
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ message: 'Failed to create project' });
  } finally {
    client.release();
  }
});

// Update a project
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, description, is_active, is_public } = req.body;
  const client = await getClient();

  try {
    // Get project and verify it exists
    const projectResult = await client.query(
      'SELECT company_id, is_default FROM projects WHERE id = $1',
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projectResult.rows[0];

    // Verify user has permission
    const authResult = await client.query(
      `SELECT is_owner, is_admin FROM employees
       WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.user.id, project.company_id]
    );

    if (authResult.rowCount === 0) {
      return res.status(403).json({ message: 'Not authorized to update this project' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      if (title.trim().length === 0) {
        return res.status(400).json({ message: 'Title cannot be empty' });
      }
      updates.push(`title = $${paramCount++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (is_active !== undefined) {
      // Cannot deactivate default project
      if (project.is_default && is_active === false) {
        return res.status(400).json({ message: 'Cannot deactivate the default project' });
      }
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }
    if (is_public !== undefined) {
      updates.push(`is_public = $${paramCount++}`);
      values.push(is_public);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(id);
    await client.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated project
    const result = await client.query(
      `SELECT id, title, description, is_default, is_active, is_public, created_at, updated_at
       FROM projects WHERE id = $1`,
      [id]
    );

    res.json({ project: result.rows[0] });
  } catch (err) {
    console.error('Error updating project:', err);
    res.status(500).json({ message: 'Failed to update project' });
  } finally {
    client.release();
  }
});

// Delete a project
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Get project and verify it exists
    const projectResult = await client.query(
      'SELECT company_id, is_default FROM projects WHERE id = $1',
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projectResult.rows[0];

    // Cannot delete default project
    if (project.is_default) {
      return res.status(400).json({ message: 'Cannot delete the default project' });
    }

    // Verify user has permission (owner or admin)
    const authResult = await client.query(
      `SELECT is_owner, is_admin FROM employees
       WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.user.id, project.company_id]
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to delete this project' });
    }

    // Delete project (ticket_projects entries will cascade delete)
    await client.query('DELETE FROM projects WHERE id = $1', [id]);

    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Error deleting project:', err);
    res.status(500).json({ message: 'Failed to delete project' });
  } finally {
    client.release();
  }
});

// Add a ticket to a project
router.post('/:projectId/tickets/:ticketId', authenticate, async (req, res) => {
  const { projectId, ticketId } = req.params;
  const client = await getClient();

  try {
    // Verify project exists and get company_id
    const projectResult = await client.query(
      'SELECT company_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Verify ticket exists and belongs to same company
    const ticketResult = await client.query(
      'SELECT company_id FROM tickets WHERE id = $1',
      [ticketId]
    );

    if (ticketResult.rowCount === 0) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticketResult.rows[0].company_id !== projectResult.rows[0].company_id) {
      return res.status(400).json({ message: 'Ticket and project must belong to the same company' });
    }

    // Check if association already exists
    const existingResult = await client.query(
      'SELECT 1 FROM ticket_projects WHERE ticket_id = $1 AND project_id = $2',
      [ticketId, projectId]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ message: 'Ticket is already in this project' });
    }

    await client.query(
      'INSERT INTO ticket_projects (ticket_id, project_id) VALUES ($1, $2)',
      [ticketId, projectId]
    );

    res.status(201).json({ message: 'Ticket added to project' });
  } catch (err) {
    console.error('Error adding ticket to project:', err);
    res.status(500).json({ message: 'Failed to add ticket to project' });
  } finally {
    client.release();
  }
});

// Remove a ticket from a project
router.delete('/:projectId/tickets/:ticketId', authenticate, async (req, res) => {
  const { projectId, ticketId } = req.params;
  const client = await getClient();

  try {
    // Verify project exists
    const projectResult = await client.query(
      'SELECT is_default FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check how many projects this ticket belongs to
    const countResult = await client.query(
      'SELECT COUNT(*) as count FROM ticket_projects WHERE ticket_id = $1',
      [ticketId]
    );

    if (parseInt(countResult.rows[0].count) <= 1) {
      return res.status(400).json({ message: 'Ticket must belong to at least one project' });
    }

    // Delete association
    const deleteResult = await client.query(
      'DELETE FROM ticket_projects WHERE ticket_id = $1 AND project_id = $2',
      [ticketId, projectId]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: 'Ticket is not in this project' });
    }

    res.json({ message: 'Ticket removed from project' });
  } catch (err) {
    console.error('Error removing ticket from project:', err);
    res.status(500).json({ message: 'Failed to remove ticket from project' });
  } finally {
    client.release();
  }
});

// Get all projects a ticket belongs to
router.get('/ticket/:ticketId', authenticate, async (req, res) => {
  const { ticketId } = req.params;
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public
       FROM projects p
       JOIN ticket_projects tp ON p.id = tp.project_id
       WHERE tp.ticket_id = $1
       ORDER BY p.is_default DESC, p.title`,
      [ticketId]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('Error fetching ticket projects:', err);
    res.status(500).json({ message: 'Failed to fetch ticket projects' });
  } finally {
    client.release();
  }
});

// Create a ticket for a specific project
router.post('/:id/tickets', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title, description, priority } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Get project and verify it exists
    const projectResult = await client.query(
      'SELECT company_id, is_active FROM projects WHERE id = $1',
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projectResult.rows[0];

    if (!project.is_active) {
      return res.status(400).json({ message: 'Cannot create tickets for inactive projects' });
    }

    // Insert the ticket with 'backlog' status for project tickets
    await client.query(
      `INSERT INTO tickets (company_id, creator_id, title, description, priority, status)
       VALUES ($1, $2, $3, $4, $5, 'backlog')`,
      [project.company_id, req.user.id, title.trim(), description || '', priority || 'medium']
    );

    // Get the inserted ticket with all fields needed by mobile
    const result = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.created_at, t.updated_at, t.resolved_at,
              creator.handle as creator_handle,
              creator.first_name as creator_first_name,
              creator.last_name as creator_last_name
       FROM tickets t
       JOIN users creator ON t.creator_id = creator.id
       WHERE t.creator_id = $1
       ORDER BY t.id DESC LIMIT 1`,
      [req.user.id]
    );

    const ticketId = result.rows[0].id;

    // Associate ticket ONLY with this specific project
    await client.query(
      'INSERT INTO ticket_projects (ticket_id, project_id) VALUES ($1, $2)',
      [ticketId, id]
    );

    res.status(201).json({ ticket: result.rows[0] });
  } catch (err) {
    console.error('Error creating project ticket:', err);
    res.status(500).json({ message: 'Failed to create ticket' });
  } finally {
    client.release();
  }
});

module.exports = router;
