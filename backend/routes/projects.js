const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { getProjectDependencyEdges } = require('../utilities/ticketDependencies');
const { isActiveEmployee, getTicketAccess } = require('../utilities/ticketAccess');
const { PROJECT_ROLES, WORKER_ROLES, getProjectAccess } = require('../utilities/projectAccess');
const { sendMailToUser } = require('../utilities/aws-ses-email');
const { sanitizeHtml } = require('../utilities/sanitizeHtml');
const { parseEstimate } = require('../utilities/ticketEstimates');
const { recordStatusChange, getProjectTicketTimeline, getProjectStatusHistory } = require('../utilities/ticketStatusHistory');

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

// Active employees of the project's company plus working members of the
// project, as { user_id, handle, first_name, last_name }.
async function getProjectAssignees(client, project) {
  const result = await client.query(
    `SELECT u.id as user_id, u.handle, u.first_name, u.last_name
     FROM users u
     WHERE u.id IN (SELECT user_id FROM employees WHERE company_id = $1 AND status = 'active')
        OR u.id IN (SELECT user_id FROM project_members
                    WHERE project_id = $2 AND status = 'active' AND role IN ('owner', 'manager', 'member'))
     ORDER BY u.first_name, u.last_name, u.handle`,
    [project.company_id, project.id]
  );
  return result.rows;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Sprint lengths the Settings page offers, in days (1-4 weeks)
const SPRINT_DURATIONS = [7, 14, 21, 28];

// Get all projects for a company
router.get('/company/:companyId', authenticate, async (req, res) => {
  const { companyId } = req.params;
  const client = await getClient();

  try {
    // Check if requesting user is an active employee
    const empCheck = await client.query(
      `SELECT 1 FROM employees WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.user.id, companyId]
    );
    const isEmployee = empCheck.rowCount > 0;

    const result = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public,
              p.created_at, p.updated_at,
              (SELECT COUNT(*) FROM ticket_projects tp WHERE tp.project_id = p.id) as ticket_count
       FROM projects p
       WHERE p.company_id = $1
         AND ($2 = TRUE OR p.is_public = TRUE)
       ORDER BY p.is_default DESC, p.title`,
      [companyId, isEmployee]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  } finally {
    client.release();
  }
});

// Get all projects across every company the user is an active employee of
// (the sidebar's cross-company Projects page), plus projects in other
// companies the user is an active member of. Employees see private
// projects too, same as GET /company/:companyId does for its employees.
router.get('/my/list', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public,
              p.company_id, p.created_at, p.updated_at,
              c.name as company_name,
              (SELECT COUNT(*) FROM ticket_projects tp WHERE tp.project_id = p.id) as ticket_count
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       WHERE p.company_id IN (
               SELECT company_id FROM employees WHERE user_id = $1 AND status = 'active'
             )
          OR p.id IN (
               SELECT project_id FROM project_members WHERE user_id = $1 AND status = 'active'
             )
       ORDER BY p.is_active DESC, c.name, p.is_default DESC, p.title`,
      [req.user.id]
    );

    res.json({ projects: result.rows });
  } catch (err) {
    console.error('Error fetching user projects:', err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  } finally {
    client.release();
  }
});

// Pending project invites for the current user (shown on the Projects page)
router.get('/my/invites', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT pm.project_id, pm.role, pm.invited_at,
              p.title as project_title, c.name as company_name,
              inviter.handle as inviter_handle, inviter.first_name as inviter_first_name,
              inviter.last_name as inviter_last_name
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN users inviter ON inviter.id = pm.invited_by
       WHERE pm.user_id = $1 AND pm.status = 'invited'
       ORDER BY pm.invited_at DESC`,
      [req.user.id]
    );

    res.json({ invites: result.rows });
  } catch (err) {
    console.error('Error fetching project invites:', err);
    res.status(500).json({ message: 'Failed to fetch invites' });
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
              p.sprint_duration_days, p.company_id, p.created_at, p.updated_at,
              c.name as company_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       WHERE p.id = $1`,
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Private projects are for employees and project members (see
    // utilities/projectAccess.js). can_work tells the board whether to offer
    // the full-edit controls (assign, estimate, dependencies, any move);
    // can_manage whether to offer settings/member management.
    const access = await getProjectAccess(client, id, req.user.id);
    if (!access.canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const ticketsResult = await client.query(
      `SELECT t.id, t.company_id, t.parent_ticket_id, t.split_mode, t.creator_id, t.assigned_to,
              t.title, t.description, t.status, t.priority, tp.backlog_rank,
              t.estimate_amount, t.estimate_unit, t.created_at, t.updated_at, t.resolved_at,
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

    // Tickets that were split into subtasks (migration 086) are off the
    // board -- the board, the closed list and the mobile apps all use
    // `tickets` -- but are returned separately so the GANTT chart can draw
    // categories and the ticket panel can link subtasks to their parent.
    res.json({
      project: projectResult.rows[0],
      tickets: ticketsResult.rows.filter(t => !t.split_mode),
      split_parents: ticketsResult.rows.filter(t => t.split_mode),
      dependencies: await getProjectDependencyEdges(client, id),
      // [{ ticket_id, started_at, done_at }] from status history (GANTT/Burndown)
      timeline: await getProjectTicketTimeline(client, id),
      // People a ticket here can be assigned to (see canBeAssigned)
      assignees: access.canWork ? await getProjectAssignees(client, access.project) : [],
      is_employee: access.isEmployee,
      member_role: access.memberRole,
      can_work: access.canWork,
      can_manage: access.canManage
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

    // The creator owns the new project
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role, status, invited_by, joined_at)
       VALUES ($1, $2, 'owner', 'active', $2, CURRENT_TIMESTAMP)`,
      [result.rows[0].id, req.user.id]
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

    if (!(await isActiveEmployee(client, req.user.id, projectResult.rows[0].company_id))) {
      return res.status(403).json({ message: 'Not authorized to change this project' });
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
      'SELECT is_default, company_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (!(await isActiveEmployee(client, req.user.id, projectResult.rows[0].company_id))) {
      return res.status(403).json({ message: 'Not authorized to change this project' });
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
    const access = await getTicketAccess(client, ticketId, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    if (!access.canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Non-employees only see the public / Help Desk projects the ticket is
    // in, and projects they're a member of
    const result = await client.query(
      `SELECT p.id, p.title, p.description, p.is_default, p.is_active, p.is_public
       FROM projects p
       JOIN ticket_projects tp ON p.id = tp.project_id
       WHERE tp.ticket_id = $1
         AND ($2 = TRUE OR p.is_public = TRUE OR p.is_default = TRUE
              OR p.id IN (SELECT project_id FROM project_members WHERE user_id = $3 AND status = 'active'))
       ORDER BY p.is_default DESC, p.title`,
      [ticketId, access.isEmployee, req.user.id]
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
  const { title, description, priority, estimate_amount, estimate_unit } = req.body;
  const client = await getClient();

  try {
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Get project and verify it exists
    const projectResult = await client.query(
      'SELECT company_id, is_active, is_public, is_default FROM projects WHERE id = $1',
      [id]
    );

    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const project = projectResult.rows[0];

    if (!project.is_active) {
      return res.status(400).json({ message: 'Cannot create tickets for inactive projects' });
    }

    // Anyone may file into a public or Help Desk project (same rule as
    // viewing it); private projects are for employees and working members.
    // Estimates are an employee/working-member field, same as on update.
    const access = await getProjectAccess(client, id, req.user.id);
    if (!access.canWork && !project.is_public && !project.is_default) {
      return res.status(403).json({ message: 'Not authorized to create tickets in this project' });
    }

    let estimate = { amount: null, unit: null };
    if (access.canWork && estimate_amount !== undefined) {
      const parsed = parseEstimate(estimate_amount, estimate_unit);
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }
      estimate = parsed.value;
    }

    // Insert the ticket with 'backlog' status for project tickets
    await client.query(
      `INSERT INTO tickets (company_id, creator_id, title, description, priority, estimate_amount, estimate_unit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'backlog')`,
      [project.company_id, req.user.id, title.trim(), sanitizeHtml(description || ''), priority || 'medium', estimate.amount, estimate.unit]
    );

    // Get the inserted ticket with all fields needed by mobile
    const result = await client.query(
      `SELECT t.id, t.company_id, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.estimate_amount, t.estimate_unit, t.created_at, t.updated_at, t.resolved_at,
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
    await recordStatusChange(client, ticketId, null, 'backlog', req.user.id);

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

// Save the backlog's manual order (migration 087). Body: { order: [ticket
// ids in display order] } -- the backlog list sends every ticket and split
// parent it shows, flattened (a group's parent, then its subtasks), so one
// sequence orders both the top level and each group. Only the given
// tickets are touched; each must be in this project.
const MAX_BACKLOG_ORDER = 5000;

router.put('/:id/backlog-order', authenticate, async (req, res) => {
  const { order } = req.body;
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) return res.status(404).json({ message: 'Project not found' });
    if (!access.canWork) return res.status(403).json({ message: 'Not authorized to reorder this backlog' });

    if (!Array.isArray(order) || order.length === 0 || order.length > MAX_BACKLOG_ORDER) {
      return res.status(400).json({ message: 'order must be a non-empty list of ticket ids' });
    }
    const ids = order.map(Number);
    if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ message: 'order must list each ticket id once' });
    }

    const inList = ids.map((_, i) => `$${i + 2}`).join(', ');
    const found = await client.query(
      `SELECT ticket_id FROM ticket_projects WHERE project_id = $1 AND ticket_id IN (${inList})`,
      [req.params.id, ...ids]
    );
    if (found.rowCount !== ids.length) {
      return res.status(400).json({ message: 'Some of those tickets are not in this project' });
    }

    // One UPDATE: rank = position in the list
    const values = [req.params.id];
    const cases = ids.map((id, rank) => {
      values.push(id, rank);
      return `WHEN $${values.length - 1} THEN $${values.length}`;
    }).join(' ');
    values.push(...ids);
    const idPlaceholders = ids.map((_, i) => `$${values.length - ids.length + i + 1}`).join(', ');
    await client.query(
      `UPDATE ticket_projects SET backlog_rank = CASE ticket_id ${cases} END
       WHERE project_id = $1 AND ticket_id IN (${idPlaceholders})`,
      values
    );

    res.json({ message: 'Backlog order saved', count: ids.length });
  } catch (err) {
    console.error('Error saving backlog order:', err);
    res.status(500).json({ message: 'Failed to save backlog order' });
  } finally {
    client.release();
  }
});

