// Which site this build is serving. One build serves Prosaurus and the
// Greywire Studio community (community.greywirestudio.com); the backend makes
// the same call from the Host header (backend/utilities/site.js).
export const GREYWIRE_HOSTS = ['community.greywirestudio.com', 'local.greywirestudio.com']

export const isGreywire = typeof window !== 'undefined' && GREYWIRE_HOSTS.includes(window.location.hostname)

export const siteName = isGreywire ? 'Greywire' : 'Prosaurus'

export const siteLogo = isGreywire ? '/greywire/logo.svg' : '/logo-192x192-no-text.png'

// Prefix for API and Socket.IO calls. Builds point VITE_API_BASE_URL at a
// Prosaurus host, but Greywire must call its own host: the backend picks the
// site from the Host header, and the login cookie belongs to that host.
export const apiBase = isGreywire ? '' : (import.meta.env.VITE_API_BASE_URL || '')
