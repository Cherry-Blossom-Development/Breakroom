// Who may see / work / manage a project (migration 082). Used by
// routes/projects.js, and by utilities/ticketAccess.js for tickets.
//
//   - Active employees of the project's company: view and work every
//     project, as before memberships existed.
//   - Company owners/admins: also manage every project (settings, members).
//   - Active project members (project_members, status 'active'), who may be
//     outside the company: owner/manager manage the project; owner/manager/
//     member work its tickets; viewer is read-only.
//   - Anyone else: view the board only if the project is public. (Help Desk
//     tickets stay individually viewable to anyone -- utilities/ticketAccess.js
//     -- and anyone may file into it -- POST /api/projects/:id/tickets.)

const PROJECT_ROLES = ['owner', 'manager', 'member', 'viewer'];
const MANAGER_ROLES = ['owner', 'manager'];
const WORKER_ROLES = ['owner', 'manager', 'member'];

// Returns null if the project doesn't exist, otherwise
// { project, isEmployee, isCompanyAdmin, memberRole, canView, canWork, canManage, isOwner }.
// isOwner: may manage owners too (project owner, or company owner/admin).
async function getProjectAccess(client, projectId, userId) {
  const projectResult = await client.query(
    `SELECT id, company_id, is_default, is_public, is_active FROM projects WHERE id = $1`,
    [projectId]
  );
  if (projectResult.rowCount === 0) return null;
  const project = projectResult.rows[0];

  const [empResult, memberResult] = await Promise.all([
    client.query(
      `SELECT is_owner, is_admin FROM employees
       WHERE user_id = $1 AND company_id = $2 AND status = 'active'`,
      [userId, project.company_id]
    ),
    client.query(
      `SELECT role FROM project_members
       WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
      [projectId, userId]
    )
  ]);

  const isEmployee = empResult.rowCount > 0;
  const isCompanyAdmin = isEmployee && !!(empResult.rows[0].is_owner || empResult.rows[0].is_admin);
  const memberRole = memberResult.rowCount > 0 ? memberResult.rows[0].role : null;
  const isOwner = isCompanyAdmin || memberRole === 'owner';
  const canManage = isOwner || MANAGER_ROLES.includes(memberRole);

  return {
    project,
    isEmployee,
    isCompanyAdmin,
    memberRole,
    isOwner,
    canManage,
    canWork: isEmployee || WORKER_ROLES.includes(memberRole),
    canView: isEmployee || !!memberRole || !!project.is_public
  };
}

// The best active membership role a user holds in any project a ticket
// belongs to, or null.
async function getTicketMemberRole(client, ticketId, userId) {
  const result = await client.query(
    `SELECT pm.role FROM project_members pm
     JOIN ticket_projects tp ON tp.project_id = pm.project_id
     WHERE tp.ticket_id = $1 AND pm.user_id = $2 AND pm.status = 'active'`,
    [ticketId, userId]
  );
  const roles = result.rows.map(r => r.role);
  return PROJECT_ROLES.find(role => roles.includes(role)) || null;
}

module.exports = {
  PROJECT_ROLES,
  WORKER_ROLES,
  getProjectAccess,
  getTicketMemberRole
};