// Burndown chart data: every ticket in the project (any status) with its
// estimate, plus the full status history to replay. Same view rule as the
// project board.
router.get('/:id/burndown', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!access.canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const project = await client.query(
      'SELECT id, title, sprint_duration_days, created_at FROM projects WHERE id = $1',
      [req.params.id]
    );
    const tickets = await client.query(
      `SELECT t.id, t.parent_ticket_id, t.split_mode, t.title, t.status, t.estimate_amount, t.estimate_unit,
              t.created_at, t.updated_at, t.resolved_at
       FROM tickets t
       JOIN ticket_projects tp ON tp.ticket_id = t.id
       WHERE tp.project_id = $1
       ORDER BY t.id`,
      [req.params.id]
    );

    res.json({
      project: project.rows[0],
      tickets: tickets.rows,
      history: await getProjectStatusHistory(client, req.params.id)
    });
  } catch (err) {
    console.error('Error fetching burndown data:', err);
    res.status(500).json({ message: 'Failed to fetch burndown data' });
  } finally {
    client.release();
  }
});

// ---- Project settings + members (migration 082) ----
// Roles and who may do what: see utilities/projectAccess.js. Owners/managers
// (and company owners/admins) manage; only owners (and company owners/admins)
// can grant the owner role or change/remove an owner.

