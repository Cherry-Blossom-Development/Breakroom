const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getClient } = require('../utilities/db');
const { extractToken } = require('../utilities/auth');
const { getTicketDependencyEdges, wouldCreateCycle } = require('../utilities/ticketDependencies');
const { CREATOR_STATUSES, getTicketAccess, canBeAssigned } = require('../utilities/ticketAccess');
const { parseEstimate } = require('../utilities/ticketEstimates');
const { recordStatusChange } = require('../utilities/ticketStatusHistory');
const { sanitizeHtml } = require('../utilities/sanitizeHtml');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { uploadToS3, deleteFromS3, streamFromS3 } = require('../utilities/aws-s3');
const {
  uploadFiles, cleanFileName, isInlineType, contentDisposition, getTicketAttachments
} = require('../utilities/ticketAttachments');

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

    const empResult = await client.query(
      `SELECT 1 FROM employees WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [req.user.id, id]
    );

    res.json({ company: result.rows[0], isEmployee: empResult.rowCount > 0 });
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
    const access = await getTicketAccess(client, id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    if (!access.canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const result = await client.query(
      `SELECT t.id, t.parent_ticket_id, t.split_mode, t.title, t.description, t.status, t.priority, t.estimate_amount, t.estimate_unit,
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
      [company_id, req.user.id, title.trim(), sanitizeHtml(description || ''), priority || 'medium']
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
    await recordStatusChange(client, ticketId, null, result.rows[0].status, req.user.id);

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
  const { title, description, status, priority, assigned_to, estimate_amount, estimate_unit } = req.body;
  const client = await getClient();

  try {
    // Employees of the ticket's company (and working project members) can
    // change anything; any other creator can only edit their own ticket's
    // text/priority and mark it resolved/closed; everyone else is refused
    // (see utilities/ticketAccess.js).
    const access = await getTicketAccess(client, id, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    if (!access.canWork) {
      if (!access.isCreator) {
        return res.status(403).json({ message: 'Not authorized to update this ticket' });
      }
      if (assigned_to !== undefined || estimate_amount !== undefined) {
        return res.status(403).json({ message: 'Only company employees can assign or estimate tickets' });
      }
      if (status !== undefined && !CREATOR_STATUSES.includes(status)) {
        return res.status(403).json({ message: 'Only company employees can move tickets to that status' });
      }
    }

    // An assignee must be an active employee of the ticket's company or a
    // working member of one of its projects
    if (assigned_to && !(await canBeAssigned(client, access.ticket, assigned_to))) {
      return res.status(400).json({ message: 'Assignee must be an employee of this company or a member of the project' });
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
      values.push(sanitizeHtml(description));
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
    if (estimate_amount !== undefined) {
      const estimate = parseEstimate(estimate_amount, estimate_unit);
      if (estimate.error) {
        return res.status(400).json({ message: estimate.error });
      }
      updates.push(`estimate_amount = $${paramCount++}`);
      values.push(estimate.value.amount);
      updates.push(`estimate_unit = $${paramCount++}`);
      values.push(estimate.value.unit);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(id);
    await client.query(
      `UPDATE tickets SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    if (status !== undefined) {
      await recordStatusChange(client, access.ticket.id, access.ticket.status, status, req.user.id);
    }

    // Get updated ticket with all fields needed by mobile
    const result = await client.query(
      `SELECT t.id, t.company_id, t.parent_ticket_id, t.split_mode, t.creator_id, t.assigned_to, t.title, t.description, t.status, t.priority,
              t.estimate_amount, t.estimate_unit, t.created_at, t.updated_at, t.resolved_at,
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

// Ticket dependencies (migration 079) -- only active employees of the
// ticket's company (and working project members) can change them. Both endpoints respond with every edge
// touching the ticket (see utilities/ticketDependencies.js) so the client
// can swap in the fresh set without refetching the whole board.
async function requireTicketEmployee(client, ticketId, userId) {
  const access = await getTicketAccess(client, ticketId, userId);
  return access?.canWork ? access.ticket : null;
}

// Add a dependency: :id can't finish until depends_on_ticket_id does
router.post('/ticket/:id/dependencies', authenticate, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const dependsOnId = parseInt(req.body.depends_on_ticket_id, 10);
  const client = await getClient();

  try {
    if (!Number.isInteger(dependsOnId)) {
      return res.status(400).json({ message: 'depends_on_ticket_id is required' });
    }
    if (dependsOnId === ticketId) {
      return res.status(400).json({ message: 'A ticket cannot depend on itself' });
    }

    const ticket = await requireTicketEmployee(client, ticketId, req.user.id);
    if (!ticket) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const depCheck = await client.query('SELECT company_id FROM tickets WHERE id = $1', [dependsOnId]);
    if (depCheck.rowCount === 0) {
      return res.status(404).json({ message: 'Dependency ticket not found' });
    }
    if (depCheck.rows[0].company_id !== ticket.company_id) {
      return res.status(400).json({ message: 'Dependencies must be within the same company' });
    }

    const existing = await client.query(
      'SELECT 1 FROM ticket_dependencies WHERE ticket_id = $1 AND depends_on_ticket_id = $2',
      [ticketId, dependsOnId]
    );
    if (existing.rowCount === 0) {
      if (await wouldCreateCycle(client, ticketId, dependsOnId)) {
        return res.status(400).json({
          message: `Ticket #${dependsOnId} already depends on #${ticketId} (directly or indirectly), so this would create a loop`
        });
      }
      await client.query(
        'INSERT INTO ticket_dependencies (ticket_id, depends_on_ticket_id, created_by) VALUES ($1, $2, $3)',
        [ticketId, dependsOnId, req.user.id]
      );
    }

    res.status(201).json({ dependencies: await getTicketDependencyEdges(client, ticketId) });
  } catch (err) {
    console.error('Error adding ticket dependency:', err);
    res.status(500).json({ message: 'Failed to add dependency' });
  } finally {
    client.release();
  }
});

// Remove a dependency
router.delete('/ticket/:id/dependencies/:dependsOnId', authenticate, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const dependsOnId = parseInt(req.params.dependsOnId, 10);
  const client = await getClient();

  try {
    const ticket = await requireTicketEmployee(client, ticketId, req.user.id);
    if (!ticket) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await client.query(
      'DELETE FROM ticket_dependencies WHERE ticket_id = $1 AND depends_on_ticket_id = $2',
      [ticketId, dependsOnId]
    );

    res.json({ dependencies: await getTicketDependencyEdges(client, ticketId) });
  } catch (err) {
    console.error('Error removing ticket dependency:', err);
    res.status(500).json({ message: 'Failed to remove dependency' });
  } finally {
    client.release();
  }
});

// Get comments for a ticket
router.get('/ticket/:ticketId/comments', authenticate, async (req, res) => {
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

    const result = await client.query(
      `SELECT tc.id, tc.ticket_id, tc.user_id, tc.content, tc.is_deleted,
              tc.created_at, tc.updated_at, u.handle
       FROM ticket_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.ticket_id = $1
       ORDER BY tc.created_at ASC`,
      [ticketId]
    );

    res.json({ comments: result.rows });
  } catch (err) {
    console.error('Error fetching ticket comments:', err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  } finally {
    client.release();
  }
});

// Add a comment to a ticket
router.post('/ticket/:ticketId/comments', authenticate, async (req, res) => {
  const { ticketId } = req.params;
  const { content } = req.body;
  const client = await getClient();

  try {
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const access = await getTicketAccess(client, ticketId, req.user.id);
    if (!access) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    if (!access.canView) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await client.query(
      'INSERT INTO ticket_comments (ticket_id, user_id, content) VALUES ($1, $2, $3)',
      [ticketId, req.user.id, content.trim()]
    );

    const result = await client.query(
      `SELECT tc.id, tc.ticket_id, tc.user_id, tc.content, tc.is_deleted,
              tc.created_at, tc.updated_at, u.handle
       FROM ticket_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.user_id = $1 AND tc.ticket_id = $2
       ORDER BY tc.id DESC LIMIT 1`,
      [req.user.id, ticketId]
    );

    res.status(201).json({ comment: result.rows[0] });
  } catch (err) {
    console.error('Error adding ticket comment:', err);
    res.status(500).json({ message: 'Failed to add comment' });
  } finally {
    client.release();
  }
});

// Edit own comment
router.put('/comment/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const client = await getClient();

  try {
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Content is required' });
    }

    const check = await client.query(
      'SELECT id, user_id FROM ticket_comments WHERE id = $1 AND is_deleted = 0',
      [id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Cannot edit another user\'s comment' });
    }

    await client.query(
      'UPDATE ticket_comments SET content = $1 WHERE id = $2',
      [content.trim(), id]
    );

    const result = await client.query(
      `SELECT tc.id, tc.ticket_id, tc.user_id, tc.content, tc.is_deleted,
              tc.created_at, tc.updated_at, u.handle
       FROM ticket_comments tc
       JOIN users u ON tc.user_id = u.id
       WHERE tc.id = $1`,
      [id]
    );

    res.json({ comment: result.rows[0] });
  } catch (err) {
    console.error('Error updating ticket comment:', err);
    res.status(500).json({ message: 'Failed to update comment' });
  } finally {
    client.release();
  }
});

// Soft-delete own comment
router.delete('/comment/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const check = await client.query(
      'SELECT id, user_id FROM ticket_comments WHERE id = $1 AND is_deleted = 0',
      [id]
    );
    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    if (check.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Cannot delete another user\'s comment' });
    }

    await client.query(
      'UPDATE ticket_comments SET is_deleted = 1 WHERE id = $1',
      [id]
    );

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('Error deleting ticket comment:', err);
    res.status(500).json({ message: 'Failed to delete comment' });
  } finally {
    client.release();
  }
});

