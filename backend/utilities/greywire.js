/**
 * Greywire membership. Only members can use the Greywire community site
 * (community.greywirestudio.com). A user is a member while they hold a claimed
 * pedal in greywire_pedals, or while an admin's grant stands
 * (users.greywire_granted_at). See data/migrations/090-greywire-pedals.sql.
 */

/**
 * SQL condition that's true when the user aliased `alias` is a member.
 * Guest accounts never count. Uses no parameters, so it can be dropped into
 * any query without renumbering its $N placeholders.
 */
function memberSql(alias = 'u') {
  return `(${alias}.is_guest = FALSE AND (${alias}.greywire_granted_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM greywire_pedals gwp WHERE gwp.claimed_by = ${alias}.id)))`;
}

async function isMember(client, userId) {
  const result = await client.query(
    `SELECT 1 FROM users u WHERE u.id = $1 AND ${memberSql('u')}`,
    [userId]
  );
  return result.rowCount > 0;
}

/**
 * A user's membership as the API reports it: whether they're a member, the
 * hand grant if any, and the pedals they hold (oldest claim first).
 */
async function getMembership(client, userId) {
  const user = await client.query(
    'SELECT is_guest, greywire_granted_at FROM users WHERE id = $1',
    [userId]
  );
  if (user.rowCount === 0) return { member: false, grantedAt: null, pedals: [] };

  const pedals = await client.query(
    `SELECT id, model, serial, build_date, claimed_at FROM greywire_pedals
     WHERE claimed_by = $1 ORDER BY claimed_at, id`,
    [userId]
  );
  const { is_guest, greywire_granted_at } = user.rows[0];
  return {
    member: !is_guest && (!!greywire_granted_at || pedals.rowCount > 0),
    grantedAt: greywire_granted_at,
    pedals: pedals.rows.map(p => ({
      id: p.id,
      model: p.model,
      serial: p.serial,
      buildDate: p.build_date,
      claimedAt: p.claimed_at,
    })),
  };
}

/**
 * Puts a new member in the Greywire site's default chat rooms. Called when
 * someone claims a pedal or is granted membership; safe to repeat.
 */
async function joinDefaultRooms(client, userId) {
  await client.query(
    `INSERT IGNORE INTO users_rooms (user_id, room_id, accepted)
     SELECT $1, id, true FROM chat_rooms
     WHERE site = 'greywire' AND is_default = true AND is_active = true`,
    [userId]
  );
}

/**
 * A pedal serial in its stored form (16 uppercase hex digits), or null if the
 * input isn't one. Accepts the spaces, colons and dashes people type when
 * copying it, and an optional 0x prefix.
 */
function normalizeSerial(input) {
  if (typeof input !== 'string') return null;
  const hex = input.trim().replace(/^0x/i, '').replace(/[\s:-]/g, '').toUpperCase();
  return /^[0-9A-F]{16}$/.test(hex) ? hex : null;
}

module.exports = { memberSql, isMember, getMembership, joinDefaultRooms, normalizeSerial };
