// Ticket time estimates (migration 080), in hours.
const MAX_ESTIMATE_HOURS = 9999.99;

// Parses a request value into { value } (a number rounded to 2 decimals, or
// null to clear) or { error }. '' / null clear the estimate.
function parseEstimateHours(raw) {
  if (raw === null || raw === '') return { value: null };
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_ESTIMATE_HOURS) {
    return { error: `Estimate must be a number of hours greater than 0 and at most ${MAX_ESTIMATE_HOURS}` };
  }
  return { value: Math.round(hours * 100) / 100 };
}

module.exports = { parseEstimateHours };
