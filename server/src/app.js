import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlan, PLANS, publicPlan } from './plans.js';
import { findTopupPack, publicTopupPack, TOPUP_PACKS } from './topups.js';
import { usageStatus } from './usage.js';
import { createRequestLimiter, limitsForPlan, PLAN_LIMITS } from './limits.js';
import { DEFAULT_MODELS, canUseModel, findModel, imagePriceKobo, imageSupplierCostMicroUsd, isImageModel, limitsForModel, microUsdToKobo, publicImageModel, publicModel, quotaTokens, supplierCostMicroUsd, validateModelInput } from './models.js';
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
const DEFAULT_NAIRA_PER_USD = 1600;
// A saved conversation is one line in a list column and one line in a header, so 60
// characters is what both surfaces can show without cutting the words off mid-sentence.
const CONVERSATION_TITLE_MAX_LENGTH = 60;
const CONVERSATION_DEFAULT_TITLE = 'New chat';
const CONVERSATION_DEFAULT_MODEL = 'zuri-flash';
const CONVERSATION_MODEL_MAX_LENGTH = 64;
const CONVERSATION_ORIGINS = new Set(['web', 'desktop', 'android']);
const MESSAGE_ROLES = new Set(['user', 'assistant', 'system']);
const MESSAGE_MAX_LENGTH = 100000;
// readJson refuses an oversized body before any field is read, so this cap has to sit
// well above one maximum-length message once it is encoded as JSON. Otherwise an
// oversized message would come back as BODY_TOO_LARGE instead of MESSAGE_TOO_LARGE.
const MAX_MESSAGE_BODY_BYTES = 1024 * 1024;
const CONVERSATIONS_PATH = '/api/me/conversations';

/** The model catalogue: the database when it has one, the built-in defaults otherwise. */
async function loadModels(dependencies) {
  return typeof dependencies.repository?.listModels === 'function'
    ? dependencies.repository.listModels()
    : DEFAULT_MODELS.map((model) => ({ ...model }));
}

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
  const allowedRoles = new Set(['system', 'user', 'assistant', 'tool']);
  const normalized = [];
  let characters = 0;
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object' || !allowedRoles.has(entry.role) || typeof entry.content !== 'string') {
      return { ok: false, message: 'Each message needs a supported role and text content.' };
    }
    // A tool result can legitimately be an empty string (a tool that only wrote a
    // file), and an assistant turn that only asked for a tool has no text either.
    const mayBeEmpty = entry.role === 'tool' || entry.role === 'assistant';
    if (!mayBeEmpty && entry.content.trim() === '') {
      return { ok: false, message: 'Each message needs a supported role and text content.' };
    }

    // The two additions a tool loop needs: the id a result answers, and the calls an
    // assistant turn made. Both are bounded here so a crafted body cannot make the
    // server repeat an unbounded conversation back to a supplier.
    if (entry.role === 'tool') {
      if (typeof entry.toolCallId !== 'string' || entry.toolCallId === '' || entry.toolCallId.length > 120) {
        return { ok: false, message: 'A tool result needs the id of the call it answers.' };
      }
      normalized.push({ role: 'tool', content: entry.content, toolCallId: entry.toolCallId });
    } else if (entry.role === 'assistant' && Array.isArray(entry.toolCalls) && entry.toolCalls.length > 0) {
      if (entry.toolCalls.length > 8) return { ok: false, message: 'An assistant turn cannot call more than 8 tools.' };
      const calls = [];
      for (const call of entry.toolCalls) {
        if (!call || typeof call.name !== 'string' || call.name === '') {
          return { ok: false, message: 'Each tool call needs a name.' };
        }
        calls.push({
          id: typeof call.id === 'string' ? call.id.slice(0, 120) : '',
          name: call.name.slice(0, 60),
          arguments: typeof call.arguments === 'string' ? call.arguments.slice(0, 20_000) : '{}',
        });
      }
      normalized.push({ role: 'assistant', content: entry.content, toolCalls: calls });
    } else {
      // An empty assistant turn that made no calls carries nothing to send.
      if (entry.content.trim() === '') continue;
      normalized.push({ role: entry.role, content: entry.content });
    }

    characters += entry.content.length;
    if (characters > 400_000) return { ok: false, message: 'The conversation is too large.' };
  }
  return { ok: true, data: normalized, inputTokens: Math.ceil(characters / 4) };
}