async function getProjectMembers(client, projectId) {
  const result = await client.query(
    `SELECT pm.user_id, pm.role, pm.status, pm.invited_at, pm.joined_at,
            u.handle, u.first_name, u.last_name, u.photo_path,
            inviter.handle as inviter_handle,
            EXISTS (
              SELECT 1 FROM employees e
              WHERE e.user_id = pm.user_id AND e.company_id = p.company_id AND e.status = 'active'
            ) AS is_employee
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     JOIN users u ON u.id = pm.user_id
     LEFT JOIN users inviter ON inviter.id = pm.invited_by
     WHERE pm.project_id = $1 AND pm.status IN ('active', 'invited')
     ORDER BY pm.status = 'invited',
              FIELD(pm.role, 'owner', 'manager', 'member', 'viewer'),
              u.first_name, u.last_name, u.handle`,
    [projectId]
  );
  return result.rows.map(m => ({ ...m, is_employee: !!m.is_employee }));
}

// Refuses (returns an error message) if this change would leave the project
// without an active owner.
async function lastOwnerError(client, projectId, member) {
  if (member.status !== 'active' || member.role !== 'owner') return null;
  const owners = await client.query(
    `SELECT COUNT(*) as count FROM project_members
     WHERE project_id = $1 AND role = 'owner' AND status = 'active'`,
    [projectId]
  );
  return parseInt(owners.rows[0].count) <= 1
    ? 'A project needs at least one owner. Make someone else an owner first.'
    : null;
}

