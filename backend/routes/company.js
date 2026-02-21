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

// Search companies by name
router.get('/search', authenticate, async (req, res) => {
  const { q } = req.query;
  const client = await getClient();

  try {
    if (!q || q.trim().length < 2) {
      return res.json({ companies: [] });
    }

    const result = await client.query(
      `SELECT id, name, description, city, state, country
       FROM companies
       WHERE name LIKE $1
       ORDER BY name
       LIMIT 20`,
      [`%${q.trim()}%`]
    );

    res.json({ companies: result.rows });
  } catch (err) {
    console.error('Error searching companies:', err);
    res.status(500).json({ message: 'Failed to search companies' });
  } finally {
    client.release();
  }
});

// Get company details with employees
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    const companyResult = await client.query(
      'SELECT * FROM companies WHERE id = $1',
      [id]
    );

    if (companyResult.rowCount === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const employeesResult = await client.query(
      `SELECT e.id, e.title, e.department, e.hire_date, e.is_owner, e.is_admin, e.status,
              u.id as user_id, u.handle, u.first_name, u.last_name, u.photo_path
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.company_id = $1 AND e.status = 'active'
       ORDER BY e.is_owner DESC, e.is_admin DESC, u.first_name, u.last_name`,
      [id]
    );

    // Check if current user is an employee
    const userEmployee = employeesResult.rows.find(e => e.user_id === req.user.id);

    res.json({
      company: companyResult.rows[0],
      employees: employeesResult.rows,
      userRole: userEmployee ? {
        is_owner: userEmployee.is_owner,
        is_admin: userEmployee.is_admin,
        title: userEmployee.title
      } : null
    });
  } catch (err) {
    console.error('Error fetching company:', err);
    res.status(500).json({ message: 'Failed to fetch company' });
  } finally {
    client.release();
  }
});

