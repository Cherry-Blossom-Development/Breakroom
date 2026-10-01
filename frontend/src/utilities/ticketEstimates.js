// Ticket time estimates (migration 083): an amount plus the unit it was
// entered in. Stored as entered -- '3 days' stays 3 + 'days' -- and only
// converted where a common scale is needed (the GANTT chart).

export const ESTIMATE_UNITS = ['hours', 'days', 'weeks', 'months']

const UNIT_SINGULAR = { hours: 'hour', days: 'day', weeks: 'week', months: 'month' }
const UNIT_SHORT = { hours: 'h', days: 'd', weeks: 'w', months: 'mo' }

// DECIMAL comes back from MySQL as a string ("4.00")
export function hasEstimate(ticket) {
  return ticket?.estimate_amount !== null && ticket?.estimate_amount !== undefined && ticket?.estimate_amount !== ''
    && !!ticket?.estimate_unit
}

// "3 days", "1 week", "0.5 hours"
export function formatEstimate(ticket) {
  if (!hasEstimate(ticket)) return ''
  const amount = Number(ticket.estimate_amount)
  return `${amount} ${amount === 1 ? UNIT_SINGULAR[ticket.estimate_unit] : ticket.estimate_unit}`
}

// "3d", "4h", "2mo" -- for the Kanban card chip
export function formatEstimateShort(ticket) {
  if (!hasEstimate(ticket)) return ''
  return `${Number(ticket.estimate_amount)}${UNIT_SHORT[ticket.estimate_unit]}`
}

// Divides an estimate amount into n parts in the same unit, to 2 decimals;
// the last part takes the rounding remainder so the parts add up exactly.
// Splitting a ticket into subtasks (migration 086) pre-fills with this.
export function splitEvenly(amount, n) {
  const total = Number(amount)
  if (!(total > 0) || n < 1) return Array(Math.max(n, 0)).fill('')
  const each = Math.round((total / n) * 100) / 100
  const parts = Array(n).fill(each)
  parts[n - 1] = Math.round((total - each * (n - 1)) * 100) / 100
  // A tiny remainder can't go to zero or below; fall back to equal parts.
  // Parts too small to show at 2 decimals are left blank (estimates must be
  // above zero).
  const result = parts[n - 1] > 0 ? parts : Array(n).fill(each)
  return result.map(p => (p > 0 ? p : ''))
}
