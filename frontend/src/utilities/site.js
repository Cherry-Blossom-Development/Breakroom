// Which site this build is serving. One build serves Prosaurus and the
// Greywire Studio community (community.greywirestudio.com); the backend makes
// the same call from the Host header (backend/utilities/site.js).
export const GREYWIRE_HOSTS = ['community.greywirestudio.com', 'local.greywirestudio.com']

export const isGreywire = typeof window !== 'undefined' && GREYWIRE_HOSTS.includes(window.location.hostname)

export const siteName = isGreywire ? 'Greywire' : 'Prosaurus'

export const siteLogo = isGreywire ? '/greywire/logo.svg' : '/logo-192x192-no-text.png'
