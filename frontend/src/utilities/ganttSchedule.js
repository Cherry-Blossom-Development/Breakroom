// Builds a GANTT schedule for one project's tickets. Pure (no Vue, no
// fetch) so it can be unit-tested; ProjectGanttPage.vue renders the result.
//
// Rules (agreed 2026-09-28):
//   - Scheduling runs in working hours: 8h per working day, Mon-Fri, weekends
//     skipped. Estimates are stored as entered (amount + unit, migration 083)
//     and converted here only: a day is one working day, a week five, a
//     month 52/12 weeks (~21.7 working days). An unestimated ticket is
//     treated as 1 working day and flagged.
//   - Unfinished work is scheduled forward from today. A ticket can't start
//     until the tickets it depends on (migration 079) finish.
//   - One person works one ticket at a time: tickets with the same assignee
//     run back to back. Unassigned tickets run in parallel.
//   - In-progress tickets start when they actually moved to in_progress
//     (status history, migration 081) and finish once their estimate's worth
//     of working time has passed -- or today, flagged overdue, if it already
//     has.
//   - Done (resolved/closed) tickets, when shown, use their real start/finish
//     from status history, falling back to resolved_at and the estimate.

export const HOURS_PER_DAY = 8
export const DEFAULT_UNESTIMATED_HOURS = HOURS_PER_DAY
const WORKING_DAYS_PER_WEEK = 5
const WEEKS_PER_MONTH = 52 / 12

// Scheduler working hours for one estimate unit
const UNIT_HOURS = {
  hours: 1,
  days: HOURS_PER_DAY,
  weeks: WORKING_DAYS_PER_WEEK * HOURS_PER_DAY,
  months: WEEKS_PER_MONTH * WORKING_DAYS_PER_WEEK * HOURS_PER_DAY
}

// A ticket's estimate (estimate_amount + estimate_unit) in working hours, or
// null if it has none
export function estimateWorkingHours(ticket) {
  const perUnit = UNIT_HOURS[ticket.estimate_unit]
  const amount = ticket.estimate_amount === null || ticket.estimate_amount === undefined ? NaN : Number(ticket.estimate_amount)
  return perUnit && amount > 0 ? amount * perUnit : null
}
const DAY_MS = 24 * 60 * 60 * 1000

const DONE_STATUSES = ['resolved', 'closed']
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
// Among tickets ready at the same time, on-deck work goes before backlog
const STAGE_RANK = { 'on-deck': 0, backlog: 1, open: 1 }

export function isWeekend(date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

// First working-day midnight at or after `date`'s day
export function nextWorkingDay(date) {
  let d = startOfDay(date)
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}

// Working hours after `anchor` (a working-day midnight) -> calendar Date.
// A working day's 8 hours are spread across its calendar day for drawing.
// With asEnd, a value landing exactly on a day boundary stays at the end of
// the last working day instead of jumping to the next one (so a Friday
// finish doesn't stretch across the weekend).
export function workingOffsetToDate(anchor, hours, { asEnd = false } = {}) {
  let days = Math.floor(hours / HOURS_PER_DAY)
  let fraction = (hours - days * HOURS_PER_DAY) / HOURS_PER_DAY
  if (asEnd && fraction === 0 && days > 0) {
    days -= 1
    fraction = 1
  }
  let d = new Date(anchor)
  for (let i = 0; i < days; i++) {
    d = addDays(d, 1)
    while (isWeekend(d)) d = addDays(d, 1)
  }
  return new Date(d.getTime() + fraction * DAY_MS)
}

// Working hours between two instants (weekdays only, 8h per full weekday)
export function workingHoursBetween(from, to) {
  if (to <= from) return 0
  let total = 0
  let day = startOfDay(from)
  while (day < to) {
    const next = addDays(day, 1)
    if (!isWeekend(day)) {
      const overlap = Math.min(next, to) - Math.max(day, from)
      if (overlap > 0) total += (overlap / DAY_MS) * HOURS_PER_DAY
    }
    day = next
  }
  return total
}

// `hours` of working time ending at `end` -> the Date it started
function subtractWorkingHours(end, hours) {
  let remaining = hours
  let cursor = new Date(end)
  while (remaining > 1e-9) {
    // Midnight of the calendar day just before `cursor` (so a midnight
    // cursor steps back into the previous day)
    const dayStart = startOfDay(new Date(cursor.getTime() - 1))
    if (!isWeekend(dayStart)) {
      const available = ((cursor - dayStart) / DAY_MS) * HOURS_PER_DAY
      if (available >= remaining) {
        return new Date(cursor.getTime() - (remaining / HOURS_PER_DAY) * DAY_MS)
      }
      remaining -= available
    }
    cursor = dayStart
  }
  return cursor
}

function toDate(value) {
  return value ? new Date(value) : null
}

export function stageOf(status) {
  if (DONE_STATUSES.includes(status)) return 'done'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'on-deck') return 'on-deck'
  return 'backlog' // backlog and the Help Desk's legacy 'open'
}

