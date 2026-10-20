/**
 * Email templates from system_emails. Each key can have a version per site
 * (see data/migrations/091-site-emails.sql); a site without its own version
 * gets the Prosaurus one.
 */

const { DEFAULT_SITE } = require('./site');

/**
 * The active template { from_address, subject, html_content } for a key on a
 * site, or null if there's none at all.
 */
async function getSystemEmail(client, emailKey, site = DEFAULT_SITE) {
  const result = await client.query(
    `SELECT from_address, subject, html_content FROM system_emails
     WHERE email_key = $1 AND is_active = true AND site IN ($2, $3)
     ORDER BY site = $2 DESC
     LIMIT 1`,
    [emailKey, site, DEFAULT_SITE]
  );
  return result.rows[0] || null;
}

module.exports = { getSystemEmail };
