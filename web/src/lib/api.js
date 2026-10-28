// Talks to the Zuri Cloud API. The bearer token lives in sessionStorage so it
// disappears when the tab closes; it is never written to localStorage.
const TOKEN_KEY = 'zuri-cloud-token';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
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
 * The image catalogue: one entry per image model, with its price and the number
 * of images a month on each plan. Prices are read from the server rather than
 * written into the page, so a rate change needs no redeploy of the site.
 *
 * Unlike plans, this never throws: the image cards are an extra on a marketing
 * page, so a server that has not shipped the endpoint yet (a 404) leaves the
 * page exactly as it was instead of replacing it with an error.
 * @returns {Promise<Array<{ code: string, name: string, kind: string, minPlan: string, quotaTokensPerImage: number, plans: Array<{ code: string, priceKobo: number, images: number }> }>>}
 */
export async function fetchImagePrices() {
  try {
    const data = await api('/api/image-prices');
    return Array.isArray(data) ? data : [];
  } catch {
    // Deliberately silent: the caller renders no image section when this is
    // empty, and an error about pictures would bury the plans it sells.
    return [];
  }
}

/**
 * The extra-usage packs sold on top of a plan, priced in kobo on the server so a
 * rate change needs no redeploy of the site.
 *
 * Like the image catalogue this never throws: a server that has not shipped the
 * endpoint yet (a 404) leaves the top-up section off the page instead of
 * replacing the usage numbers with an error about a shop that is closed.
 * @returns {Promise<Array<{ code: string, name: string, tokens: number, amountKobo: number, validDays: number }>>}
 */
export async function fetchTopups() {
  try {
    const data = await api('/api/topups');
    return Array.isArray(data) ? data : [];
  } catch {
    // Deliberately silent: an empty list renders no top-up section at all.
    return [];
  }
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

/**
 * Start a Paystack checkout for one extra-usage pack and hand back the URL to
 * visit. The route answers 503 while the server has no Paystack key, and the
 * thrown error keeps that status so the notice can say what is missing.
 * @param {string} packCode
 * @returns {Promise<string>}
 */
export async function createTopupCheckout(packCode) {
  const data = await api('/api/billing/topup', {
    method: 'POST',
    body: JSON.stringify({ packCode }),
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

export async function fetchAdminStats(days = 30) {
  return api(`/api/admin/stats?days=${encodeURIComponent(days)}`);
}

export async function fetchAdminUsers(search = '') {
  return api(`/api/admin/users?search=${encodeURIComponent(search)}`);
}

/** @param {{ email: string, displayName?: string, planCode: string, days: number }} person */
export async function createAdminUser(person) {
  return api('/api/admin/users', { method: 'POST', body: JSON.stringify(person) });
}

/** @param {string} userId @param {{ action: string, planCode?: string, days?: number }} change */
export async function changeAdminUser(userId, change) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(change) });
}

export async function signOutRequest() {
  // Signing out is best effort: the token is cleared by the caller either way.
  await api('/api/auth/sign-out', { method: 'POST' }).catch(() => undefined);
}

// Saved conversations and the live chat stream ---------------------------------

/** The model a new chat starts on. The composer's dropdown changes it per message. */
export const DEFAULT_CHAT_MODEL = 'zuri-flash';

/**
 * This account's saved conversations, newest first as the server sends them.
 * A query asks the server to match titles and message text without downloading
 * every thread into the browser.
 * @param {string} [query]
 * @returns {Promise<Array<{ id: string, title: string, createdAt?: string, updatedAt?: string }>>}
 */
export async function fetchConversations(query = '') {
  const trimmed = typeof query === 'string' ? query.trim().slice(0, 120) : '';
  const suffix = trimmed === '' ? '' : `?q=${encodeURIComponent(trimmed)}`;
  const data = await api(`/api/me/conversations${suffix}`);
  return Array.isArray(data?.conversations) ? data.conversations : [];
}

/**
 * One conversation with its messages. A chat that was never written to still has
 * to render, so a missing messages field becomes an empty list rather than a
 * crash while drawing the thread.
 * @param {string} id
 * @returns {Promise<{ id: string, title: string, messages: Array<{ role: string, content: string, createdAt?: string }> }>}
 */
export async function fetchConversation(id) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`);
  const conversation = data?.conversation ?? {};
  return { ...conversation, messages: Array.isArray(data?.messages) ? data.messages : [] };
}

/**
 * Start a saved conversation. The chat screen calls this on the first send, so a
 * person who opens a new chat and then changes their mind leaves no empty rows.
 * The model travels with the thread so a chat opened elsewhere is answered by the
 * same model it was started with.
 * @param {string} title
 * @param {string} [model]
 */
export async function createConversation(title, model) {
  const data = await api('/api/me/conversations', { method: 'POST', body: JSON.stringify({ title, model }) });
  return data?.conversation ?? {};
}

/**
 * Store finished turns in a conversation, one request per turn. The server takes a
 * single message at a time, and sending the question first means a reply that fails
 * to save never leaves the chat with an answer and no question.
 * @param {string} id
 * @param {Array<{ role: string, content: string }>} messages
 */
export async function appendMessage(id, messages) {
  let last = null;
  for (const message of messages) {
    last = await api(`/api/me/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: message.role, content: message.content }),
    });
  }
  return last;
}