/**
 * @param {object} input
 * @param {Array} input.tickets       project tickets (GET /api/projects/:id)
 * @param {Array} input.dependencies  dependency edges (same response)
 * @param {Array} input.timeline      [{ ticket_id, started_at, done_at }]
 * @param {Date}  input.now
 * @param {boolean} input.includeDone
 * @returns {{ rows: Array, summary: object, anchor: Date }}
 */
export function buildGanttSchedule({ tickets, dependencies = [], timeline = [], now = new Date(), includeDone = false }) {
  const anchor = nextWorkingDay(now) // "today" -- scheduling works in whole days
  const history = new Map(timeline.map(t => [t.ticket_id, t]))
  const byId = new Map(tickets.map(t => [t.id, t]))

  const durationOf = (t) => {
    const hours = estimateWorkingHours(t)
    return hours
      ? { hours, unestimated: false }
      : { hours: DEFAULT_UNESTIMATED_HOURS, unestimated: true }
  }

  // ticket id -> ids it depends on
  const predecessors = new Map()
  for (const d of dependencies) {
    if (!predecessors.has(d.ticket_id)) predecessors.set(d.ticket_id, [])
    predecessors.get(d.ticket_id).push(d)
  }

  const rows = []
  const finishOffset = new Map() // active ticket id -> working-hour offset it finishes at
  const assigneeFree = new Map() // assignee id -> offset they're next free

  // 1. In-progress tickets: already underway, occupy their assignee first
  for (const t of tickets.filter(t => stageOf(t.status) === 'in_progress')) {
    const { hours, unestimated } = durationOf(t)
    const startedAt = toDate(history.get(t.id)?.started_at)
    const elapsed = startedAt ? workingHoursBetween(startedAt, anchor) : 0
    const remaining = Math.max(hours - elapsed, 0)
    const overdue = !!startedAt && hours - elapsed <= 0
    finishOffset.set(t.id, remaining)
    if (t.assigned_to) assigneeFree.set(t.assigned_to, Math.max(assigneeFree.get(t.assigned_to) || 0, remaining))
    rows.push({
      ticket: t,
      stage: 'in_progress',
      start: startedAt && startedAt < anchor ? startedAt : anchor,
      end: overdue ? anchor : workingOffsetToDate(anchor, remaining, { asEnd: true }),
      hours,
      remainingHours: remaining,
      unestimated,
      overdue,
      startKnown: !!startedAt
    })
  }

  // 2. Not-started tickets: list scheduling in dependency order
  const pending = new Set(tickets.filter(t => ['backlog', 'on-deck'].includes(stageOf(t.status))).map(t => t.id))
  const blockersOutside = new Map()

  const readyAt = (id) => {
    let earliest = 0
    for (const d of predecessors.get(id) || []) {
      const pred = byId.get(d.depends_on_ticket_id)
      const predDone = DONE_STATUSES.includes(pred ? pred.status : d.depends_on_status)
      if (predDone) continue
      if (!pred) {
        // Unfinished ticket in another project -- can't schedule it here
        if (!blockersOutside.has(id)) blockersOutside.set(id, new Set())
        blockersOutside.get(id).add(d.depends_on_ticket_id)
        continue
      }
      if (!finishOffset.has(pred.id)) return null // predecessor not scheduled yet
      earliest = Math.max(earliest, finishOffset.get(pred.id))
    }
    return earliest
  }

  while (pending.size > 0) {
    let candidates = [...pending].map(id => ({ id, ready: readyAt(id) })).filter(c => c.ready !== null)
    // Loops are blocked on save; if one slipped in anyway, don't hang
    if (candidates.length === 0) candidates = [...pending].map(id => ({ id, ready: 0 }))

    candidates.sort((a, b) => {
      const ta = byId.get(a.id)
      const tb = byId.get(b.id)
      return a.ready - b.ready
        || (STAGE_RANK[ta.status] ?? 1) - (STAGE_RANK[tb.status] ?? 1)
        || (PRIORITY_RANK[ta.priority] ?? 2) - (PRIORITY_RANK[tb.priority] ?? 2)
        || a.id - b.id
    })

    const { id, ready } = candidates[0]
    const t = byId.get(id)
    const { hours, unestimated } = durationOf(t)
    const start = Math.max(ready, t.assigned_to ? assigneeFree.get(t.assigned_to) || 0 : 0)
    const end = start + hours
    finishOffset.set(id, end)
    if (t.assigned_to) assigneeFree.set(t.assigned_to, end)
    pending.delete(id)

    rows.push({
      ticket: t,
      stage: stageOf(t.status),
      start: workingOffsetToDate(anchor, start),
      end: workingOffsetToDate(anchor, end, { asEnd: true }),
      hours,
      remainingHours: hours,
      unestimated,
      overdue: false,
      startKnown: true
    })
  }

  for (const row of rows) {
    row.externalBlockers = [...(blockersOutside.get(row.ticket.id) || [])]
    row.dependsOn = (predecessors.get(row.ticket.id) || []).map(d => d.depends_on_ticket_id)
  }

  // 3. Done tickets (optional): real history where we have it
  if (includeDone) {
    for (const t of tickets.filter(t => stageOf(t.status) === 'done')) {
      const { hours, unestimated } = durationOf(t)
      const h = history.get(t.id)
      const end = toDate(h?.done_at) || toDate(t.resolved_at) || toDate(t.updated_at) || anchor
      const startedAt = toDate(h?.started_at)
      const start = startedAt && startedAt < end ? startedAt : subtractWorkingHours(end, hours)
      rows.push({
        ticket: t,
        stage: 'done',
        start,
        end,
        hours,
        remainingHours: 0,
        unestimated,
        overdue: false,
        startKnown: !!(startedAt && startedAt < end),
        externalBlockers: [],
        dependsOn: (predecessors.get(t.id) || []).map(d => d.depends_on_ticket_id)
      })
    }
  }

  rows.sort((a, b) => a.start - b.start || a.end - b.end || a.ticket.id - b.ticket.id)

  const active = rows.filter(r => r.stage !== 'done')
  const summary = {
    activeCount: active.length,
    remainingHours: active.reduce((sum, r) => sum + r.remainingHours, 0),
    unestimatedCount: active.filter(r => r.unestimated).length,
    overdueCount: active.filter(r => r.overdue).length,
    projectedFinish: active.length ? new Date(Math.max(...active.map(r => r.end.getTime()))) : null
  }

  return { rows, summary, anchor }
}

