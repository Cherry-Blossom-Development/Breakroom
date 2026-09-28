// Who may see / change a ticket. Shared by routes/helpdesk.js and
// routes/projects.js so every ticket endpoint applies the same rules:
//
//   - Active employees of the ticket's company: full access.
//   - The ticket's creator: can view it, comment, edit its title/description/
//     priority and mark it resolved/closed (the Help Desk flow for customers
//     who aren't employees).
//   - Anyone else: can view and comment only if the ticket is in a public
//     project or the company's default (Help Desk) project -- the Help Desk
//     is a public support board.

// Statuses a non-employee creator may set on their own ticket
const CREATOR_STATUSES = ['resolved', 'closed'];

async function isActiveEmployee(client, userId, companyId) {
  const result = await client.query(
    `SELECT 1 FROM employees WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
    [userId, companyId]
  );
  return result.rowCount > 0;
}

// Returns null if the ticket doesn't exist, otherwise
// { ticket: { id, company_id, creator_id }, isEmployee, isCreator, canView }.
async function getTicketAccess(client, ticketId, userId) {
  const ticketResult = await client.query(
    `SELECT t.id, t.company_id, t.creator_id,
            EXISTS (
              SELECT 1 FROM ticket_projects tp
              JOIN projects p ON p.id = tp.project_id
              WHERE tp.ticket_id = t.id AND (p.is_public = TRUE OR p.is_default = TRUE)
            ) AS is_open_to_all
     FROM tickets t WHERE t.id = $1`,
    [ticketId]
  );
  if (ticketResult.rowCount === 0) return null;

  const ticket = ticketResult.rows[0];
  const isEmployee = await isActiveEmployee(client, userId, ticket.company_id);
  const isCreator = ticket.creator_id === userId;
  return {
    ticket,
    isEmployee,
    isCreator,
    canView: isEmployee || isCreator || !!ticket.is_open_to_all
  };
}

module.exports = {
  CREATOR_STATUSES,
  isActiveEmployee,
  getTicketAccess
};