// ---- Split a ticket into subtasks (migration 086) ----
// Creates the subtasks as ordinary tickets (same company, projects,
// priority and assignee as the parent; parent_ticket_id set) and records on
// the parent what became of it: 'hidden' or 'category'. A parent that was
// already split can be split again to add more subtasks; it keeps its
// original mode. Subtasks can't be split themselves (one level only).
const SPLIT_MODES = ['hidden', 'category'];
const MAX_SUBTASKS = 20;

router.post('/ticket/:id/split', authenticate, async (req, res) => {
  const { mode, subtasks } = req.body;
  const client = await getClient();

  try {
    const access = await getTicketAccess(client, req.params.id, req.user.id);
    if (!access) return res.status(404).json({ message: 'Ticket not found' });
    if (!access.canWork) return res.status(403).json({ message: 'Not authorized to split this ticket' });

    const parentResult = await client.query(
      'SELECT id, company_id, parent_ticket_id, split_mode, status, priority, assigned_to FROM tickets WHERE id = $1',
      [req.params.id]
    );
    const parent = parentResult.rows[0];
    if (parent.parent_ticket_id) {
      return res.status(400).json({ message: 'A subtask can’t be split further' });
    }
    if (['resolved', 'closed'].includes(parent.status)) {
      return res.status(400).json({ message: 'A finished ticket can’t be split' });
    }
    const splitMode = parent.split_mode || mode;
    if (!SPLIT_MODES.includes(splitMode)) {
      return res.status(400).json({ message: 'Choose whether to hide the parent or make it a category' });
    }
    if (!Array.isArray(subtasks) || subtasks.length === 0 || subtasks.length > MAX_SUBTASKS) {
      return res.status(400).json({ message: `Add between 1 and ${MAX_SUBTASKS} subtasks` });
    }

    // Validate everything before writing anything
    const rows = [];
    for (const [i, sub] of subtasks.entries()) {
      const title = (sub?.title || '').trim();
      if (!title) return res.status(400).json({ message: `Subtask ${i + 1} needs a title` });
      if (title.length > 255) return res.status(400).json({ message: `Subtask ${i + 1}'s title is too long` });
      const estimate = parseEstimate(sub.estimate_amount, sub.estimate_unit);
      if (estimate.error) return res.status(400).json({ message: `Subtask ${i + 1}: ${estimate.error}` });
      rows.push({ title, estimate: estimate.value });
    }

    // Subtasks start where the parent is on the board, if it hasn't been
    // started; otherwise in the backlog
    const status = ['backlog', 'on-deck'].includes(parent.status) ? parent.status : 'backlog';

    await client.beginTransaction();
    try {
      const createdIds = [];
      for (const row of rows) {
        const result = await client.query(
          `INSERT INTO tickets (company_id, parent_ticket_id, creator_id, assigned_to, title, description,
                                priority, estimate_amount, estimate_unit, status)
           VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, $9)`,
          [parent.company_id, parent.id, req.user.id, parent.assigned_to, row.title,
           parent.priority, row.estimate.amount, row.estimate.unit, status]
        );
        const childId = result.insertId;
        createdIds.push(childId);
        await client.query(
          `INSERT INTO ticket_projects (ticket_id, project_id)
           SELECT $1, project_id FROM ticket_projects WHERE ticket_id = $2`,
          [childId, parent.id]
        );
        await recordStatusChange(client, childId, null, status, req.user.id);
      }
      await client.query('UPDATE tickets SET split_mode = $1 WHERE id = $2', [splitMode, parent.id]);
      await client.commit();

      res.status(201).json({ split_mode: splitMode, subtask_ids: createdIds });
    } catch (err) {
      await client.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Error splitting ticket:', err);
    res.status(500).json({ message: 'Failed to split ticket' });
  } finally {
    client.release();
  }
});

// ---- Ticket attachments (migration 085) ----
// Anyone who can view a ticket can list and open its attachments; people
// who can work it (employees, working project members) and its creator can
// attach files; the uploader or anyone who can work the ticket can remove
// one. Files stream through here, never straight from S3.

router.get('/ticket/:id/attachments', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const access = await getTicketAccess(client, req.params.id, req.user.id);
    if (!access) return res.status(404).json({ message: 'Ticket not found' });
    if (!access.canView) return res.status(403).json({ message: 'Access denied' });

    res.json({ attachments: await getTicketAttachments(client, req.params.id) });
  } catch (err) {
    console.error('Error fetching attachments:', err);
    res.status(500).json({ message: 'Failed to fetch attachments' });
  } finally {
    client.release();
  }
});

