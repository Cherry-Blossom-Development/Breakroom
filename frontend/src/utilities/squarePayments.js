/**
 * Square Web Payments SDK loader + card tokenization helper.
 * Shared by SessionsPaywallModal, CollectionsPaymentPage, PublicStorePage, and
 * PublicCollectionPage — anywhere a card needs to be tokenized into a `sourceId`
 * for the backend's billing and storefront checkout endpoints.
 */

let sdkPromise = null

// Square app IDs are prefixed "sandbox-" in sandbox; production ids aren't. Using that
// prefix to pick the SDK script avoids needing a separate VITE_SQUARE_ENVIRONMENT var.
function sdkUrl(applicationId) {
  return applicationId?.startsWith('sandbox-')
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js'
}

function loadSdkScript(applicationId) {
  if (window.Square) return Promise.resolve(window.Square)
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = sdkUrl(applicationId)
      script.onload = () => resolve(window.Square)
      script.onerror = () => reject(new Error('Failed to load Square payments SDK'))
      document.head.appendChild(script)
    })
  }
  return sdkPromise
}

/**
 * Loads the SDK (if needed) and attaches a card input to the given container element id.
 * Returns { card, destroy } — call destroy() when the form is torn down/unmounted.
 */
export async function mountSquareCard(containerId) {
  const applicationId = import.meta.env.VITE_SQUARE_APPLICATION_ID
  const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID
  if (!applicationId || !locationId) {
    throw new Error('Payment is not configured.')
  }

  const Square = await loadSdkScript(applicationId)
  const payments = Square.payments(applicationId, locationId)
  const card = await payments.card()
  await card.attach(`#${containerId}`)

  return {
    card,
    destroy: () => card.destroy(),
  }
}

/**
 * Tokenizes the attached card, returning a sourceId. Throws with a user-facing message
 * on failure (declined card, incomplete entry, etc.) instead of the raw SDK error shape.
 */
export async function tokenizeCard(card) {
  const result = await card.tokenize()
  if (result.status === 'OK') {
    return result.token
  }
  const reason = result.errors?.[0]?.message || 'Card could not be verified.'
  throw new Error(reason)
}
