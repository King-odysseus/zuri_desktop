import { PLANS, publicPlan } from './plans.js';
import { usageStatus } from './usage.js';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});
const MAX_BODY_BYTES = 16 * 1024;

/** @param {unknown} value @returns {string} */
function json(value) {
  return JSON.stringify(value);
}

/** @param {number} status @param {object} body @param {Record<string, string>} [headers] @returns {Response} */
function response(status, body, headers = {}) {
  return new Response(json(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** @param {Request} request @returns {Promise<object>} */
async function readJson(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    const error = new Error('The request body is too large.');
    error.code = 'BODY_TOO_LARGE';
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object');
    return parsed;
  } catch {
    const error = new Error('Send a valid JSON object.');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

/** @param {Request} request @returns {string} */
function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? '';
}

/** @param {{ auth?: object, repository?: object, now?: () => Date }} [dependencies] @returns {(request: Request) => Promise<Response>} */
export function createApp(dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());

  return async function app(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return response(200, { ok: true, service: 'zuri-cloud', time: now().toISOString() });
    }
    if (request.method === 'GET' && url.pathname === '/api/plans') {
      return response(200, { ok: true, data: PLANS.map(publicPlan) });
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/google') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Google sign-in is not configured yet.' } });
      try {
        const body = await readJson(request);
        const result = await dependencies.auth.signInWithGoogle(body.credential);
        const session = await dependencies.auth.authenticate(result.token);
        const usage = session && dependencies.repository
          ? usageStatus(session.subscription, (await dependencies.repository.getUsage(session.user.id, session.subscription.currentPeriodStart, session.subscription)).usedTokens)
          : null;
        return response(200, { ok: true, data: { ...result, usage } });
      } catch (error) {
        if (error?.code === 'ACCOUNT_NOT_ACTIVE') return response(403, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        console.error('[zuri-cloud] google sign-in', error?.message ?? error);
        return response(401, { ok: false, error: { code: 'GOOGLE_SIGN_IN_FAILED', message: 'Google sign-in could not be completed.' } });
      }
    }

    if (url.pathname === '/api/me' || url.pathname === '/api/me/usage' || url.pathname === '/api/auth/sign-out') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured yet.' } });
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      if (request.method === 'POST' && url.pathname === '/api/auth/sign-out') {
        await dependencies.auth.signOut(token);
        return response(200, { ok: true, data: { signedOut: true } });
      }
      if (request.method !== 'GET') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this account endpoint.' } });
      if (url.pathname === '/api/me') return response(200, { ok: true, data: session });
      if (!dependencies.repository?.getUsage) return response(503, { ok: false, error: { code: 'USAGE_NOT_CONFIGURED', message: 'Usage data is not configured yet.' } });
      const usage = await dependencies.repository.getUsage(session.user.id, session.subscription.currentPeriodStart, session.subscription);
      return response(200, { ok: true, data: usageStatus(session.subscription, usage.usedTokens) });
    }

    return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
  };
}

/** @param {Request} request @param {object} [dependencies] @returns {Promise<Response>} */
export async function handleRequest(request, dependencies = {}) {
  return createApp(dependencies)(request);
}