async function getMemberRow(client, projectId, userId) {
  const result = await client.query(
    'SELECT user_id, role, status FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId]
  );
  return result.rows[0] || null;
}

// Settings page data: settings, members (with pending invites), and what the
// current user may change. Open to employees and project members.
router.get('/:id/settings', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!access.isEmployee && !access.memberRole) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const settings = await client.query(
      'SELECT sprint_duration_days FROM projects WHERE id = $1',
      [req.params.id]
    );

    res.json({
      settings: settings.rows[0],
      sprint_durations: SPRINT_DURATIONS,
      members: await getProjectMembers(client, req.params.id),
      roles: PROJECT_ROLES,
      current_user_id: req.user.id,
      can_manage: access.canManage,
      can_manage_owners: access.isOwner
    });
  } catch (err) {
    console.error('Error fetching project settings:', err);
    res.status(500).json({ message: 'Failed to fetch project settings' });
  } finally {
    client.release();
  }
});

// Update project settings (owners/managers)
router.put('/:id/settings', authenticate, async (req, res) => {
  const { sprint_duration_days } = req.body;
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!access.canManage) {
      return res.status(403).json({ message: 'Only project owners and managers can change settings' });
    }

    if (sprint_duration_days !== undefined) {
      const days = parseInt(sprint_duration_days, 10);
      if (!SPRINT_DURATIONS.includes(days)) {
        return res.status(400).json({ message: 'Sprint duration must be 1, 2, 3 or 4 weeks' });
      }
      await client.query(
        'UPDATE projects SET sprint_duration_days = $1 WHERE id = $2',
        [days, req.params.id]
      );
    }

    const settings = await client.query(
      'SELECT sprint_duration_days FROM projects WHERE id = $1',
      [req.params.id]
    );
    res.json({ settings: settings.rows[0] });
  } catch (err) {
    console.error('Error updating project settings:', err);
    res.status(500).json({ message: 'Failed to update project settings' });
  } finally {
    client.release();
  }
});

// Autocomplete for the invite box: up to 10 people whose handle, first,
// last or full name contains q (case-insensitive). Ranked: people in the
// project's company first, then names/handles that start with q, then the
// rest; alphabetical by handle within a tier. Guests and anyone already
// on the project (active or invited) are left out; emails are never sent.
const INVITE_SUGGESTION_LIMIT = 10;