// ---- Split tickets (migration 086) ----
// A ticket split into subtasks is left off the schedule (its subtasks carry
// the work), so dependency edges that touch it are re-pointed at its
// subtasks: a split ticket's predecessors become each subtask's
// predecessors, and anything that depended on it waits for all of them.
// Splits nest, so a subtask that was split again expands to its own
// subtasks, down to the tickets that are actually scheduled.
export function expandSplitDependencies(dependencies, tickets, splitParents) {
  const parentIds = new Set(splitParents.map(p => p.id))
  if (parentIds.size === 0) return dependencies
  const children = new Map()
  for (const t of [...tickets, ...splitParents]) {
    if (!parentIds.has(t.parent_ticket_id)) continue
    if (!children.has(t.parent_ticket_id)) children.set(t.parent_ticket_id, [])
    children.get(t.parent_ticket_id).push(t)
  }
  const expand = (id, seen = new Set()) => {
    if (!parentIds.has(id)) return [id]
    if (seen.has(id)) return []
    seen.add(id)
    return (children.get(id) || []).flatMap(t => expand(t.id, seen))
  }
  const statusOf = new Map(tickets.map(t => [t.id, t.status]))

  const out = new Map()
  for (const d of dependencies) {
    for (const from of expand(d.ticket_id)) {
      for (const to of expand(d.depends_on_ticket_id)) {
        if (from === to) continue
        out.set(`${from}>${to}`, {
          ...d,
          ticket_id: from,
          depends_on_ticket_id: to,
          depends_on_status: statusOf.get(to) ?? d.depends_on_status
        })
      }
    }
  }
  return [...out.values()]
}