// Create a new company (with creator as owner/employee)
router.post('/', authenticate, async (req, res) => {
  const { name, description, address, city, state, country, postal_code, phone, email, website, employee_title } = req.body;
  const client = await getClient();

  try {
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Company name is required' });
    }

    // Create company
    await client.query(
      `INSERT INTO companies (name, description, address, city, state, country, postal_code, phone, email, website)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [name.trim(), description || null, address || null, city || null, state || null,
       country || null, postal_code || null, phone || null, email || null, website || null]
    );

    // Get the new company ID
    const companyResult = await client.query(
      'SELECT id FROM companies WHERE name = $1 ORDER BY id DESC LIMIT 1',
      [name.trim()]
    );
    const companyId = companyResult.rows[0].id;

    // Add creator as owner/employee
    await client.query(
      `INSERT INTO employees (user_id, company_id, title, is_owner, is_admin, hire_date)
       VALUES ($1, $2, $3, TRUE, TRUE, CURDATE())`,
      [req.user.id, companyId, employee_title || 'Owner']
    );

    // Create default project for the company (public by default)
    await client.query(
      `INSERT INTO projects (company_id, title, description, is_default, is_public)
       VALUES ($1, 'Project #1', 'Your first project - rename it anytime!', TRUE, TRUE)`,
      [companyId]
    );

    // Get full company data
    const fullCompanyResult = await client.query(
      'SELECT * FROM companies WHERE id = $1',
      [companyId]
    );

    res.status(201).json({
      company: fullCompanyResult.rows[0],
      message: 'Company created successfully'
    });
  } catch (err) {
    console.error('Error creating company:', err);
    res.status(500).json({ message: 'Failed to create company' });
  } finally {
    client.release();
  }
});

// Get companies the current user belongs to
router.get('/my/list', authenticate, async (req, res) => {
  const client = await getClient();

  try {
    const result = await client.query(
      `SELECT c.id, c.name, c.description, c.city, c.state,
              e.title, e.is_owner, e.is_admin, e.status
       FROM companies c
       JOIN employees e ON c.id = e.company_id
       WHERE e.user_id = $1 AND e.status = 'active'
       ORDER BY e.is_owner DESC, c.name`,
      [req.user.id]
    );

    res.json({ companies: result.rows });
  } catch (err) {
    console.error('Error fetching user companies:', err);
    res.status(500).json({ message: 'Failed to fetch companies' });
  } finally {
    client.release();
  }
});

// Join a company as employee (pending approval)
router.post('/:id/join', authenticate, async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  const client = await getClient();

  try {
    // Check if company exists
    const companyResult = await client.query('SELECT id, name FROM companies WHERE id = $1', [id]);
    if (companyResult.rowCount === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Check if already an employee
    const existingResult = await client.query(
      'SELECT id, status FROM employees WHERE user_id = $1 AND company_id = $2',
      [req.user.id, id]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ message: 'Already associated with this company' });
    }

    // Add as pending employee
    await client.query(
      `INSERT INTO employees (user_id, company_id, title, status)
       VALUES ($1, $2, $3, 'pending')`,
      [req.user.id, id, title || 'Employee']
    );

    res.status(201).json({ message: 'Join request submitted' });
  } catch (err) {
    console.error('Error joining company:', err);
    res.status(500).json({ message: 'Failed to join company' });
  } finally {
    client.release();
  }
});

// Get all employees for a company (including pending) - owner/admin only
router.get('/:id/employees', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, id, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to view all employees' });
    }

    const result = await client.query(
      `SELECT e.id, e.user_id, e.title, e.department, e.hire_date, e.is_owner, e.is_admin, e.status,
              u.handle, u.first_name, u.last_name, u.email, u.photo_path
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.company_id = $1
       ORDER BY e.status, e.is_owner DESC, e.is_admin DESC, u.first_name, u.last_name`,
      [id]
    );

    res.json({ employees: result.rows });
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ message: 'Failed to fetch employees' });
  } finally {
    client.release();
  }
});

// Search users to add as employees
router.get('/:id/employees/search', authenticate, async (req, res) => {
  const { id } = req.params;
  const { q } = req.query;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, id, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!q || q.trim().length < 2) {
      return res.json({ users: [] });
    }

    // Search users not already in this company
    const result = await client.query(
      `SELECT u.id, u.handle, u.first_name, u.last_name, u.email, u.photo_path
       FROM users u
       WHERE (u.handle LIKE $1 OR u.first_name LIKE $1 OR u.last_name LIKE $1 OR u.email LIKE $1)
         AND u.id NOT IN (SELECT user_id FROM employees WHERE company_id = $2)
       ORDER BY u.first_name, u.last_name
       LIMIT 10`,
      [`%${q.trim()}%`, id]
    );

    res.json({ users: result.rows });
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ message: 'Failed to search users' });
  } finally {
    client.release();
  }
});

// Add employee to company (owner/admin only)
router.post('/:id/employees', authenticate, async (req, res) => {
  const { id } = req.params;
  const { user_id, title, department, is_admin, hire_date } = req.body;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, id, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to add employees' });
    }

    if (!user_id) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Check if user exists
    const userResult = await client.query('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already an employee
    const existingResult = await client.query(
      'SELECT id FROM employees WHERE user_id = $1 AND company_id = $2',
      [user_id, id]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ message: 'User is already an employee of this company' });
    }

    // Add employee
    await client.query(
      `INSERT INTO employees (user_id, company_id, title, department, is_admin, hire_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [user_id, id, title || 'Employee', department || null, is_admin || false, hire_date || new Date().toISOString().split('T')[0]]
    );

    // Get the new employee with user info
    const result = await client.query(
      `SELECT e.id, e.user_id, e.title, e.department, e.hire_date, e.is_owner, e.is_admin, e.status,
              u.handle, u.first_name, u.last_name, u.email, u.photo_path
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.user_id = $1 AND e.company_id = $2`,
      [user_id, id]
    );

    res.status(201).json({ employee: result.rows[0], message: 'Employee added successfully' });
  } catch (err) {
    console.error('Error adding employee:', err);
    res.status(500).json({ message: 'Failed to add employee' });
  } finally {
    client.release();
  }
});

