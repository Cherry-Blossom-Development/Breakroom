// Builds a sprint burndown for one project. Pure (no Vue, no fetch);
// ProjectBurndownPage.vue renders the result.
//
// Rules:
//   - Sprints are back-to-back blocks of the project's sprint length
//     (Settings, migration 082), counted from the Monday of the week the
//     project was created.
//   - Remaining work at an instant = every ticket in the project that exists
//     by then and isn't resolved/closed then. Tickets added or reopened
//     mid-sprint push the line up; that's scope change, shown as "added".
//   - A ticket's status at any instant is replayed from status history
//     (migration 081). Before a ticket's first recorded change, its status is
//     that change's from_status; with no history at all, a done ticket counts
//     as done from its resolved_at.
//   - Work is measured with the GANTT chart's conversion (estimateWorkingHours:
//     8h working days) and shown in working days; an unestimated ticket counts
//     as 1 day and is flagged. Estimates have no history, so every day uses
//     the ticket's current estimate.
//   - The ideal line runs from the sprint's starting remaining work to zero
//     at the sprint's end, dropping only on working days (Mon-Fri).

import { estimateWorkingHours, workingHoursBetween, startOfDay, HOURS_PER_DAY } from './ganttSchedule'

const DAY_MS = 24 * 60 * 60 * 1000
const DONE_STATUSES = ['resolved', 'closed']
const isDone = (status) => DONE_STATUSES.includes(status)

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// Monday on or before `date`, at midnight
export function sprintAnchor(date) {
  const d = startOfDay(date)
  return addDays(d, -((d.getDay() + 6) % 7))
}

// Sprint `index` (0 = first) as { index, start, end }; end is exclusive
export function sprintBounds(anchor, sprintDays, index) {
  return {
    index,
    start: addDays(anchor, index * sprintDays),
    end: addDays(anchor, (index + 1) * sprintDays)
  }
}

// Index of the sprint containing `date` (never below 0)
export function sprintIndexAt(anchor, sprintDays, date) {
  const days = Math.round((startOfDay(date) - anchor) / DAY_MS)
  return Math.max(Math.floor(days / sprintDays), 0)
}

// Status a ticket had at instant `t`. `changes` is the ticket's history,
// oldest first.
export function statusAt(ticket, changes, t) {
  let last = null
  for (const c of changes) {
    if (new Date(c.changed_at) <= t) last = c
    else {
      // First change after t: the ticket was in its from_status until then
      return last ? last.to_status : (c.from_status ?? c.to_status)
    }
  }
  if (last) return last.to_status
  // No recorded history (pre-migration 081): trust the current status, but
  // a done ticket was only done from when it was resolved
  if (isDone(ticket.status)) {
    const doneAt = new Date(ticket.resolved_at || ticket.updated_at || ticket.created_at)
    return doneAt <= t ? ticket.status : 'backlog'
  }
  return ticket.status
}

/**
 * @param {object} input
 * @param {Array}  input.tickets   GET /api/projects/:id/burndown tickets
 * @param {Array}  input.history   status changes, oldest first
 * @param {Date}   input.start     sprint start (midnight)
 * @param {Date}   input.end       sprint end (exclusive midnight)
 * @param {Date}   input.now
 * @param {'work'|'tickets'} input.measure
 */
export function buildBurndown({ tickets, history, start, end, now = new Date(), measure = 'work' }) {
  const changesByTicket = new Map()
  for (const c of history) {
    if (!changesByTicket.has(c.ticket_id)) changesByTicket.set(c.ticket_id, [])
    changesByTicket.get(c.ticket_id).push(c)
  }

  const sized = tickets.map(t => {
    const hours = estimateWorkingHours(t)
    return {
      ticket: t,
      createdAt: new Date(t.created_at),
      changes: changesByTicket.get(t.id) || [],
      unestimated: hours === null,
      // Size in the chart's unit: working days, or 1 per ticket
      size: measure === 'tickets' ? 1 : (hours ?? HOURS_PER_DAY) / HOURS_PER_DAY
    }
  })

  const exists = (s, t) => s.createdAt <= t
  const openAt = (s, t) => exists(s, t) && !isDone(statusAt(s.ticket, s.changes, t))
  const remainingAt = (t) => sized.reduce((sum, s) => sum + (openAt(s, t) ? s.size : 0), 0)

  const startRemaining = remainingAt(start)
  const totalWorking = workingHoursBetween(start, end)
  const idealAt = (t) => totalWorking > 0
    ? startRemaining * Math.max(0, 1 - workingHoursBetween(start, t) / totalWorking)
    : 0

  const days = []
  for (let dayStart = new Date(start); dayStart < end; dayStart = addDays(dayStart, 1)) {
    const dayEnd = addDays(dayStart, 1)
    const started = dayStart <= now
    const at = dayEnd < now ? dayEnd : now // today: as of now
    let completed = 0
    let added = 0
    if (started) {
      for (const s of sized) {
        const wasOpen = openAt(s, dayStart)
        const isOpen = openAt(s, at)
        const createdToday = !exists(s, dayStart) && exists(s, at)
        if (createdToday) {
          added += s.size
          if (!isOpen) completed += s.size // created and finished the same day
        } else if (wasOpen && !isOpen) {
          completed += s.size
        } else if (!wasOpen && isOpen) {
          added += s.size // reopened
        }
      }
    }
    const dow = dayStart.getDay()
    days.push({
      date: dayStart,
      end: dayEnd,
      at: started ? at : null,
      isToday: dayStart <= now && now < dayEnd,
      weekend: dow === 0 || dow === 6,
      remaining: started ? remainingAt(at) : null,
      ideal: idealAt(dayEnd),
      completed,
      added
    })
  }

  const actual = days.filter(d => d.remaining !== null)
  const latest = actual.length ? actual[actual.length - 1] : null
  const current = latest ? latest.remaining : startRemaining
  // This sprint's work: tickets that exist by now and weren't already done
  // when it started
  const until = latest ? latest.at : start
  const inScope = sized.filter(s => exists(s, until) && (!exists(s, start) || openAt(s, start)))
  const earliestHistory = history.length ? new Date(history[0].changed_at) : null

  return {
    days,
    startRemaining,
    remaining: current,
    idealNow: latest ? idealAt(latest.at) : startRemaining,
    completed: days.reduce((sum, d) => sum + d.completed, 0),
    added: days.reduce((sum, d) => sum + d.added, 0),
    unestimatedCount: measure === 'work' ? inScope.filter(s => s.unestimated).length : 0,
    // Days before any recorded history are reconstructed from resolved dates
    approximate: !earliestHistory || start < earliestHistory,
    started: start <= now,
    finished: end <= now
  }
}
