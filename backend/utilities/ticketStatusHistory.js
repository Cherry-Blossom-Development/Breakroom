// Ticket status history (migration 081). Every place that sets a ticket's
// status calls recordStatusChange so the GANTT / Burndown charts can see when
// work actually started and finished.

async function recordStatusChange(client, ticketId, fromStatus, toStatus, userId) {
  if (fromStatus === toStatus) return;
  await client.query(
    `INSERT INTO ticket_status_history (ticket_id, from_status, to_status, changed_by)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, fromStatus, toStatus, userId]
  );
}

// Per-ticket start/finish derived from history, for every ticket in a
// project: started_at = first move into in_progress; done_at = the latest
// move into resolved/closed (only meaningful while the ticket is still done).
async function getProjectTicketTimeline(client, projectId) {
  const result = await client.query(
    `SELECT h.ticket_id,
            MIN(CASE WHEN h.to_status = 'in_progress' THEN h.changed_at END) AS started_at,
            MAX(CASE WHEN h.to_status IN ('resolved', 'closed') THEN h.changed_at END) AS done_at
     FROM ticket_status_history h
     WHERE h.ticket_id IN (SELECT ticket_id FROM ticket_projects WHERE project_id = $1)
     GROUP BY h.ticket_id`,
    [projectId]
  );
  return result.rows;
}

// Every recorded status change for a project's tickets, oldest first (the
// Burndown chart replays these to know each ticket's status on any day).
async function getProjectStatusHistory(client, projectId) {
  const result = await client.query(
    `SELECT h.ticket_id, h.from_status, h.to_status, h.changed_at
     FROM ticket_status_history h
     WHERE h.ticket_id IN (SELECT ticket_id FROM ticket_projects WHERE project_id = $1)
     ORDER BY h.changed_at, h.id`,
    [projectId]
  );
  return result.rows;
}

module.exports = { recordStatusChange, getProjectTicketTimeline, getProjectStatusHistory };
