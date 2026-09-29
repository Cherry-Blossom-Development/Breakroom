// Ticket time estimates (migration 083): an amount plus the unit it was
// entered in ('3 days' is stored as 3 + 'days', never converted to hours).
const ESTIMATE_UNITS = ['hours', 'days', 'weeks', 'months'];
const MAX_ESTIMATE_AMOUNT = 9999.99;

// Parses request values into { value: { amount, unit } } (amount rounded to
// 2 decimals; both null to clear) or { error }. An empty/null amount clears
// the estimate.
function parseEstimate(rawAmount, rawUnit) {
  if (rawAmount === null || rawAmount === undefined || rawAmount === '') {
    return { value: { amount: null, unit: null } };
  }
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_ESTIMATE_AMOUNT) {
    return { error: `Estimate must be a number greater than 0 and at most ${MAX_ESTIMATE_AMOUNT}` };
  }
  if (!ESTIMATE_UNITS.includes(rawUnit)) {
    return { error: `Estimate unit must be one of: ${ESTIMATE_UNITS.join(', ')}` };
  }
  return { value: { amount: Math.round(amount * 100) / 100, unit: rawUnit } };
}

module.exports = { ESTIMATE_UNITS, parseEstimate };