/**
 * The tools a request may offer the model.
 *
 * The model can only call a name that is on this list, and only the app decides what
 * is on it: the server forwards the definitions and never runs anything itself, so a
 * tool call coming back is a request the app still has to honour.
 * @param {unknown} tools
 * @returns {{ ok: true, data: Array<object> } | { ok: false, message: string }}
 */
function validateTools(tools) {
  if (tools === undefined || tools === null) return { ok: true, data: [] };
  if (!Array.isArray(tools)) return { ok: false, message: 'Tools must be a list.' };
  if (tools.length > 20) return { ok: false, message: 'Offer at most 20 tools.' };
  const normalized = [];
  for (const tool of tools) {
    if (!tool || typeof tool.name !== 'string' || tool.name === '' || tool.name.length > 60) {
      return { ok: false, message: 'Each tool needs a name of up to 60 characters.' };
    }
    const description = typeof tool.description === 'string' ? tool.description.slice(0, 2000) : '';
    const parameters = tool.parameters && typeof tool.parameters === 'object' ? tool.parameters : { type: 'object', properties: {} };
    normalized.push({ name: tool.name, description, parameters });
  }
  return { ok: true, data: normalized };
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
 * The usage options every signed-in answer shares: tokens bought on top of the
 * plan, and the rolling window when the repository measured one. Callers that
 * do not measure the window (the admin listing) pass nothing, and no window is
 * reported rather than a confident zero.
 * @param {{ creditTokens?: unknown, windowUsedTokens?: unknown, windowOldestAt?: unknown }} usage
 */
function usageOptions(usage) {
  const options = { creditTokens: usage?.creditTokens ?? 0 };
  if (typeof usage?.windowUsedTokens === 'number') {
    options.windowUsedTokens = usage.windowUsedTokens;
    options.windowOldestAt = usage.windowOldestAt;
  }
  return options;
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
  return { ...result, usage: usageStatus(session.subscription, usage.usedTokens, usageOptions(usage)) };
}

/** @param {{ subscription?: { status?: string } } | null | undefined } session */
function hasPaidSubscription(session) {
  const status = session?.subscription?.status;
  // Older repository adapters omit status, and their subscription rows are active
  // by contract. Live rows always carry an explicit status.
  return status === undefined || status === 'active' || status === 'past_due';
}

/** @param {unknown} value @returns {string} */
function trimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read a conversation title out of a request body.
 *
 * An absent or blank title takes the fallback, which is 'New chat' for a new thread and
 * an empty string for a rename, where a blank title is a refusal rather than a default.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function conversationTitle(value, fallback) {
  return trimmedText(value).slice(0, CONVERSATION_TITLE_MAX_LENGTH) || fallback;
}

/**
 * The model is recorded for display only, so a label the catalogue no longer lists is
 * kept rather than refused: a thread stays readable after its model is retired. The cap
 * only stops a bad client from storing a wall of text in the column.
 * @param {unknown} value
 * @returns {string}
 */
function conversationModel(value) {
  return trimmedText(value).slice(0, CONVERSATION_MODEL_MAX_LENGTH) || CONVERSATION_DEFAULT_MODEL;
}

/** @param {unknown} value @returns {string} */
function conversationOrigin(value) {
  const origin = trimmedText(value).toLowerCase();
  return CONVERSATION_ORIGINS.has(origin) ? origin : 'web';
}

/**
 * @param {object} body
 * @returns {{ ok: true, role: string, content: string } | { ok: false, code: string, message: string }}
 */
function checkedMessage(body) {
  const role = trimmedText(body?.role);
  if (!MESSAGE_ROLES.has(role)) {
    return { ok: false, code: 'INVALID_MESSAGE', message: 'A message role is user, assistant or system.' };
  }
  const content = typeof body?.content === 'string' ? body.content : '';
  if (content.trim() === '') return { ok: false, code: 'INVALID_MESSAGE', message: 'A message needs some text.' };
  // The length is measured on the text as sent, because that is the text that is stored.
  if (content.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, code: 'MESSAGE_TOO_LARGE', message: `A message can be at most ${MESSAGE_MAX_LENGTH} characters.` };
  }
  return { ok: true, role, content };
}