router.get('/:id/invite-suggestions', authenticate, async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase();
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) return res.status(404).json({ message: 'Project not found' });
    if (!access.canManage) {
      return res.status(403).json({ message: 'Only project owners and managers can invite members' });
    }
    if (q.length < 2 || q.length > 100) return res.json({ users: [] });

    const escaped = q.replace(/[\\%_]/g, c => `\\${c}`);
    const result = await client.query(
      `SELECT u.id AS user_id, u.handle, u.first_name, u.last_name,
              EXISTS (
                SELECT 1 FROM employees e
                WHERE e.user_id = u.id AND e.company_id = $1 AND e.status = 'active'
              ) AS in_company,
              (LOWER(u.handle) LIKE $2 OR LOWER(u.first_name) LIKE $2 OR LOWER(u.last_name) LIKE $2
               OR LOWER(CONCAT_WS(' ', u.first_name, u.last_name)) LIKE $2) AS starts_with
       FROM users u
       WHERE (u.is_guest IS NULL OR u.is_guest = FALSE)
         AND (LOWER(u.handle) LIKE $3 OR LOWER(u.first_name) LIKE $3 OR LOWER(u.last_name) LIKE $3
              OR LOWER(CONCAT_WS(' ', u.first_name, u.last_name)) LIKE $3)
         AND NOT EXISTS (
           SELECT 1 FROM project_members pm
           WHERE pm.project_id = $4 AND pm.user_id = u.id AND pm.status IN ('active', 'invited')
         )
       ORDER BY in_company DESC, starts_with DESC, LOWER(u.handle)
       LIMIT ${INVITE_SUGGESTION_LIMIT}`,
      [access.project.company_id, `${escaped}%`, `%${escaped}%`, req.params.id]
    );

    res.json({
      users: result.rows.map(r => ({
        user_id: r.user_id,
        handle: r.handle,
        first_name: r.first_name,
        last_name: r.last_name,
        in_company: !!r.in_company
      }))
    });
  } catch (err) {
    console.error('Error fetching invite suggestions:', err);
    res.status(500).json({ message: 'Failed to search people' });
  } finally {
    client.release();
  }
});

// Invite a Prosaurus user (by handle or account email) to the project
router.post('/:id/members', authenticate, async (req, res) => {
  const { identifier } = req.body;
  const role = req.body.role || 'member';
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!access.canManage) {
      return res.status(403).json({ message: 'Only project owners and managers can invite members' });
    }
    if (!PROJECT_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    if (role === 'owner' && !access.isOwner) {
      return res.status(403).json({ message: 'Only project owners can invite another owner' });
    }

    const lookup = (identifier || '').trim().replace(/^@/, '');
    if (!lookup) {
      return res.status(400).json({ message: 'Enter a handle or email address' });
    }
    const target = await client.query(
      `SELECT id, handle, email, first_name, last_name,
              alternate_email, alternate_email_verified, send_notices_to_alternate_email
       FROM users WHERE handle = $1 OR email = $2`,
      [lookup, lookup.toLowerCase()]
    );
    if (target.rowCount === 0) {
      return res.status(404).json({ message: 'No Prosaurus user has that handle or email' });
    }
    const targetUser = target.rows[0];

    const existing = await getMemberRow(client, req.params.id, targetUser.id);
    if (existing?.status === 'active') {
      return res.status(409).json({ message: `@${targetUser.handle} is already a member` });
    }
    if (existing?.status === 'invited') {
      return res.status(409).json({ message: `@${targetUser.handle} already has a pending invite` });
    }
    if (existing) {
      // declined earlier -- invite again
      await client.query(
        `UPDATE project_members
         SET role = $3, status = 'invited', invited_by = $4, invited_at = CURRENT_TIMESTAMP, joined_at = NULL
         WHERE project_id = $1 AND user_id = $2`,
        [req.params.id, targetUser.id, role, req.user.id]
      );
    } else {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role, status, invited_by)
         VALUES ($1, $2, $3, 'invited', $4)`,
        [req.params.id, targetUser.id, role, req.user.id]
      );
    }

    // Email the invitee; the invite itself waits on their Projects page
    const [projectRow, fromRow] = await Promise.all([
      client.query(
        `SELECT p.title, c.name as company_name FROM projects p
         JOIN companies c ON c.id = p.company_id WHERE p.id = $1`,
        [req.params.id]
      ),
      client.query(`SELECT from_address FROM system_emails WHERE is_active = true LIMIT 1`)
    ]);
    const { title, company_name } = projectRow.rows[0];
    const inviterName = req.user.first_name || `@${req.user.handle}`;
    const fromAddress = fromRow.rowCount > 0 ? fromRow.rows[0].from_address : 'noreply@prosaurus.com';
    const appUrl = process.env.APP_URL || process.env.CORS_ORIGIN || 'https://www.prosaurus.com';
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
        <h2>You've been invited to a project</h2>
        <p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(title)}</strong>
           (${escapeHtml(company_name)}) on Prosaurus as a ${role}.</p>
        <p style="margin:30px 0">
          <a href="${appUrl}/projects" style="background:#007bff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
            View Invite
          </a>
        </p>
        <p style="color:#666;font-size:0.9em">Log in to Prosaurus and open Projects to accept or decline.</p>
      </div>
    `;
    sendMailToUser(targetUser, fromAddress, `${inviterName} invited you to ${title} on Prosaurus`, html)
      .catch(err => console.error('Error sending project invite email:', err));

    res.status(201).json({
      message: `Invite sent to @${targetUser.handle}`,
      members: await getProjectMembers(client, req.params.id)
    });
  } catch (err) {
    console.error('Error inviting project member:', err);
    res.status(500).json({ message: 'Failed to send invite' });
  } finally {
    client.release();
  }
});

