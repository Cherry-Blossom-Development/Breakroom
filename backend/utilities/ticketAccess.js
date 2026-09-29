// Who may see / change a ticket. Shared by routes/helpdesk.js and
// routes/projects.js so every ticket endpoint applies the same rules:
//
//   - Active employees of the ticket's company: full access.
//   - The ticket's creator: can view it, comment, edit its title/description/
//     priority and mark it resolved/closed (the Help Desk flow for customers
//     who aren't employees).
//   - Active members of a project the ticket is in (project_members,
//     migration 082 -- may be outside the company): owner/manager/member
//     work it like an employee; viewer can view and comment.
//   - Anyone else: can view and comment only if the ticket is in a public
//     project or the company's default (Help Desk) project -- the Help Desk
//     is a public support board.

const { WORKER_ROLES, getTicketMemberRole } = require('./projectAccess');

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
// { ticket: { id, company_id, creator_id, status }, isEmployee, memberRole,
//   isCreator, canWork, canView }.
// canWork = full edit rights (employee, or a working project member).
async function getTicketAccess(client, ticketId, userId) {
  const ticketResult = await client.query(
    `SELECT t.id, t.company_id, t.creator_id, t.status,
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
  const memberRole = isEmployee ? null : await getTicketMemberRole(client, ticket.id, userId);
  const isCreator = ticket.creator_id === userId;
  return {
    ticket,
    isEmployee,
    memberRole,
    isCreator,
    canWork: isEmployee || WORKER_ROLES.includes(memberRole),
    canView: isEmployee || !!memberRole || isCreator || !!ticket.is_open_to_all
  };
}

// Whether userId can be assigned the ticket: an active employee of its
// company, or a working member of a project the ticket is in.
async function canBeAssigned(client, ticket, userId) {
  if (await isActiveEmployee(client, userId, ticket.company_id)) return true;
  return WORKER_ROLES.includes(await getTicketMemberRole(client, ticket.id, userId));
}

module.exports = {
  CREATOR_STATUSES,
  isActiveEmployee,
  getTicketAccess,
  canBeAssigned
};