// Update employee (owner/admin only)
router.put('/:id/employees/:employeeId', authenticate, async (req, res) => {
  const { id, employeeId } = req.params;
  const { title, department, is_admin, status, hire_date } = req.body;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, id, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to update employees' });
    }

    // Get the employee being updated
    const empResult = await client.query(
      'SELECT is_owner, user_id FROM employees WHERE id = $1 AND company_id = $2',
      [employeeId, id]
    );

    if (empResult.rowCount === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Cannot modify owner status (only one owner per company)
    if (empResult.rows[0].is_owner) {
      // Owner can only update their own title/department, not admin status
      if (empResult.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ message: 'Cannot modify company owner' });
      }
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (department !== undefined) {
      updates.push(`department = $${paramCount++}`);
      values.push(department);
    }
    if (is_admin !== undefined && !empResult.rows[0].is_owner) {
      updates.push(`is_admin = $${paramCount++}`);
      values.push(is_admin);
    }
    if (status !== undefined && !empResult.rows[0].is_owner) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (hire_date !== undefined) {
      updates.push(`hire_date = $${paramCount++}`);
      values.push(hire_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No updates provided' });
    }

    values.push(employeeId);
    await client.query(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated employee
    const result = await client.query(
      `SELECT e.id, e.user_id, e.title, e.department, e.hire_date, e.is_owner, e.is_admin, e.status,
              u.handle, u.first_name, u.last_name, u.email, u.photo_path
       FROM employees e
       JOIN users u ON e.user_id = u.id
       WHERE e.id = $1`,
      [employeeId]
    );

    res.json({ employee: result.rows[0] });
  } catch (err) {
    console.error('Error updating employee:', err);
    res.status(500).json({ message: 'Failed to update employee' });
  } finally {
    client.release();
  }
});

// Remove employee (owner/admin only)
router.delete('/:id/employees/:employeeId', authenticate, async (req, res) => {
  const { id, employeeId } = req.params;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2 AND status = $3',
      [req.user.id, id, 'active']
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to remove employees' });
    }

    // Get the employee being removed
    const empResult = await client.query(
      'SELECT is_owner FROM employees WHERE id = $1 AND company_id = $2',
      [employeeId, id]
    );

    if (empResult.rowCount === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Cannot remove owner
    if (empResult.rows[0].is_owner) {
      return res.status(403).json({ message: 'Cannot remove company owner' });
    }

    await client.query('DELETE FROM employees WHERE id = $1', [employeeId]);

    res.json({ message: 'Employee removed successfully' });
  } catch (err) {
    console.error('Error removing employee:', err);
    res.status(500).json({ message: 'Failed to remove employee' });
  } finally {
    client.release();
  }
});

// Update company (owner/admin only)
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, description, address, city, state, country, postal_code, phone, email, website } = req.body;
  const client = await getClient();

  try {
    // Check if user is owner or admin
    const authResult = await client.query(
      'SELECT is_owner, is_admin FROM employees WHERE user_id = $1 AND company_id = $2',
      [req.user.id, id]
    );

    if (authResult.rowCount === 0 || (!authResult.rows[0].is_owner && !authResult.rows[0].is_admin)) {
      return res.status(403).json({ message: 'Not authorized to update this company' });
    }

    await client.query(
      `UPDATE companies SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        address = COALESCE($3, address),
        city = COALESCE($4, city),
        state = COALESCE($5, state),
        country = COALESCE($6, country),
        postal_code = COALESCE($7, postal_code),
        phone = COALESCE($8, phone),
        email = COALESCE($9, email),
        website = COALESCE($10, website)
       WHERE id = $11`,
      [name, description, address, city, state, country, postal_code, phone, email, website, id]
    );

    const result = await client.query('SELECT * FROM companies WHERE id = $1', [id]);
    res.json({ company: result.rows[0] });
  } catch (err) {
    console.error('Error updating company:', err);
    res.status(500).json({ message: 'Failed to update company' });
  } finally {
    client.release();
  }
});

// Delete company (owner only)
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();

  try {
    // Only the owner can delete
    const authResult = await client.query(
      'SELECT is_owner FROM employees WHERE user_id = $1 AND company_id = $2',
      [req.user.id, id]
    );

    if (authResult.rowCount === 0 || !authResult.rows[0].is_owner) {
      return res.status(403).json({ message: 'Only the company owner can delete this company' });
    }

    await client.query('DELETE FROM companies WHERE id = $1', [id]);

    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    console.error('Error deleting company:', err);
    res.status(500).json({ message: 'Failed to delete company' });
  } finally {
    client.release();
  }
});

module.exports = router;