// Upload one or more files (multipart field "files")
router.post('/ticket/:id/attachments', authenticate, uploadFiles, async (req, res) => {
  const client = await getClient();
  const uploadedKeys = [];
  try {
    const access = await getTicketAccess(client, req.params.id, req.user.id);
    if (!access) return res.status(404).json({ message: 'Ticket not found' });
    if (!access.canWork && !access.isCreator) {
      return res.status(403).json({ message: 'Not authorized to attach files to this ticket' });
    }
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    // Everything goes to S3 first; rows are written only once all uploads
    // succeed, and a failure removes the ones that made it
    const rows = [];
    for (const file of req.files) {
      const fileName = cleanFileName(file.originalname);
      const ext = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 16);
      const key = `tickets/${access.ticket.id}/${uuidv4()}${ext}`;
      const contentType = file.mimetype || 'application/octet-stream';
      const result = await uploadToS3(file.buffer, key, contentType);
      if (!result.success) throw new Error(`Upload of ${fileName} failed`);
      uploadedKeys.push(key);
      rows.push([access.ticket.id, req.user.id, key, fileName, contentType, file.size]);
    }

    for (const row of rows) {
      await client.query(
        `INSERT INTO ticket_attachments (ticket_id, uploaded_by, s3_key, file_name, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        row
      );
    }

    res.status(201).json({ attachments: await getTicketAttachments(client, access.ticket.id) });
  } catch (err) {
    console.error('Error uploading attachments:', err);
    for (const key of uploadedKeys) await deleteFromS3(key);
    res.status(500).json({ message: 'Failed to upload attachments' });
  } finally {
    client.release();
  }
});

// Open / download one attachment. Raster images are served inline (for
// previews); everything else downloads.
router.get('/attachment/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT ticket_id, s3_key, file_name, content_type FROM ticket_attachments WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Attachment not found' });
    const attachment = result.rows[0];

    const access = await getTicketAccess(client, attachment.ticket_id, req.user.id);
    if (!access?.canView) return res.status(403).json({ message: 'Access denied' });

    const inline = isInlineType(attachment.content_type) && req.query.download === undefined;
    await streamFromS3(attachment.s3_key, req, res, {
      'Content-Disposition': contentDisposition(attachment.file_name, inline),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600'
    });
  } catch (err) {
    console.error('Error streaming attachment:', err);
    if (!res.headersSent) res.status(500).json({ message: 'Failed to open attachment' });
  } finally {
    client.release();
  }
});

router.delete('/attachment/:id', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      'SELECT ticket_id, uploaded_by, s3_key FROM ticket_attachments WHERE id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: 'Attachment not found' });
    const attachment = result.rows[0];

    const access = await getTicketAccess(client, attachment.ticket_id, req.user.id);
    const isUploader = attachment.uploaded_by === req.user.id;
    if (!access?.canWork && !(isUploader && access?.canView)) {
      return res.status(403).json({ message: 'Not authorized to remove this attachment' });
    }

    await client.query('DELETE FROM ticket_attachments WHERE id = $1', [req.params.id]);
    await deleteFromS3(attachment.s3_key);

    res.json({ attachments: await getTicketAttachments(client, attachment.ticket_id) });
  } catch (err) {
    console.error('Error deleting attachment:', err);
    res.status(500).json({ message: 'Failed to remove attachment' });
  } finally {
    client.release();
  }
});

module.exports = router;
