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
