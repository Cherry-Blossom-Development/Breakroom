// Thrown by a processor adapter when a seller's connected account is no longer
// authorized (revoked from their own dashboard, access expired without a valid
// refresh, etc). Callers should clear the stale user_payment_connect row and prompt
// the seller to reconnect, regardless of which processor raised it.
class ProcessorAuthError extends Error {}

module.exports = { ProcessorAuthError };
