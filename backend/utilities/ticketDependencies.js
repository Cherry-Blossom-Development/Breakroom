// Ticket dependencies (migration 079): ticket_id depends on (can't finish
// before) depends_on_ticket_id. Shared by routes/helpdesk.js (add/remove)
// and routes/projects.js (project board payload).

// Edge rows carry both ends' title/status so the UI can render "Depends on"
// and "Blocking" lists -- including tickets outside the current project --
// without extra lookups.
const EDGE_SELECT = `
  SELECT d.ticket_id, d.depends_on_ticket_id,
         t.title AS ticket_title, t.status AS ticket_status,
         dep.title AS depends_on_title, dep.status AS depends_on_status
  FROM ticket_dependencies d
  JOIN tickets t ON t.id = d.ticket_id
  JOIN tickets dep ON dep.id = d.depends_on_ticket_id`;

// Every edge touching any ticket in the project (either end).
async function getProjectDependencyEdges(client, projectId) {
  const result = await client.query(
    `${EDGE_SELECT}
     WHERE d.ticket_id IN (SELECT ticket_id FROM ticket_projects WHERE project_id = $1)
        OR d.depends_on_ticket_id IN (SELECT ticket_id FROM ticket_projects WHERE project_id = $1)
     ORDER BY d.ticket_id, d.depends_on_ticket_id`,
    [projectId]
  );
  return result.rows;
}

// Every edge touching one ticket (either end).
async function getTicketDependencyEdges(client, ticketId) {
  const result = await client.query(
    `${EDGE_SELECT}
     WHERE d.ticket_id = $1 OR d.depends_on_ticket_id = $1
     ORDER BY d.ticket_id, d.depends_on_ticket_id`,
    [ticketId]
  );
  return result.rows;
}

// Would adding "ticketId depends on dependsOnId" close a loop? Only if
// dependsOnId already (transitively) depends on ticketId, so walk
// dependsOnId's dependency chain breadth-first looking for ticketId.
async function wouldCreateCycle(client, ticketId, dependsOnId) {
  const visited = new Set([dependsOnId]);
  let frontier = [dependsOnId];

  while (frontier.length > 0) {
    const placeholders = frontier.map((_, i) => `$${i + 1}`).join(', ');
    const result = await client.query(
      `SELECT depends_on_ticket_id FROM ticket_dependencies WHERE ticket_id IN (${placeholders})`,
      frontier
    );
    const next = [];
    for (const { depends_on_ticket_id: id } of result.rows) {
      if (id === ticketId) return true;
      if (!visited.has(id)) {
        visited.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  return false;
}

module.exports = {
  getProjectDependencyEdges,
  getTicketDependencyEdges,
  wouldCreateCycle
};