// Change a member's (or pending invitee's) role
router.put('/:id/members/:userId', authenticate, async (req, res) => {
  const { role } = req.body;
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }
    if (!access.canManage) {
      return res.status(403).json({ message: 'Only project owners and managers can change roles' });
    }
    if (!PROJECT_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const member = await getMemberRow(client, req.params.id, req.params.userId);
    if (!member || member.status === 'declined') {
      return res.status(404).json({ message: 'Member not found' });
    }
    if ((member.role === 'owner' || role === 'owner') && !access.isOwner) {
      return res.status(403).json({ message: 'Only project owners can change the owner role' });
    }
    if (role !== 'owner') {
      const ownerError = await lastOwnerError(client, req.params.id, member);
      if (ownerError) return res.status(400).json({ message: ownerError });
    }

    await client.query(
      'UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3',
      [role, req.params.id, req.params.userId]
    );

    res.json({ members: await getProjectMembers(client, req.params.id) });
  } catch (err) {
    console.error('Error changing project member role:', err);
    res.status(500).json({ message: 'Failed to change role' });
  } finally {
    client.release();
  }
});

// Remove a member or cancel an invite (managers), or leave the project (self)
router.delete('/:id/members/:userId', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const access = await getProjectAccess(client, req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const member = await getMemberRow(client, req.params.id, req.params.userId);
    if (!member || member.status === 'declined') {
      return res.status(404).json({ message: 'Member not found' });
    }

    const isSelf = member.user_id === req.user.id;
    if (!isSelf) {
      if (!access.canManage) {
        return res.status(403).json({ message: 'Only project owners and managers can remove members' });
      }
      if (member.role === 'owner' && !access.isOwner) {
        return res.status(403).json({ message: 'Only project owners can remove an owner' });
      }
    }
    const ownerError = await lastOwnerError(client, req.params.id, member);
    if (ownerError) return res.status(400).json({ message: ownerError });

    await client.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );

    res.json({ members: await getProjectMembers(client, req.params.id) });
  } catch (err) {
    console.error('Error removing project member:', err);
    res.status(500).json({ message: 'Failed to remove member' });
  } finally {
    client.release();
  }
});

// Accept / decline your own pending invite
router.post('/:id/invite/:response', authenticate, async (req, res) => {
  const { id, response } = req.params;
  if (response !== 'accept' && response !== 'decline') {
    return res.status(404).json({ message: 'Not found' });
  }
  const client = await getClient();

  try {
    const member = await getMemberRow(client, id, req.user.id);
    if (!member || member.status !== 'invited') {
      return res.status(404).json({ message: 'No pending invite for this project' });
    }

    if (response === 'accept') {
      await client.query(
        `UPDATE project_members SET status = 'active', joined_at = CURRENT_TIMESTAMP
         WHERE project_id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
    } else {
      await client.query(
        `UPDATE project_members SET status = 'declined' WHERE project_id = $1 AND user_id = $2`,
        [id, req.user.id]
      );
    }

    res.json({ message: response === 'accept' ? 'Invite accepted' : 'Invite declined' });
  } catch (err) {
    console.error('Error responding to project invite:', err);
    res.status(500).json({ message: 'Failed to respond to invite' });
  } finally {
    client.release();
  }
});

module.exports = router;
