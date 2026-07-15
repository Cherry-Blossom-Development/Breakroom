const VALID_PLATFORMS = new Set(['web', 'android', 'ios']);

/**
 * Reads the client platform from the X-Client-Platform header.
 * Web clients don't need to send it — absence (or an unrecognized value)
 * defaults to 'web'.
 */
function getPlatform(req) {
  const header = req.headers['x-client-platform'];
  return VALID_PLATFORMS.has(header) ? header : 'web';
}

module.exports = { getPlatform };
