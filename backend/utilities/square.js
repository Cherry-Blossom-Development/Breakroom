// Shared Square client — used by billing.js (OAuth, subscriptions) and, from Phase 3
// onward, storefront.js (checkout payments) too, so the environment toggle lives in one
// place instead of being redefined per route file.

let _square = null;
function getSquare() {
  if (!_square) {
    if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN is not set');
    const { SquareClient, SquareEnvironment } = require('square');
    _square = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT === 'production'
        ? SquareEnvironment.Production
        : SquareEnvironment.Sandbox
    });
  }
  return _square;
}

// A fresh (uncached) client scoped to a single connected seller's own access token --
// needed for calls that must reflect what that specific seller can see/do (e.g.
// checking their own merchant status), as opposed to getSquare()'s platform-level token.
function getSquareClientForToken(accessToken) {
  const { SquareClient, SquareEnvironment } = require('square');
  return new SquareClient({
    token: accessToken,
    environment: process.env.SQUARE_ENVIRONMENT === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox
  });
}

module.exports = { getSquare, getSquareClientForToken };
