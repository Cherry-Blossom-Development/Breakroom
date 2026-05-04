const express = require('express');
const router = express.Router();
const { getClient } = require('../utilities/db');
const { sendMail } = require('../utilities/aws-ses-email');

// IDs for filing anonymous support tickets
const SUPPORT_COMPANY_ID = 1;   // Cherry Blossom Development LLC
const SUPPORT_CREATOR_ID = 11;  // admin user
const SUPPORT_PROJECT_ID = 1;   // default project for company 1

const ADMIN_EMAIL = 'dallascaley@gmail.com';
const FROM_EMAIL  = 'noreply@prosaurus.com';

// POST /api/support  (no auth — public)
router.post('/', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });
  if (!email || !email.trim()) return res.status(400).json({ message: 'Email is required' });
  if (!subject || !subject.trim()) return res.status(400).json({ message: 'Subject is required' });
  if (!message || !message.trim()) return res.status(400).json({ message: 'Message is required' });

  const description = `Support request from: ${name.trim()} <${email.trim()}>\n\n${message.trim()}`;

  let client;
  try {
    client = await getClient();

    const insert = await client.query(
      `INSERT INTO tickets (company_id, creator_id, title, description, priority, status)
       VALUES ($1, $2, $3, $4, 'medium', 'open')`,
      [SUPPORT_COMPANY_ID, SUPPORT_CREATOR_ID, subject.trim(), description]
    );

    await client.query(
      `INSERT INTO ticket_projects (ticket_id, project_id) VALUES ($1, $2)`,
      [insert.insertId, SUPPORT_PROJECT_ID]
    );

    // Email notification to admin
    const html = `
      <h2>New Support Request</h2>
      <p><strong>From:</strong> ${name.trim()} &lt;${email.trim()}&gt;</p>
      <p><strong>Subject:</strong> ${subject.trim()}</p>
      <hr/>
      <p>${message.trim().replace(/\n/g, '<br>')}</p>
      <hr/>
      <p style="color:#888;font-size:12px">Ticket #${insert.insertId} filed in HelpDesk</p>
    `;
    sendMail(ADMIN_EMAIL, FROM_EMAIL, `[Support] ${subject.trim()}`, html).catch(() => {});

    res.json({ message: 'Support request submitted' });
  } catch (err) {
    console.error('Failed to submit support request:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
