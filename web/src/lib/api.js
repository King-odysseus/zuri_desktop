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
    // The server names its refusals (EMAIL_TAKEN, INVALID_CREDENTIALS and so on)
    // and the screens turn those names into sentences a person can act on. A
    // server that sends no code leaves this empty and the message is used.
    error.code = body?.error?.code ?? '';
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

/**
 * Spend, revenue and model settings for the admin dashboard. The server answers
 * 403 for anyone who is not an administrator.
 * @param {number} [days] Look-back window.
 */
export async function fetchAdminOverview(days = 30) {
  return api(`/api/admin/overview?days=${encodeURIComponent(days)}`);
}

/** @param {object} model One catalogue entry, in the shape the overview returns. */
export async function saveAdminModel(model) {
  return api('/api/admin/models', { method: 'PUT', body: JSON.stringify(model) });
}

export async function signOutRequest() {
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined);
}

// Every password route in one place: signing up, signing in, and the three
// things a password can do after that. The server names them as one family, so
// a change of prefix is a change in this one object.
const AUTH_ROUTES = {
  signUp: '/api/auth/sign-up',
  signIn: '/api/auth/sign-in',
  forgotPassword: '/api/auth/forgot-password',
  resetPassword: '/api/auth/reset-password',
  setPassword: '/api/auth/set-password',
};

/**
 * Create an account with an email and a password. The reply carries the session
 * token, exactly as the Google route does.
 * @param {{ email: string, password: string, displayName: string }} input
 */
export async function signUpWithPassword({ email, password, displayName }) {
  return api(AUTH_ROUTES.signUp, {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

/** @param {{ email: string, password: string }} input */
export async function signInWithPassword({ email, password }) {
  return api(AUTH_ROUTES.signIn, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Ask for a reset link. The answer is deliberately the same whether or not the
 * address has an account, so this tells the person to watch their inbox and
 * nothing about who is registered.
 * @param {string} email
 */
export async function requestPasswordReset(email) {
  return api(AUTH_ROUTES.forgotPassword, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** @param {{ token: string, password: string }} input */
export async function resetPassword({ token, password }) {
  return api(AUTH_ROUTES.resetPassword, {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

/**
 * Add an email and password to the signed-in account, for people who arrived
 * through Google and want a second way in.
 * @param {string} password
 */
export async function setPassword(password) {
  return api(AUTH_ROUTES.setPassword, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}
