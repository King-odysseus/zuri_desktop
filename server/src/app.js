import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlan, PLANS, publicPlan } from './plans.js';
import { usageStatus } from './usage.js';
import { createRequestLimiter, limitsForPlan } from './limits.js';
import { verifyPaystackSignature } from './paystack.js';
import { DOWNLOAD_CONTENT_TYPE, listDownloads, resolveDownloadPath } from './downloads.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ASSETS_DIR = `${PUBLIC_DIR}${path.sep}assets`;
// Only these extensions are ever served from public/; anything else is a 404, so
// stray files (source maps, editor backups) cannot leak out of the bundle.
const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.webp', 'image/webp'],
  ['.json', 'application/json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);
const DASHBOARD_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline'; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; img-src 'self' data: https:",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});
const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});
const MAX_BODY_BYTES = 16 * 1024;
const MAX_CHAT_BODY_BYTES = 256 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
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

/**
 * Serve a built file from public/ (the React bundle lives there).
 *
 * Resolution is done against PUBLIC_DIR and anything that escapes it is refused,
 * so a crafted '../' can never reach the server sources. Paths without an
 * extension fall back to index.html: that keeps the dashboard working when the
 * browser reloads a client-side route.
 *
 * @param {string} pathname
 * @returns {Promise<Response | null>} null when the caller should answer 404.
 */
/**
 * The built single-page app's entry document. Sent for the root and for any
 * extension-less route the client router owns.
 * @returns {Promise<Response>}
 */
async function appShell() {
  const shell = await readFile(path.join(PUBLIC_DIR, 'index.html'));
  return new Response(shell, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...DASHBOARD_SECURITY_HEADERS },
  });
}

async function serveStatic(pathname) {
  let requested;
  try {
    requested = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return null; // malformed percent-encoding
  }

  const filePath = path.resolve(PUBLIC_DIR, requested);
  const insidePublic = filePath === PUBLIC_DIR || filePath.startsWith(`${PUBLIC_DIR}${path.sep}`);
  if (!insidePublic) return null;

  const extension = path.extname(filePath).toLowerCase();
  const type = STATIC_TYPES.get(extension);

  // An extension-less path is one of the app's own pages (/signin, /signup),
  // so it gets the shell. A path that names a file type we do not ship is a
  // miss: answering it with HTML would hide a broken asset behind a 200.
  if (!type) return extension === '' ? appShell() : null;

  try {
    const body = await readFile(filePath);
    // Vite fingerprints everything in assets/, so those files can be cached hard.
    const cacheControl = filePath.startsWith(`${ASSETS_DIR}${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': type, 'cache-control': cacheControl, ...DASHBOARD_SECURITY_HEADERS },
    });
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'EISDIR') throw error;
  }

  // A directory path such as /img/ has no page behind it either.
  return extension === '' ? appShell() : null;
}

/**
 * Send one installer from the downloads folder as a file attachment.
 *
 * The name is validated by resolveDownloadPath before it is resolved, so a
 * crafted '../' is refused rather than normalised away, and a folder that is
 * empty (the installers are not in git) answers 404 instead of 500.
 *
 * @param {string} rawName percent-encoded file name taken from the URL
 * @returns {Promise<Response>}
 */
async function serveDownload(rawName) {
  let name;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return response(400, { ok: false, error: { code: 'INVALID_DOWNLOAD', message: 'That download link is not valid.' } });
  }

  const filePath = resolveDownloadPath(name);
  if (!filePath) return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No such download.' } });

  try {
    const body = await readFile(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': DOWNLOAD_CONTENT_TYPE,
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="${name}"`,
        // A rebuilt installer keeps its file name, so caching it would hand out
        // the previous build after an update.
        'cache-control': 'no-cache',
        ...DASHBOARD_SECURITY_HEADERS,
      },
    });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No such download.' } });
    }
    throw error;
  }
}

/** @param {Request} request @param {number} maxBytes @returns {Promise<string>} */
async function readRawBody(request, maxBytes) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    const error = new Error('The request body is too large.');
    error.code = 'BODY_TOO_LARGE';
    throw error;
  }
  return raw;
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

/** @param {string} siteUrl @returns {string} */
function siteBase(siteUrl) {
  return typeof siteUrl === 'string' ? siteUrl.trim().replace(/\/+$/, '') : '';
}

/**
 * Map an auth service error onto its answer, so every account route reports the
 * same code for the same mistake. Returns null for anything unexpected, leaving
 * the caller to log it and answer a 500.
 * @param {unknown} error
 * @returns {Response | null}
 */
