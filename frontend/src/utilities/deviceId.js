const STORAGE_KEY = 'breakroom_device_token'

export function getDeviceToken() {
  let token = localStorage.getItem(STORAGE_KEY)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, token)
  }
  return token
}

function parseUA() {
  const ua = navigator.userAgent

  let device
  if (/iPhone/.test(ua)) device = 'iPhone'
  else if (/iPad/.test(ua)) device = 'iPad'
  else if (/Android/.test(ua)) {
    const m = ua.match(/Android [^;]+; ([^)]+)/)
    device = m ? m[1].split(' Build')[0].trim() : 'Android'
  }
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'macOS'
  else if (/Windows/.test(ua)) device = 'Windows'
  else if (/Linux/.test(ua)) device = 'Linux'
  else device = 'Unknown Device'

  let browser, version
  const rules = [
    [/Edg\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).*Safari/, 'Safari'],
    [/Safari/, 'Safari'],
  ]
  for (const [re, name] of rules) {
    const m = ua.match(re)
    if (m) { browser = name; version = m[1] || ''; break }
  }
  browser = browser || 'Browser'

  const systemName = version ? `${device} · ${browser} ${version}` : `${device} · ${browser}`
  return { device, browser, version, systemName }
}

export function buildDevicePayload() {
  const token = getDeviceToken()
  const { device, browser, version, systemName } = parseUA()
  return {
    deviceToken: token,
    systemName,
    platform: 'web',
    isEmulator: false,
    deviceInfo: {
      ua: navigator.userAgent,
      device,
      browser,
      browserVersion: version,
      screen: `${screen.width}x${screen.height}@${window.devicePixelRatio}x`,
    }
  }
}
