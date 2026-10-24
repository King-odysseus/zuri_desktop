// Talks to the Zuri Cloud API. The bearer token lives in sessionStorage so it
// disappears when the tab closes; it is never written to localStorage.
const TOKEN_KEY = 'zuri-cloud-token';

/** @returns {string} */
export function readToken() {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

/** @param {string} token */
export function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/**
 * Call the API and unwrap the { ok, data } envelope.
 * The thrown error keeps the HTTP status so callers can tell "not signed in" (401)
 * apart from "this server has not configured billing" (503).
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function api(path, options = {}) {
  const token = readToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const error = new Error(body?.error?.message ?? 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return body.data;
}

/** @returns {Promise<Array<{ code: string, name: string, currency: string, amountKobo: number, monthlyTokens: number }>>} */
export async function fetchPlans() {
  const data = await api('/api/plans');
  return Array.isArray(data) ? data : [];
}

/**
 * Load everything the dashboard shows in one round trip.
 * Billing is optional: a server without Paystack answers 503 there, and the
 * dashboard should still render plans and usage.
 */
export async function fetchAccount() {
  const [me, usage, limits, billing] = await Promise.all([
    api('/api/me'),
    api('/api/me/usage'),
    api('/api/me/limits'),
    api('/api/me/billing').catch((error) => {
      if (error.status === 503) return { subscription: null, payments: [] };
      throw error;
    }),
  ]);
  return { me, usage, limits, billing };
}

/** @returns {Promise<string>} */
export function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve('ready');
    script.onerror = () => reject(new Error('Google sign-in could not be loaded. Check your connection and reload the page.'));
    document.head.append(script);
  });
}

/**
 * Start a Paystack checkout and hand back the URL to visit.
 * @param {string} planCode
 * @returns {Promise<string>}
 */
export async function createCheckout(planCode) {
  const data = await api('/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planCode }),
  });
  if (!data?.authorizationUrl) throw new Error('Paystack did not return a checkout link.');
  return data.authorizationUrl;
}

/** @param {string} reference */
export async function verifyPayment(reference) {
  return api(`/api/billing/verify?reference=${encodeURIComponent(reference)}`);
}

export async function signOutRequest() {
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined);
}
