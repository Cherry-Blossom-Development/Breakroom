// Shared PayPal REST client. Unlike Square, PayPal's official @paypal/paypal-server-sdk
// only covers 5 of its APIs (Orders, Payments, Vault, Transaction Search,
// Subscriptions) -- notably NOT the Catalog Products or Billing Plans APIs this
// project needs for one-time Pro-plan setup. To avoid mixing an SDK for some calls and
// raw HTTP for others, everything goes through raw REST here, authenticated via an
// OAuth2 client-credentials token (cached until near expiry).

const PAYPAL_API_BASE = process.env.PAYPAL_ENVIRONMENT === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

class PayPalApiError extends Error {
  constructor(statusCode, body) {
    super(`PayPal API error ${statusCode}: ${JSON.stringify(body)}`);
    this.statusCode = statusCode;
    this.body = body;
  }
}

let _tokenCache = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.accessToken;
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  }

  const basicAuth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await res.json();
  if (!res.ok) throw new PayPalApiError(res.status, data);

  _tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return _tokenCache.accessToken;
}

// Generic authenticated REST call. Returns the parsed JSON body, or null for a 204.
// `extraHeaders` exists mainly for endpoints that need e.g. `Prefer: return=representation`.
async function paypalRequest(method, path, body, extraHeaders = {}) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) throw new PayPalApiError(res.status, data);
  return data;
}

module.exports = { PAYPAL_API_BASE, getAccessToken, paypalRequest, PayPalApiError };
