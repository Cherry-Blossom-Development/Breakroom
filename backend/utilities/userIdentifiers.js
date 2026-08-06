// Does `handle`/`email`/`alternateEmail` (any non-null ones) already belong to a
// DIFFERENT user, in ANY of their handle/email/alternate_email columns? Used to keep
// every login identifier (handle, primary email, alternate email) unique across
// accounts -- see data/migrations/048-alternate-email.sql and the login route in
// backend/routes/authentication.js, which matches on all three.
//
// All three columns share the users table's utf8mb4_unicode_ci collation, which is
// case-insensitive for equality and for UNIQUE enforcement -- a plain `=`/`IN` here
// already matches case-insensitively, no LOWER() needed.
async function findIdentifierCollision(client, { handle, email, alternateEmail } = {}, excludeUserId = null) {
  const values = [handle, email, alternateEmail].filter(Boolean);
  if (values.length === 0) return null;

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const params = [...values];
  let sql = `SELECT id FROM users WHERE (handle IN (${placeholders}) OR email IN (${placeholders}) OR alternate_email IN (${placeholders}))`;
  if (excludeUserId) {
    sql += ` AND id != $${params.length + 1}`;
    params.push(excludeUserId);
  }

  const result = await client.query(sql, params);
  return result.rowCount > 0 ? result.rows[0] : null;
}

module.exports = { findIdentifierCollision };