function authErrorResponse(error) {
  const code = error?.code;
  const message = error?.message ?? 'The request could not be completed.';
  if (code === 'INVALID_EMAIL' || code === 'INVALID_PASSWORD' || code === 'INVALID_RESET_TOKEN' || code === 'BODY_TOO_LARGE' || code === 'INVALID_JSON') {
    return response(400, { ok: false, error: { code, message } });
  }
  if (code === 'INVALID_CREDENTIALS') return response(401, { ok: false, error: { code, message } });
  if (code === 'ACCOUNT_NOT_ACTIVE') return response(403, { ok: false, error: { code, message } });
  if (code === 'EMAIL_TAKEN' || code === 'PASSWORD_NOT_SET') return response(409, { ok: false, error: { code, message } });
  return null;
}

/**
 * The body every sign-in path answers with: the session plus the plan usage the
 * dashboard shows straight away.
 * @param {{ auth?: object, repository?: object }} dependencies
 * @param {{ token: string }} result
 * @returns {Promise<object>}
 */
async function sessionPayload(dependencies, result) {
  const session = await dependencies.auth.authenticate(result.token);
  const getUsage = dependencies.repository?.getUsage;
  if (!session || typeof getUsage !== 'function') return { ...result, usage: null };
  const usage = await getUsage(session.user.id, session.subscription.currentPeriodStart, session.subscription);
  return { ...result, usage: usageStatus(session.subscription, usage.usedTokens) };
}