// Inserts a summary row for each 'category' split ticket right above its
// subtasks (which move up to sit together under it). The category spans
// its visible subtasks; it has no work of its own. Splits nest: a category
// inside a category gets its own summary row under the outer one, and a
// hidden split in between is skipped over (its subtasks sit under the
// nearest category above it). Rows get a depth for indenting (inCategory
// when depth > 0). subtaskCount/doneCount count the scheduled tickets
// anywhere under the category.
export function withCategoryRows(rows, splitParents, tickets) {
  const splitById = new Map(splitParents.map(p => [p.id, p]))
  if (!splitParents.some(p => p.split_mode === 'category')) return rows

  // Category ancestors of a ticket, outermost first
  const chainCache = new Map()
  const categoryChain = (ticket) => {
    if (chainCache.has(ticket.id)) return chainCache.get(ticket.id)
    const chain = []
    const seen = new Set()
    for (let p = splitById.get(ticket.parent_ticket_id); p && !seen.has(p.id); p = splitById.get(p.parent_ticket_id)) {
      seen.add(p.id)
      if (p.split_mode === 'category') chain.unshift(p.id)
    }
    chainCache.set(ticket.id, chain)
    return chain
  }
  const leavesUnder = (categoryId) => tickets.filter(t => categoryChain(t).includes(categoryId))

  const place = (list, depth) => {
    const out = []
    const emitted = new Set()
    for (const r of list) {
      const categoryId = categoryChain(r.ticket)[depth]
      if (categoryId === undefined) {
        out.push({ ...r, depth, inCategory: depth > 0 })
        continue
      }
      if (emitted.has(categoryId)) continue
      emitted.add(categoryId)
      const members = list.filter(m => categoryChain(m.ticket)[depth] === categoryId)
      const leaves = leavesUnder(categoryId)
      out.push({
        ticket: splitById.get(categoryId),
        stage: 'category',
        isCategory: true,
        depth,
        inCategory: depth > 0,
        start: new Date(Math.min(...members.map(k => k.start))),
        end: new Date(Math.max(...members.map(k => k.end))),
        hours: 0,
        remainingHours: 0,
        unestimated: false,
        overdue: false,
        startKnown: true,
        dependsOn: [],
        externalBlockers: [],
        subtaskCount: leaves.length,
        doneCount: leaves.filter(t => DONE_STATUSES.includes(t.status)).length
      })
      out.push(...place(members, depth + 1))
    }
    return out
  }
  return place(rows, 0)
}