/** @param {string} id @param {string} title */
export async function renameConversation(id, title) {
  const data = await api(`/api/me/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  return data?.conversation ?? {};
}

/** @param {string} id */
export async function deleteConversation(id) {
  return api(`/api/me/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * Where the streamed chat request goes. The server has one chat route, shared by the
 * desktop app and this screen, so there is nothing to fall back to.
 */
const CHAT_PATH = '/api/chat';

/** @param {Response} response @returns {Promise<Error>} */
async function streamFailure(response) {
  const body = await response.json().catch(() => null);
  const error = new Error(body?.error?.message ?? 'The chat request failed.');
  error.status = response.status;
  error.code = body?.error?.code ?? '';
  return error;
}

/**
 * Send the conversation and read the reply as it arrives.
 *
 * The answer is server-sent events: each event is one `data: ` line holding JSON,
 * closed by a blank line. `delta` carries the text that just arrived, `done`
 * carries the finished reply, and `error` carries the server's own refusal. One
 * reader over the response body is the whole parser, which is why no streaming
 * library is needed.
 *
 * @param {{
 *   messages: Array<{ role: string, content: string }>,
 *   model?: string,
 *   signal?: AbortSignal,
 *   onDelta?: (text: string) => void,
 * }} input
 * @returns {Promise<{ content: string, model?: string, modelName?: string, usage?: object }>}
 */
export async function streamChat({ messages, model = DEFAULT_CHAT_MODEL, signal, onDelta }) {
  const token = readToken();
  const response = await fetch(`${API_BASE_URL}${CHAT_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, model, stream: true }),
    signal,
  });

  if (!response.ok) throw await streamFailure(response);
  // A browser without ReadableStream support would hang on a reply it can never
  // read, so say so instead of leaving a bubble waiting for ever.
  if (!response.body) throw new Error('This browser cannot read a streamed reply. Update it or use a current Chrome, Edge, Safari or Firefox.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are one line each. A chunk can stop halfway through a line, so a
      // line is only read once its newline has arrived and the tail stays buffered.
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;

        const payload = line.slice('data:'.length).trim();
        if (!payload) continue;

        let event = null;
        try {
          event = JSON.parse(payload);
        } catch {
          // A comment or keep-alive line: nothing to show and nothing to fail.
          continue;
        }

        if (event.type === 'delta' && typeof event.text === 'string') {
          content += event.text;
          onDelta?.(event.text);
          continue;
        }

        if (event.type === 'done') return { ...(event.data ?? {}), content: event.data?.content || content };

        if (event.type === 'error') {
          const error = new Error(event.error?.message ?? 'The chat request failed.');
          error.code = event.error?.code ?? '';
          // Marked so the screen can tell a refusal mid-reply from a failed POST.
          error.streamed = true;
          throw error;
        }
      }
    }
  } finally {
    // Stop leaves the reader holding a connection that nothing will drain.
    reader.cancel().catch(() => undefined);
  }

  // The stream ended without `done`, which means the network dropped mid-reply.
  // What did arrive is still worth keeping on screen, so it is returned.
  return { content };
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