/** @param {{ auth?: object, repository?: object, mailer?: object, now?: () => Date, googleClientId?: string, siteUrl?: string }} [dependencies] @returns {(request: Request) => Promise<Response>} */
export function createApp(dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const limiter = dependencies.limiter ?? createRequestLimiter({ now: () => now().getTime() });
  const siteUrl = siteBase(dependencies.siteUrl);

  return async function app(request) {
    const url = new URL(request.url);

    if ((request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
      const asset = await serveStatic(url.pathname);
      if (asset) return asset;
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return response(200, { ok: true, service: 'zuri-cloud', time: now().toISOString() });
    }
    if (request.method === 'GET' && url.pathname === '/api/plans') {
      return response(200, { ok: true, data: PLANS.map(publicPlan) });
    }
    if (request.method === 'GET' && url.pathname === '/api/public-config') {
      return response(200, {
        ok: true,
        data: {
          googleClientId: typeof dependencies.googleClientId === 'string' ? dependencies.googleClientId : '',
          passwordSignIn: true,
          siteUrl,
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/downloads') {
      return response(200, { ok: true, data: { files: await listDownloads() } });
    }

    // Installers are sent as an attachment so the click saves the file instead of
    // the browser trying to display a 140 MB executable.
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/downloads/')) {
      return serveDownload(url.pathname.slice('/downloads/'.length));
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/google') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Google sign-in is not configured yet.' } });
      try {
        const body = await readJson(request);
        const result = await dependencies.auth.signInWithGoogle(body.credential);
        return response(200, { ok: true, data: await sessionPayload(dependencies, result) });
      } catch (error) {
        if (error?.code === 'AUTH_NOT_CONFIGURED') return response(503, { ok: false, error: { code: error.code, message: error.message } });
        const handled = authErrorResponse(error);
        if (handled) return handled;
        console.error('[zuri-cloud] google sign-in', error?.message ?? error);
        return response(401, { ok: false, error: { code: 'GOOGLE_SIGN_IN_FAILED', message: 'Google sign-in could not be completed.' } });
      }
    }

    if (request.method === 'POST' && (url.pathname === '/api/auth/sign-up' || url.pathname === '/api/auth/sign-in')) {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is not configured yet.' } });
      const signingUp = url.pathname === '/api/auth/sign-up';
      try {
        const body = await readJson(request);
        const result = signingUp
          ? await dependencies.auth.signUpWithPassword({ email: body.email, password: body.password, displayName: body.displayName })
          : await dependencies.auth.signInWithPassword({ email: body.email, password: body.password });
        return response(signingUp ? 201 : 200, { ok: true, data: await sessionPayload(dependencies, result) });
      } catch (error) {
        const handled = authErrorResponse(error);
        if (handled) return handled;
        console.error('[zuri-cloud] password sign-in', error?.message ?? error);
        return signingUp
          ? response(500, { ok: false, error: { code: 'SIGN_UP_FAILED', message: 'The account could not be created.' } })
          : response(500, { ok: false, error: { code: 'SIGN_IN_FAILED', message: 'The account could not be opened.' } });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is not configured yet.' } });
      if (dependencies.mailer?.configured !== true) {
        return response(503, { ok: false, error: { code: 'MAIL_NOT_CONFIGURED', message: 'Password email is not configured yet.' } });
      }
      try {
        const body = await readJson(request);
        // SITE_URL wins so a reset link can never be built from a client-supplied
        // Host header; the request origin is only the local-development fallback.
        const result = await dependencies.auth.requestPasswordReset({ email: body.email, siteUrl: siteUrl || url.origin });
        if (result.delivery) {
          // A send failure is logged, never answered: the reply has to look the same
          // whether or not the address belongs to an account.
          await dependencies.mailer
            .sendPasswordReset(result.delivery)
            .catch((error) => console.error('[zuri-cloud] password reset email', error?.message ?? error));
        }
        return response(200, { ok: true, data: { sent: true } });
      } catch (error) {
        const handled = authErrorResponse(error);
        if (handled) return handled;
        console.error('[zuri-cloud] forgot password', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'PASSWORD_RESET_FAILED', message: 'The reset email could not be sent.' } });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Account sign-in is not configured yet.' } });
      try {
        const body = await readJson(request);
        const result = await dependencies.auth.resetPassword({ token: body.token, password: body.password });
        return response(200, { ok: true, data: result });
      } catch (error) {
        const handled = authErrorResponse(error);
        if (handled) return handled;
        console.error('[zuri-cloud] reset password', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'PASSWORD_RESET_FAILED', message: 'The password could not be changed.' } });
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

    if (request.method === 'POST' && url.pathname === '/api/billing/checkout') {
      if (!dependencies.auth || !dependencies.repository?.createPayment || !dependencies.repository?.markPaymentFailed || !dependencies.paystack) {
        return response(503, { ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Paystack billing is not configured yet.' } });
      }
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      try {
        const body = await readJson(request);
        const plan = findPlan(body.planCode);
        if (!plan || plan.code === 'free') return response(400, { ok: false, error: { code: 'INVALID_PLAN', message: 'Choose a paid plan to start checkout.' } });
        const paystackPlanCode = dependencies.paystackPlanCodes?.[plan.code] ?? '';
        if (paystackPlanCode === '') return response(503, { ok: false, error: { code: 'PAYSTACK_PLAN_NOT_CONFIGURED', message: 'This paid plan is not configured for recurring billing yet.' } });
        const reference = `zuri-${randomUUID()}`;
        await dependencies.repository.createPayment({ userId: session.user.id, planCode: plan.code, reference, amountKobo: plan.amountKobo });
        try {
          const checkout = await dependencies.paystack.initializeTransaction({
            email: session.user.email,
            amountKobo: plan.amountKobo,
            reference,
            planCode: paystackPlanCode,
            callbackUrl: dependencies.paystackCallbackUrl,
          });
          return response(200, { ok: true, data: { reference, plan: publicPlan(plan), authorizationUrl: checkout.authorization_url, accessCode: checkout.access_code } });
        } catch (error) {
          await dependencies.repository.markPaymentFailed(reference, { code: error?.code ?? 'PAYSTACK_REQUEST_FAILED' }).catch((markError) => console.error('[zuri-cloud] mark payment failed', markError?.message ?? markError));
          throw error;
        }
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'PAYSTACK_REQUEST_FAILED') return response(502, { ok: false, error: { code: error.code, message: error.message } });
        console.error('[zuri-cloud] checkout', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'CHECKOUT_FAILED', message: 'Checkout could not be started.' } });
      }
    }

    if (request.method === 'GET' && (url.pathname === '/api/billing/verify' || url.pathname === '/api/billing/callback')) {
      const reference = url.searchParams.get('reference')?.trim() ?? '';
      if (!/^[A-Za-z0-9.=-]{8,100}$/.test(reference)) return response(400, { ok: false, error: { code: 'INVALID_REFERENCE', message: 'A valid payment reference is required.' } });
      if (!dependencies.paystack || !dependencies.repository?.applySuccessfulPayment) return response(503, { ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Paystack billing is not configured yet.' } });
      try {
        const transaction = await dependencies.paystack.verifyTransaction(reference);
        if (transaction?.status !== 'success') {
          await dependencies.repository.markPaymentFailed?.(reference, transaction);
          return response(400, { ok: false, error: { code: 'PAYMENT_NOT_CONFIRMED', message: 'Paystack did not confirm this payment.' } });
        }
        const result = await dependencies.repository.applySuccessfulPayment({ reference, transaction });
        return response(200, { ok: true, data: { reference, ...result } });
      } catch (error) {
        if (error?.code === 'PAYMENT_NOT_CONFIRMED' || error?.code === 'PAYMENT_DETAILS_MISMATCH') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'PAYMENT_NOT_FOUND') return response(404, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'PAYSTACK_REQUEST_FAILED') return response(502, { ok: false, error: { code: error.code, message: error.message } });
        console.error('[zuri-cloud] verify payment', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'PAYMENT_VERIFICATION_FAILED', message: 'The payment could not be verified.' } });
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/paystack/webhook') {
      if (!dependencies.paystackSecretKey || !dependencies.repository?.applySuccessfulPayment || !dependencies.repository?.updateSubscriptionFromPaystack || !dependencies.repository?.markPaymentFailed) {
        return response(503, { ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Paystack billing is not configured yet.' } });
      }
      try {
        const rawBody = await readRawBody(request, MAX_WEBHOOK_BODY_BYTES);
        if (!verifyPaystackSignature(rawBody, request.headers.get('x-paystack-signature'), dependencies.paystackSecretKey)) {
          return response(401, { ok: false, error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'The webhook signature is invalid.' } });
        }
        let event;
        try {
          event = JSON.parse(rawBody);
        } catch {
          return response(400, { ok: false, error: { code: 'INVALID_JSON', message: 'Send a valid webhook JSON object.' } });
        }
        if (!event || typeof event !== 'object' || typeof event.event !== 'string') return response(400, { ok: false, error: { code: 'INVALID_WEBHOOK', message: 'The webhook event is incomplete.' } });
        let result = { applied: false };
        if (event.event === 'charge.success') {
          const reference = typeof event.data?.reference === 'string' ? event.data.reference : '';
          if (reference === '') return response(400, { ok: false, error: { code: 'WEBHOOK_REFERENCE_MISSING', message: 'The payment reference is missing.' } });
          try {
            result = await dependencies.repository.applySuccessfulPayment({ reference, transaction: event.data });
          } catch (error) {
            if (error?.code !== 'PAYMENT_NOT_FOUND') throw error;
            result = await dependencies.repository.updateSubscriptionFromPaystack(event);
          }
        } else if (event.event === 'charge.failed') {
          const reference = typeof event.data?.reference === 'string' ? event.data.reference : '';
          if (reference !== '') await dependencies.repository.markPaymentFailed(reference, event.data);
        } else if (['subscription.create', 'subscription.disable', 'subscription.not_renew', 'invoice.payment_failed'].includes(event.event)) {
          result = await dependencies.repository.updateSubscriptionFromPaystack(event);
        }
        return response(200, { ok: true, data: { received: true, ...result } });
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'PAYMENT_NOT_FOUND') return response(200, { ok: true, data: { received: true, applied: false } });
        console.error('[zuri-cloud] paystack webhook', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'The webhook could not be processed.' } });
      }
    }

    if (url.pathname === '/api/me' || url.pathname === '/api/me/usage' || url.pathname === '/api/me/limits' || url.pathname === '/api/me/billing' || url.pathname === '/api/auth/sign-out' || url.pathname === '/api/auth/set-password') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured yet.' } });
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      if (request.method === 'POST' && url.pathname === '/api/auth/sign-out') {
        await dependencies.auth.signOut(token);
        return response(200, { ok: true, data: { signedOut: true } });
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/set-password') {
        try {
          const body = await readJson(request);
          // The id comes from the session, never from the body, so a request can
          // only ever add a password to the account that presented the token.
          await dependencies.auth.setPassword({ userId: session.user.id, password: body.password });
          return response(200, { ok: true, data: { updated: true } });
        } catch (error) {
          const handled = authErrorResponse(error);
          if (handled) return handled;
          console.error('[zuri-cloud] set password', error?.message ?? error);
          return response(500, { ok: false, error: { code: 'PASSWORD_SAVE_FAILED', message: 'The password could not be saved.' } });
        }
      }
      if (request.method !== 'GET') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this account endpoint.' } });
      if (url.pathname === '/api/me') return response(200, { ok: true, data: session });
      if (url.pathname === '/api/me/billing') {
        if (!dependencies.repository?.getBilling) return response(503, { ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Billing data is not configured yet.' } });
        return response(200, { ok: true, data: await dependencies.repository.getBilling(session.user.id) });
      }
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
