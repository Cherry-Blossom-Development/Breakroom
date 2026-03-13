const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { sendMail } = require('../utilities/aws-ses-email');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY;

// Authentication middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies.jwtToken;
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, SECRET_KEY);
    const client = await getClient();
    const user = await client.query(
      'SELECT id, handle FROM users WHERE handle = $1',
      [payload.username]
    );
    client.release();

    if (user.rowCount === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin permission check middleware
const requireAdmin = async (req, res, next) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT 1 FROM user_groups ug
       JOIN \`groups\` g ON ug.group_id = g.id
       WHERE ug.user_id = $1 AND g.name = 'Administrator'`,
      [req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();
  } catch (err) {
    console.error('Error checking admin permission:', err);
    return res.status(500).json({ message: 'Error checking permissions' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/system-emails
 * Returns all system email templates
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT id, email_key, from_address, subject, description, is_active, created_at, updated_at
       FROM system_emails
       ORDER BY email_key`
    );
    res.status(200).json({ emails: result.rows });
  } catch (err) {
    console.error('Error fetching system emails:', err);
    res.status(500).json({ message: 'Failed to fetch system emails' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/system-emails/:id
 * Returns a single system email template with full content
 */
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT id, email_key, from_address, subject, html_content, description, is_active
       FROM system_emails
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Email template not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching system email:', err);
    res.status(500).json({ message: 'Failed to fetch system email' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/system-emails
 * Create a new system email template
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { email_key, from_address, subject, html_content, description } = req.body;

  if (!email_key || !from_address || !subject || !html_content) {
    return res.status(400).json({ message: 'email_key, from_address, subject, and html_content are required' });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      `INSERT INTO system_emails (email_key, from_address, subject, html_content, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [email_key, from_address, subject, html_content, description || null]
    );

    res.status(201).json({
      message: 'Email template created',
      id: result.insertId
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'An email with this key already exists' });
    }
    console.error('Error creating system email:', err);
    res.status(500).json({ message: 'Failed to create email template' });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/system-emails/:id
 * Update an existing system email template
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { email_key, from_address, subject, html_content, description } = req.body;

  if (!email_key || !from_address || !subject || !html_content) {
    return res.status(400).json({ message: 'email_key, from_address, subject, and html_content are required' });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      `UPDATE system_emails
       SET email_key = $1, from_address = $2, subject = $3, html_content = $4, description = $5
       WHERE id = $6`,
      [email_key, from_address, subject, html_content, description || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Email template not found' });
    }

    res.status(200).json({ message: 'Email template updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'An email with this key already exists' });
    }
    console.error('Error updating system email:', err);
    res.status(500).json({ message: 'Failed to update email template' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/system-emails/send-custom
 * Send a custom email (with provided content, not from DB)
 */
router.post('/send-custom', authenticate, requireAdmin, async (req, res) => {
  const { recipients, from_address, subject, html_content } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: 'Recipients array is required' });
  }

  if (!from_address || !subject || !html_content) {
    return res.status(400).json({ message: 'from_address, subject, and html_content are required' });
  }

  // Validate email addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = recipients.filter(email => !emailRegex.test(email));
  if (invalidEmails.length > 0) {
    return res.status(400).json({ message: `Invalid email addresses: ${invalidEmails.join(', ')}` });
  }

  try {
    // Replace placeholders with test values
    let processedContent = html_content;
    processedContent = processedContent.replace(/\{\{verification_token\}\}/g, 'PREVIEW-TOKEN');
    processedContent = processedContent.replace(/\{\{first_name\}\}/g, 'User');
    processedContent = processedContent.replace(/\{\{last_name\}\}/g, '');
    processedContent = processedContent.replace(/\{\{handle\}\}/g, 'user');

    const results = [];
    for (const recipient of recipients) {
      const sendResult = await sendMail(recipient, from_address, subject, processedContent);
      results.push({
        email: recipient,
        success: sendResult.status === 200,
        message: sendResult.message
      });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.status(200).json({
      message: `Sent ${successCount} email(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
      results
    });
  } catch (err) {
    console.error('Error sending custom email:', err);
    res.status(500).json({ message: 'Failed to send email' });
  }
});

/**
 * POST /api/system-emails/:id/send
 * Send a system email to specified recipients
 */
router.post('/:id/send', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { recipients } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: 'Recipients array is required' });
  }

  // Validate email addresses
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalidEmails = recipients.filter(email => !emailRegex.test(email));
  if (invalidEmails.length > 0) {
    return res.status(400).json({ message: `Invalid email addresses: ${invalidEmails.join(', ')}` });
  }

  const client = await getClient();
  try {
    const result = await client.query(
      `SELECT email_key, from_address, subject, html_content
       FROM system_emails
       WHERE id = $1 AND is_active = true`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Email template not found or inactive' });
    }

    const { from_address, subject, html_content } = result.rows[0];

    // Replace placeholders with test values
    let processedContent = html_content;
    processedContent = processedContent.replace(/\{\{verification_token\}\}/g, 'PREVIEW-TOKEN');
    processedContent = processedContent.replace(/\{\{first_name\}\}/g, 'User');
    processedContent = processedContent.replace(/\{\{last_name\}\}/g, '');
    processedContent = processedContent.replace(/\{\{handle\}\}/g, 'user');

    const results = [];
    for (const recipient of recipients) {
      const sendResult = await sendMail(recipient, from_address, subject, processedContent);
      results.push({
        email: recipient,
        success: sendResult.status === 200,
        message: sendResult.message
      });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.status(200).json({
      message: `Sent ${successCount} email(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
      results
    });
  } catch (err) {
    console.error('Error sending system email:', err);
    res.status(500).json({ message: 'Failed to send email' });
  } finally {
    client.release();
  }
});

module.exports = router;