/**
 * Map a refusal from the conversation repository to its response.
 *
 * A thread owned by another account arrives here as CONVERSATION_NOT_FOUND, and it is
 * answered exactly like a missing one: a separate "forbidden" would let a caller test
 * whether somebody else's id exists. Anything unrecognised returns null so the caller
 * reports a fault as a fault rather than as a missing conversation.
 * @param {unknown} error
 * @returns {Response | null}
 */
function conversationErrorResponse(error) {
  const code = error?.code;
  if (code === 'CONVERSATION_NOT_FOUND') return response(404, { ok: false, error: { code, message: 'That conversation does not exist.' } });
  if (code === 'CONVERSATION_LIMIT') return response(400, { ok: false, error: { code, message: 'This account holds as many conversations as it can store. Delete one to start another.' } });
  if (code === 'MESSAGE_LIMIT') return response(400, { ok: false, error: { code, message: 'This conversation is full. Start a new one to carry on.' } });
  return null;
}

// The history routes take the owner from the token and name it in the query they run,
// so an ownership check is never a separate step that a later change can skip.
/** @param {{ auth?: object, repository?: object, mailer?: object, now?: () => Date, googleClientId?: string, siteUrl?: string, corsOrigins?: string[] }} [dependencies] @returns {(request: Request) => Promise<Response>} */
export function createApp(dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const limiter = dependencies.limiter ?? createRequestLimiter({ now: () => now().getTime() });
  const siteUrl = siteBase(dependencies.siteUrl);
  const corsOrigins = new Set(Array.isArray(dependencies.corsOrigins) ? dependencies.corsOrigins : []);

  const handle = async function app(request) {
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
    // Extra-usage packs are public for the same reason plans are: the dashboard
    // quotes the price before anybody commits to paying it.
    if (request.method === 'GET' && url.pathname === '/api/topups') {
      return response(200, { ok: true, data: TOPUP_PACKS.map(publicTopupPack) });
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

    // Public because the marketing page quotes picture prices before anyone signs
    // in. It reads the live catalogue so an admin edit shows up straight away.
    if (url.pathname === '/api/image-prices') {
      if (request.method !== 'GET') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' } });
      const images = (await loadModels(dependencies))
        .filter((model) => model.isActive && isImageModel(model))
        .sort((left, right) => left.sortOrder - right.sortOrder);
      return response(200, { ok: true, data: images.map((model) => publicImageModel(model, PLANS)) });
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
      if (!hasPaidSubscription(session)) return response(402, { ok: false, error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Choose a paid plan to use chat.' } });
      try {
        const body = await readJson(request, MAX_CHAT_BODY_BYTES);
        const messages = validateMessages(body.messages);
        if (!messages.ok) return response(400, { ok: false, error: { code: 'INVALID_MESSAGES', message: messages.message } });
        const offeredTools = validateTools(body.tools);
        if (!offeredTools.ok) return response(400, { ok: false, error: { code: 'INVALID_TOOLS', message: offeredTools.message } });
        const catalogue = await loadModels(dependencies);
        const zuriModel = findModel(catalogue, body.model);
        if (!zuriModel) return response(400, { ok: false, error: { code: 'UNKNOWN_MODEL', message: 'That model is not available.' } });
        // Pictures are sold by the image, so a chat request must not hand a picture
        // model's supplier name to the text endpoint and bill nothing for it.
        if (isImageModel(zuriModel)) {
          return response(400, { ok: false, error: { code: 'IMAGE_MODEL', message: `${zuriModel.name} makes pictures rather than chat replies. Choose a chat model.` } });
        }
        if (!canUseModel(zuriModel, session.subscription.planCode)) {
          return response(403, { ok: false, error: { code: 'PLAN_UPGRADE_REQUIRED', message: `${zuriModel.name} needs a higher plan. Upgrade to use it.` } });
        }
        const limits = limitsForModel(limitsForPlan(session.subscription.planCode), zuriModel);
        if (messages.inputTokens > limits.maxInputTokens) {
          return response(413, { ok: false, error: { code: 'INPUT_TOO_LARGE', message: `Keep the conversation below ${limits.maxInputTokens} input tokens.` } });
        }
        // The limiter key includes the model so a dear model's smaller allowance
        // cannot be spent by cheap requests, and the other way round.
        const lease = limiter.acquire(`${session.user.id}:${zuriModel.code}`, limits);
        if (!lease.allowed) {
          return response(429, { ok: false, error: { code: lease.reason === 'concurrency_limit' ? 'CONCURRENCY_LIMIT' : 'RATE_LIMITED', message: 'This account has reached its request limit. Try again shortly.' } }, { 'retry-after': String(lease.retryAfterSeconds) });
        }
        let reservation;
        const requestId = randomUUID();

        // The request lease is released exactly once. The streamed branch returns
        // its Response before the direct branch's finally would run, so a shared
        // guard is what keeps the limiter's slot from being held for ever.
        let leaseReleased = false;
        const releaseLease = () => {
          if (leaseReleased) return;
          leaseReleased = true;
          lease.release();
        };

        /**
         * Record what a finished reply actually spent. Both the streamed and the
         * direct answer go through here, so the two can never bill differently.
         * @param {{ model: string, usage: { inputTokens: number, outputTokens: number } }} result
         */
        const commitReply = (result) =>
          dependencies.repository.commitUsage({
            reservationId: reservation.id,
            userId: session.user.id,
            model: result.model,
            modelCode: zuriModel.code,
            supplier: zuriModel.supplier,
            quotaTokens: quotaTokens(zuriModel, result.usage.inputTokens, result.usage.outputTokens),
            costMicroUsd: supplierCostMicroUsd(zuriModel, result.usage.inputTokens, result.usage.outputTokens),
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            requestId,
          });

        /**
         * Map a failure onto the answer the client should see, so the streamed and
         * the direct route report the same code for the same mistake.
         * @param {any} error
         * @returns {{ status: number, body: object }}
         */
        const failureFor = (error) => {
          if (error?.code === 'QUOTA_EXCEEDED') return { status: 429, body: { ok: false, error: { code: error.code, message: error.message } } };
          // The short window is a pause rather than a refusal, so the answer says
          // when the oldest request in the window ages out and frees the tokens.
          if (error?.code === 'WINDOW_EXCEEDED') {
            const seconds = Math.max(60, Math.floor(Number(error.retryAfterSeconds) || 300));
            return {
              status: 429,
              headers: { 'retry-after': String(seconds) },
              body: { ok: false, error: { code: error.code, message: error.message, retryAfterSeconds: seconds } },
            };
          }
          if (error?.code === 'PROVIDER_REQUEST_FAILED' || error?.code === 'PROVIDER_RESPONSE_INVALID') return { status: 502, body: { ok: false, error: { code: error.code, message: error.message } } };
          return { status: 500, body: { ok: false, error: { code: 'CHAT_FAILED', message: 'The chat request could not be completed.' } } };
        };

        try {
          // Reserve the full allowed request envelope, weighted for the model.
          // This is conservative, but prevents tokenizer differences from
          // overspending the quota. It happens before any streaming starts, so an
          // over-quota account is told plainly instead of watching a partial reply
          // that will never be billed.
          reservation = await dependencies.repository.reserveUsage({
            userId: session.user.id,
            subscriptionId: session.subscription.id,
            requestedTokens: quotaTokens(zuriModel, limits.maxInputTokens, limits.maxOutputTokens),
            expiresAt: new Date(now().getTime() + RESERVATION_TTL_MS),
          });
        } catch (error) {
          releaseLease();
          const mapped = failureFor(error);
          // A quota refusal is an answer, not a fault, so it is not logged as one.
          if (mapped.status !== 429) console.error('[zuri-cloud] reserve usage', error?.message ?? error);
          return response(mapped.status, mapped.body, mapped.headers);
        }

        // A request that offers tools is answered whole, not streamed. The point of
        // such a round is the calls, not the words, and the app has to run them and
        // come back: streaming halfway through a tool loop only delays the decision.
        if (offeredTools.data.length > 0) {
          try {
            const result = await dependencies.chatProvider({
              messages: messages.data,
              model: zuriModel.supplierModel,
              supplier: zuriModel.supplier,
              maxTokens: limits.maxOutputTokens,
              signal: AbortSignal.timeout(120_000),
              tools: offeredTools.data,
            });
            // The round is charged whether or not it also produced text: the tokens
            // were spent either way, and a loop that only billed the last round would
            // be free for anyone willing to call tools.
            await commitReply(result);
            releaseLease();
            return response(200, {
              ok: true,
              data: {
                requestId,
                model: zuriModel.code,
                modelName: zuriModel.name,
                content: result.content,
                toolCalls: Array.isArray(result.toolCalls) ? result.toolCalls : [],
                usage: result.usage,
              },
            });
          } catch (error) {
            if (reservation?.id) await dependencies.repository.releaseUsage(reservation.id, session.user.id).catch((releaseError) => console.error('[zuri-cloud] release usage', releaseError?.message ?? releaseError));
            const mapped = failureFor(error);
            if (mapped.status === 500) console.error('[zuri-cloud] chat', error?.message ?? error);
            return response(mapped.status, mapped.body);
          } finally {
            releaseLease();
          }
        }

        // A streamed reply is what the desktop app asks for, so the answer appears
        // word by word instead of after a long silence. The body is server-sent
        // events: `delta` as the text arrives, then one `done` carrying the saved
        // message and its usage, or one `error` and nothing more.
        if (body.stream === true) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              let closed = false;
              const send = (event) => {
                if (closed) return;
                try {
                  controller.enqueue(encoder.encode(`data: ${json(event)}\n\n`));
                } catch {
                  // The window closed or the connection dropped, which is the
                  // person pressing Stop or losing the network. Stop writing.
                  closed = true;
                }
              };
              try {
                const result = await dependencies.chatProvider({
                  messages: messages.data,
                  model: zuriModel.supplierModel,
                  supplier: zuriModel.supplier,
                  maxTokens: limits.maxOutputTokens,
                  signal: AbortSignal.timeout(120_000),
                  onDelta: (text) => send({ type: 'delta', text }),
                });
                await commitReply(result);
                // The supplier's model name stays server-side; customers see the
                // Zuri name.
                send({ type: 'done', data: { requestId, model: zuriModel.code, modelName: zuriModel.name, content: result.content, usage: result.usage } });
              } catch (error) {
                // Nothing reached the person, so the plan is not charged for it.
                if (reservation?.id) await dependencies.repository.releaseUsage(reservation.id, session.user.id).catch((releaseError) => console.error('[zuri-cloud] release usage', releaseError?.message ?? releaseError));
                const mapped = failureFor(error);
                if (mapped.status === 500) console.error('[zuri-cloud] chat', error?.message ?? error);
                send({ type: 'error', error: mapped.body.error });
              } finally {
                releaseLease();
                if (!closed) {
                  closed = true;
                  try {
                    controller.close();
                  } catch {
                    // Already closed by the reader going away.
                  }
                }
              }
            },
          });
          return new Response(stream, {
            status: 200,
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-store',
              // A proxy that buffers would hold every delta until the reply was
              // finished, which is the exact delay streaming exists to remove.
              'x-accel-buffering': 'no',
            },
          });
        }

        try {
          const result = await dependencies.chatProvider({ messages: messages.data, model: zuriModel.supplierModel, supplier: zuriModel.supplier, maxTokens: limits.maxOutputTokens, signal: AbortSignal.timeout(120_000) });
          await commitReply(result);
          // The supplier's model name stays server-side; customers see the Zuri name.
          return response(200, { ok: true, data: { requestId, model: zuriModel.code, modelName: zuriModel.name, content: result.content, usage: result.usage } });
        } catch (error) {
          if (reservation?.id) await dependencies.repository.releaseUsage(reservation.id, session.user.id).catch((releaseError) => console.error('[zuri-cloud] release usage', releaseError?.message ?? releaseError));
          const mapped = failureFor(error);
          if (mapped.status === 500) console.error('[zuri-cloud] chat', error?.message ?? error);
          return response(mapped.status, mapped.body);
        } finally {
          releaseLease();
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
        if (!plan) return response(400, { ok: false, error: { code: 'INVALID_PLAN', message: 'Choose a valid plan to start checkout.' } });
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

    // One-off purchase of extra tokens. Deliberately not a subscription: the
    // customer stays on the same plan and the pack adds to the allowance until
    // it expires, so nothing about their monthly billing changes.
    if (request.method === 'POST' && url.pathname === '/api/billing/topup') {
      if (!dependencies.auth || !dependencies.repository?.createPayment || !dependencies.repository?.markPaymentFailed || !dependencies.paystack) {
        return response(503, { ok: false, error: { code: 'BILLING_NOT_CONFIGURED', message: 'Paystack billing is not configured yet.' } });
      }
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      if (!hasPaidSubscription(session)) return response(402, { ok: false, error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Choose a paid plan before buying extra usage.' } });
      try {
        const body = await readJson(request);
        const pack = findTopupPack(body.packCode);
        if (!pack) return response(400, { ok: false, error: { code: 'INVALID_PACK', message: 'Choose a valid extra-usage pack to start checkout.' } });
        const reference = 'zuri-topup-' + randomUUID();
        // The amount and the token count are both taken from the server catalogue,
        // never from the request, so a client cannot buy more than it pays for.
        await dependencies.repository.createPayment({
          userId: session.user.id,
          reference,
          amountKobo: pack.amountKobo,
          kind: 'topup',
          packCode: pack.code,
          tokensGranted: pack.tokens,
        });
        try {
          const checkout = await dependencies.paystack.initializeTransaction({
            email: session.user.email,
            amountKobo: pack.amountKobo,
            reference,
            callbackUrl: dependencies.paystackCallbackUrl,
          });
          return response(200, { ok: true, data: { reference, pack: publicTopupPack(pack), authorizationUrl: checkout.authorization_url, accessCode: checkout.access_code } });
        } catch (error) {
          await dependencies.repository.markPaymentFailed(reference, { code: error?.code ?? 'PAYSTACK_REQUEST_FAILED' }).catch((markError) => console.error('[zuri-cloud] mark payment failed', markError?.message ?? markError));
          throw error;
        }
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        if (error?.code === 'PAYSTACK_REQUEST_FAILED') return response(502, { ok: false, error: { code: error.code, message: error.message } });
        console.error('[zuri-cloud] topup checkout', error?.message ?? error);
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

    if (url.pathname === '/api/models' || url.pathname === '/api/admin/overview' || url.pathname === '/api/admin/models') {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured yet.' } });
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });

      if (url.pathname === '/api/models') {
        if (request.method !== 'GET') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' } });
        if (!hasPaidSubscription(session)) return response(402, { ok: false, error: { code: 'SUBSCRIPTION_REQUIRED', message: 'Choose a paid plan to view available models.' } });
        const catalogue = (await loadModels(dependencies)).filter((model) => model.isActive);
        return response(200, { ok: true, data: catalogue.map((model) => publicModel(model, session.subscription.planCode)) });
      }

      if (session.user.isAdmin !== true) return response(403, { ok: false, error: { code: 'ADMIN_ONLY', message: 'This area is for Zuri administrators.' } });
      const nairaPerUsd = Number(dependencies.nairaPerUsd) > 0 ? Number(dependencies.nairaPerUsd) : DEFAULT_NAIRA_PER_USD;

      if (url.pathname === '/api/admin/models') {
        if (request.method !== 'PUT' || typeof dependencies.repository?.saveModel !== 'function') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use PUT to save a model.' } });
        try {
          const checked = validateModelInput(await readJson(request));
          if (!checked.ok) return response(400, { ok: false, error: { code: 'INVALID_MODEL', message: checked.message } });
          return response(200, { ok: true, data: await dependencies.repository.saveModel(checked.model) });
        } catch (error) {
          if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
          throw error;
        }
      }

      if (request.method !== 'GET' || typeof dependencies.repository?.adminOverview !== 'function') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for the overview.' } });
      const overview = await dependencies.repository.adminOverview(url.searchParams.get('days'));
      const catalogue = await loadModels(dependencies);

      // Each picture is priced on the plan that sells it first. Quoting every
      // image model at the Starter rate would misreport the margin of one that
      // only Max subscribers can buy.
      const models = catalogue.map((model) => {
        if (!isImageModel(model)) return { ...model, supplierCostKoboPerImage: 0, priceKoboPerImage: 0, pricePlanCode: '', pricePlanName: '' };
        const plan = findPlan(model.minPlan);
        return {
          ...model,
          supplierCostKoboPerImage: microUsdToKobo(imageSupplierCostMicroUsd(model), nairaPerUsd),
          priceKoboPerImage: plan ? imagePriceKobo(model, plan) : 0,
          pricePlanCode: plan?.code ?? '',
          pricePlanName: plan?.name ?? '',
        };
      });
      const spendByModel = overview.byModel.map((row) => ({ ...row, costKobo: microUsdToKobo(row.costMicroUsd, nairaPerUsd) }));
      const costKobo = spendByModel.reduce((sum, row) => sum + row.costKobo, 0);
      return response(200, {
        ok: true,
        data: {
          days: overview.days,
          nairaPerUsd,
          users: overview.users,
          revenueKobo: overview.revenueKobo,
          costKobo,
          marginKobo: overview.revenueKobo - costKobo,
          models,
          spendByModel,
          plans: overview.plans.map((plan) => ({ ...plan, limits: PLAN_LIMITS[plan.code] ?? null })),
        },
      });
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
            usage: usageStatus(session.subscription, usage.usedTokens, usageOptions(usage)),
          },
        });
      }
      return response(200, { ok: true, data: usageStatus(session.subscription, usage.usedTokens, usageOptions(usage)) });
    }

    // Saved chat history for the web, desktop and Android clients. It sits behind no
    // plan: every signed-in account keeps a history, and the caps below only bound its
    // size rather than pricing it.
    //
    // The conversation id in the path is never the lookup key on its own: every query
    // also carries the signed-in user's id, and a thread that belongs to somebody else
    // answers exactly like a missing one, so ids cannot be probed from one account to
    // the next.
    if (url.pathname === CONVERSATIONS_PATH || url.pathname.startsWith(`${CONVERSATIONS_PATH}/`)) {
      if (!dependencies.auth) return response(503, { ok: false, error: { code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured yet.' } });
      const token = bearerToken(request);
      const session = await dependencies.auth.authenticate(token);
      if (!session) return response(401, { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } }, { 'www-authenticate': 'Bearer' });
      if (!dependencies.repository?.listConversations) return response(503, { ok: false, error: { code: 'HISTORY_NOT_CONFIGURED', message: 'Chat history is not configured yet.' } });

      const userId = session.user.id;
      const [conversationId, ...remainder] = url.pathname.slice(CONVERSATIONS_PATH.length).split('/').filter(Boolean);
      const isMessagesPath = remainder.length === 1 && remainder[0] === 'messages';

      try {
        if (!conversationId) {
          if (request.method === 'GET') {
            return response(200, { ok: true, data: { conversations: await dependencies.repository.listConversations(userId) } });
          }
          if (request.method === 'POST') {
            const body = await readJson(request);
            const conversation = await dependencies.repository.createConversation({
              userId,
              title: conversationTitle(body.title, CONVERSATION_DEFAULT_TITLE),
              model: conversationModel(body.model),
              origin: conversationOrigin(body.origin),
            });
            return response(200, { ok: true, data: { conversation } });
          }
          return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST for the conversation list.' } });
        }

        if (remainder.length === 0) {
          if (request.method === 'GET') {
            const found = await dependencies.repository.getConversation(userId, conversationId);
            if (!found) return response(404, { ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That conversation does not exist.' } });
            return response(200, { ok: true, data: found });
          }
          if (request.method === 'PATCH') {
            const body = await readJson(request);
            // A blank title is refused rather than quietly replaced with a default,
            // because a rename to nothing is almost always an unfinished form.
            const title = conversationTitle(body.title, '');
            if (title === '') {
              return response(400, { ok: false, error: { code: 'INVALID_MESSAGE', message: `Give the conversation a title of 1 to ${CONVERSATION_TITLE_MAX_LENGTH} characters.` } });
            }
            const conversation = await dependencies.repository.renameConversation(userId, conversationId, title);
            if (!conversation) return response(404, { ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That conversation does not exist.' } });
            return response(200, { ok: true, data: { conversation } });
          }
          if (request.method === 'DELETE') {
            const deleted = await dependencies.repository.deleteConversation(userId, conversationId);
            if (!deleted) return response(404, { ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That conversation does not exist.' } });
            return response(200, { ok: true, data: { deleted: true } });
          }
          return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET, PATCH or DELETE for a conversation.' } });
        }

        if (isMessagesPath) {
          if (request.method !== 'POST') return response(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to add a message.' } });
          const body = await readJson(request, MAX_MESSAGE_BODY_BYTES);
          const checked = checkedMessage(body);
          if (!checked.ok) return response(400, { ok: false, error: { code: checked.code, message: checked.message } });
          const appended = await dependencies.repository.appendMessage({ userId, conversationId, role: checked.role, content: checked.content });
          if (!appended) return response(404, { ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That conversation does not exist.' } });
          return response(200, { ok: true, data: appended });
        }

        return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
      } catch (error) {
        if (error?.code === 'BODY_TOO_LARGE' || error?.code === 'INVALID_JSON') return response(400, { ok: false, error: { code: error.code, message: error.message } });
        const refused = conversationErrorResponse(error);
        if (refused) return refused;
        console.error('[zuri-cloud] conversations', error?.message ?? error);
        return response(500, { ok: false, error: { code: 'HISTORY_FAILED', message: 'That conversation could not be saved.' } });
      }
    }

    return response(404, { ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } });
  };

  return async function corsApp(request) {
    const origin = request.headers.get('origin') ?? '';
    if (!corsOrigins.has(origin)) return handle(request);

    const corsHeaders = {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const result = await handle(request);
    const headers = new Headers(result.headers);
    for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  };
}

/** @param {Request} request @param {object} [dependencies] @returns {Promise<Response>} */
export async function handleRequest(request, dependencies = {}) {
  return createApp(dependencies)(request);
}
