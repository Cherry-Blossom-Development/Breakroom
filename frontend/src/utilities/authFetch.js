import { isGreywire } from './site'

/**
 * Wrapper around fetch that handles authentication errors
 * Redirects to home page on 401/403 responses
 */
export async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include'
  })

  if (res.status === 401 || res.status === 403) {
    // On the Greywire site a signed-in non-member gets 403s everywhere; send
    // them to the claim page (once, so this can't loop) rather than home.
    if (isGreywire && res.status === 403) {
      const body = await res.clone().json().catch(() => ({}))
      if (body.code === 'GREYWIRE_MEMBERSHIP_REQUIRED') {
        if (window.location.pathname !== '/claim') window.location.href = '/claim'
        throw new Error('Greywire membership required')
      }
    }
    // Session expired or not authorized - redirect to home
    window.location.href = '/'
    throw new Error('Session expired')
  }

  return res
}
