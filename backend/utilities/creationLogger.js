const { UAParser } = require('ua-parser-js')
const { getClient } = require('./db')

/**
 * Log the creation of a record along with device/browser context.
 *
 * @param {string} referenceTable  - DB table the record lives in (e.g. 'chat_messages')
 * @param {number} referenceId     - Primary key of the new record
 * @param {object} context
 * @param {number|null} context.userId     - ID of the user who created it
 * @param {string|null} context.ipAddress  - Remote IP (req.ip or socket.handshake.address)
 * @param {string|null} context.userAgent  - Raw User-Agent string
 */
async function logCreation(referenceTable, referenceId, { userId = null, ipAddress = null, userAgent = null } = {}) {
  let deviceType = null
  let browserName = null
  let browserVersion = null
  let osName = null

  if (userAgent) {
    const parsed = new UAParser(userAgent).getResult()
    // ua-parser-js leaves device.type undefined for desktop
    deviceType     = parsed.device.type || 'desktop'
    browserName    = parsed.browser.name    || null
    browserVersion = parsed.browser.version || null
    osName         = parsed.os.name         || null
  }

  const client = await getClient()
  try {
    await client.query(
      `INSERT INTO creation_logs
         (reference_table, reference_id, user_id, ip_address, user_agent, device_type, browser_name, browser_version, os_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [referenceTable, referenceId, userId, ipAddress, userAgent, deviceType, browserName, browserVersion, osName]
    )
  } catch (err) {
    // Never let logging failure surface to the caller
    console.error('[creationLogger] Failed to write log:', err.message)
  } finally {
    client.release()
  }
}

module.exports = { logCreation }
