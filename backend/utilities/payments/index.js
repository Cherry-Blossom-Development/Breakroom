// Registry of available payment processor adapters. See
// docs/multi-processor-payments-architecture.md for the interface every adapter
// implements. Adding a new processor is: write backend/utilities/payments/<name>.js
// matching that shape, add it to PROCESSORS below.

const square = require('./square');

const PROCESSORS = {
  square
};

// Throws (400) on an unknown or not-yet-added processor name -- callers can let this
// propagate straight to an error response, same as any other bad-input rejection.
function getProcessor(name) {
  const processor = PROCESSORS[name];
  if (!processor) {
    const err = new Error(`Unknown payment processor: ${name}`);
    err.statusCode = 400;
    throw err;
  }
  return processor;
}

function listEnabledProcessors() {
  return Object.values(PROCESSORS).map(p => ({ name: p.name, displayName: p.displayName }));
}

module.exports = { getProcessor, listEnabledProcessors };
