import { randomUUID } from 'node:crypto';
import { PLANS, publicPlan } from './plans.js';
import { usageStatus } from './usage.js';
import { createRequestLimiter, limitsForPlan } from './limits.js';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CHAT_BODY_BYTES = 256 * 1024;
// Keep the lease longer than the provider timeout so a slow request cannot be
// released while it is still in flight and allow another request to overspend.
const RESERVATION_TTL_MS = 5 * 60 * 1000;

/** @param {unknown} value @returns {string} */
function json(value) {
  return JSON.stringify(value);
}

/** @param {number} status @param {object} body @param {Record<string, string>} [headers] @returns {Response} */
function response(status, body, headers = {}) {
  return new Response(json(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** @param {Request} request @param {number} [maxBytes] @returns {Promise<object>} */
async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
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

/** @param {unknown} messages @returns {{ ok: true, data: Array<{ role: string, content: string }>, inputTokens: number } | { ok: false, message: string }} */
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
    return { ok: false, message: 'Send between 1 and 50 chat messages.' };
  }
  const allowedRoles = new Set(['system', 'user', 'assistant']);
  const normalized = [];
  let characters = 0;
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object' || !allowedRoles.has(entry.role) || typeof entry.content !== 'string' || entry.content.trim() === '') {
      return { ok: false, message: 'Each message needs a supported role and text content.' };
    }
    characters += entry.content.length;
    if (characters > 400_000) return { ok: false, message: 'The conversation is too large.' };
    normalized.push({ role: entry.role, content: entry.content });
  }
  return { ok: true, data: normalized, inputTokens: Math.ceil(characters / 4) };
}

/** @param {{ auth?: object, repository?: object, now?: () => Date }} [dependencies] @returns {(request: Request) => Promise<Response>} */
export function createApp(dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const limiter = dependencies.limiter ?? createRequestLimiter({ now: () => now().getTime() });

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

    if (request.method === 'POST' && url.pathname === '/api/chat') {
      if (!dependencies.auth || !dependencies.repository?.reserveUsage || !dependencies.repository?.commitUsage || !dependencies.repository?.releaseUsage || typeof dependencies.chatProvider !== 'function') {
        return response(503, { ok: false, error: { code: 'CHAT_NOT_CONFIGURED', message: 'Cloud chat is not configured yet.' } });
      }
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      try {
        const body = await readJson(request, MAX_CHAT_BODY_BYTES);
        const messages = validateMessages(body.messages);
        if (!messages.ok) return response(400, { ok: false, error: { code: 'INVALID_MESSAGES', message: messages.message } });
        const limits = limitsForPlan(session.subscription.planCode);
        if (messages.inputTokens > limits.maxInputTokens) {
          return response(413, { ok: false, error: { code: 'INPUT_TOO_LARGE', message: `Keep the conversation below ${limits.maxInputTokens} input tokens.` } });
        }
        const lease = limiter.acquire(session.user.id, limits);
        if (!lease.allowed) {
          return response(429, { ok: false, error: { code: lease.reason === 'concurrency_limit' ? 'CONCURRENCY_LIMIT' : 'RATE_LIMITED', message: 'This account has reached its request limit. Try again shortly.' } }, { 'retry-after': String(lease.retryAfterSeconds) });
        }
        let reservation;
        const requestId = randomUUID();
        try {
          // Reserve the full allowed request envelope. This is conservative,
          // but prevents tokenizer differences from overspending the quota.
          reservation = await dependencies.repository.reserveUsage({
            userId: session.user.id,
            subscriptionId: session.subscription.id,
            requestedTokens: limits.maxInputTokens + limits.maxOutputTokens,
            expiresAt: new Date(now().getTime() + RESERVATION_TTL_MS),
          });
          const model = typeof body.model === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(body.model.trim())
            ? body.model.trim()
            : (dependencies.defaultModel ?? 'deepseek-chat');
          const result = await dependencies.chatProvider({ messages: messages.data, model, maxTokens: limits.maxOutputTokens, signal: AbortSignal.timeout(120_000) });
          await dependencies.repository.commitUsage({
            reservationId: reservation.id,
            userId: session.user.id,
            model: result.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            requestId,
          });
          return response(200, { ok: true, data: { requestId, model: result.model, content: result.content, usage: result.usage } });
        } catch (error) {
          if (reservation?.id) await dependencies.repository.releaseUsage(reservation.id, session.user.id).catch((releaseError) => console.error('[zuri-cloud] release usage', releaseError?.message ?? releaseError));
          if (error?.code === 'QUOTA_EXCEEDED') return response(429, { ok: false, error: { code: error.code, message: error.message } });
          if (error?.code === 'PROVIDER_REQUEST_FAILED' || error?.code === 'PROVIDER_RESPONSE_INVALID') return response(502, { ok: false, error: { code: error.code, message: error.message } });
          console.error('[zuri-cloud] chat', error?.message ?? error);
          return response(500, { ok: false, error: { code: 'CHAT_FAILED', message: 'The chat request could not be completed.' } });
        } finally {
          lease.release();
        }
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        throw error;
      }
    }

    if (url.pathname === '/api/me' || url.pathname === '/api/me/usage' || url.pathname === '/api/me/limits' || url.pathname === '/api/auth/sign-out') {
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
      if (url.pathname === '/api/me/limits') {
        return response(200, {
          ok: true,
          data: {
            planCode: session.subscription.planCode,
            limits: limitsForPlan(session.subscription.planCode),
            usage: usageStatus(session.subscription, usage.usedTokens),
          },
        });
      }
      return response(200, { ok: true, data: usageStatus(session.subscription, usage.usedTokens) });
    }

    return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
  };
}

/** @param {Request} request @param {object} [dependencies] @returns {Promise<Response>} */
export async function handleRequest(request, dependencies = {}) {
  return createApp(dependencies)(request);
}
