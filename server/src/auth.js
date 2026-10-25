import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const SESSION_COOKIE = 'zuri_session';
export const OAUTH_STATE_COOKIE = 'zuri_oauth_state';
// Idle rule: a session stays alive while it is used and dies after three quiet days.
export const SESSION_IDLE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = SESSION_IDLE_TTL_MS;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
// The web app's reset screen; the mailed link points at it.
export const RESET_PATH = '/reset-password';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

/** @param {string} code @param {string} message @returns {Error} */
function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// One message for both a missing account and a wrong password: the caller must
// never be able to tell which of the two it got wrong.
function invalidCredentials() { return failure('INVALID_CREDENTIALS', 'The email address or password is not correct.'); }

export function normalizeGoogleProfile(payload) {
  const googleSubject = text(payload?.sub);
  const email = text(payload?.email).toLowerCase();
  const displayName = text(payload?.name).slice(0, 200);
  if (googleSubject === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || payload?.email_verified !== true) return null;
  return { googleSubject, email, displayName };
}

// Google sign-in is one optional provider. Loading its package on first use keeps
// a password-only deployment, and the test suite, free of the dependency.
async function googleClient(clientId) {
  let google;
  try {
    google = await import('google-auth-library');
  } catch (error) {
    throw new Error(`Google sign-in needs the google-auth-library package installed: ${error.message}`);
  }
  // Dual published, so the class can arrive as a named or a default export.
  const Client = google.OAuth2Client ?? google.default?.OAuth2Client;
  if (typeof Client !== 'function') throw new Error('The google-auth-library package did not export OAuth2Client.');
  return new Client(clientId);
}

export function createGoogleVerifier(clientId, client) {
  if (typeof clientId !== 'string' || clientId.trim() === '') throw new Error('GOOGLE_CLIENT_ID is required for Google sign-in.');
  let verifier = client ?? null;
  return async (credential) => {
    if (typeof credential !== 'string' || credential.trim() === '') throw new Error('Google credential is required.');
    verifier ??= await googleClient(clientId);
    const ticket = await verifier.verifyIdToken({ idToken: credential, audience: clientId });
    const profile = normalizeGoogleProfile(ticket.getPayload());
    if (!profile) throw new Error('Google did not return a verified email identity.');
    return profile;
  };
}

export function hashSessionToken(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }

export function createSession(now = new Date(), random = () => randomBytes(32)) {
  const token = random().toString('base64url');
  return { token, tokenHash: hashSessionToken(token), expiresAt: sessionExpiryFrom(now) };
}

/** @param {Date} now @returns {Date} */
export function sessionExpiryFrom(now) { return new Date(now.getTime() + SESSION_TTL_MS); }

/**
 * Both halves of the session rule in one place: recent enough to still count as
 * activity, and not past the expiry the last call pushed out.
 * @param {{ lastUsedAt?: Date | string, expiresAt?: Date | string } | null | undefined} session
 * @param {Date} [now]
 * @returns {boolean}
 */
export function sessionIsFresh(session, now = new Date()) {
  const lastUsed = session?.lastUsedAt ? new Date(session.lastUsedAt).getTime() : NaN;
  const expires = session?.expiresAt ? new Date(session.expiresAt).getTime() : NaN;
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(lastUsed) || !Number.isFinite(expires) || !Number.isFinite(at)) return false;
  return at - lastUsed <= SESSION_IDLE_TTL_MS && expires > at;
}

/** @param {unknown} value @returns {string} An email ready to store, or '' when it is not one. */
export function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  if (email.length > 254) return '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

/** @param {unknown} password @returns {{ ok: true } | { ok: false, message: string }} */
export function validatePassword(password) {
  const message = `Use a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`;
  if (typeof password !== 'string') return { ok: false, message };
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return { ok: false, message };
  if (password.trim() === '') return { ok: false, message };
  return { ok: true };
}

/** @param {unknown} password */
function assertPassword(password) {
  const result = validatePassword(password);
  if (!result.ok) throw failure('INVALID_PASSWORD', result.message);
}

const scryptAsync = promisify(scrypt);
// The cost parameters travel inside the stored string, so they can be raised
// later while every hash written by this version still verifies.
const SCRYPT_COST = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 64 });

/**
 * @param {string} password
 * @param {Buffer} [salt]
 * @returns {Promise<string>} scrypt$N$r$p$salt$hash, base64url encoded.
 */
export async function hashPassword(password, salt = randomBytes(16)) {
  const { N, r, p, keyLength } = SCRYPT_COST;
  const derived = await scryptAsync(password, salt, keyLength, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>} false for a malformed row as well as a wrong password.
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (salt.length < 8 || expected.length < 16) return false;
  // A tampered row must not be able to ask for unbounded memory.
  if (N < 1024 || N > 1 << 17 || r < 1 || r > 16 || p < 1 || p > 8) return false;
  const derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** @param {string} token @returns {string} */
export function hashResetToken(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }

/**
 * @param {Date} now
 * @param {() => Buffer} [random]
 * @returns {{ token: string, tokenHash: string, expiresAt: Date }}
 */
export function createResetToken(now = new Date(), random = () => randomBytes(32)) {
  const token = random().toString('base64url');
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS) };
}

/** @param {string} siteUrl @param {string} token @returns {string} */
export function resetLink(siteUrl, token) {
  const base = text(siteUrl).replace(/\/+$/, '');
  return `${base}${RESET_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * @param {{
 *   repository: object,
 *   verifyGoogleCredential?: ((credential: string) => Promise<object>) | null,
 *   now?: () => Date,
 *   random?: () => Buffer,
 * }} options
 */
export function createAuthService({ repository, verifyGoogleCredential = null, now = () => new Date(), random }) {
  if (!repository || typeof repository.createSession !== 'function' || typeof repository.findSessionUser !== 'function') {
    throw new Error('An auth repository is required.');
  }
  if (verifyGoogleCredential !== null && typeof verifyGoogleCredential !== 'function') throw new Error('A Google verifier must be a function.');

  const clock = () => {
    const at = now();
    return at instanceof Date ? at : new Date(at);
  };

  /** Validates, hashes and stores: the one place a plain password becomes a row. */
  async function storePassword(userId, password) {
    assertPassword(password);
    await repository.updatePasswordHash(userId, await hashPassword(password));
  }

  /** @param {{ id: string, status: string }} user */
  async function startSession(user) {
    if (user.status !== 'active') throw failure('ACCOUNT_NOT_ACTIVE', 'This account is not active.');
    const session = createSession(clock(), random);
    await repository.createSession(user.id, session.tokenHash, session.expiresAt);
    return { token: session.token, expiresAt: session.expiresAt.toISOString(), user };
  }

  return {
    async signInWithGoogle(credential) {
      // Password accounts need no Google client, so a missing verifier is a
      // deployment state, not a broken request.
      if (!verifyGoogleCredential || typeof repository.findOrCreateGoogleUser !== 'function') {
        throw failure('AUTH_NOT_CONFIGURED', 'Google sign-in is not configured.');
      }
      const profile = await verifyGoogleCredential(credential);
      const user = await repository.findOrCreateGoogleUser(profile);
      return startSession(user);
    },
    async signUpWithPassword({ email, password, displayName } = {}) {
      const address = normalizeEmail(email);
      if (address === '') throw failure('INVALID_EMAIL', 'Enter a valid email address.');
      assertPassword(password);
      // Hash before the insert so a taken address cannot be spotted by its speed.
      const passwordHash = await hashPassword(password);
      const user = await repository.createUserWithPassword({ email: address, passwordHash, displayName: text(displayName).slice(0, 200) });
      return startSession(user);
    },
    async signInWithPassword({ email, password } = {}) {
      const address = normalizeEmail(email);
      const secret = typeof password === 'string' ? password : '';
      if (address === '' || secret === '') throw invalidCredentials();
      const record = await repository.findUserByEmail(address);
      if (!record) {
        // Pay the same scrypt cost as a real attempt so a missing account does not
        // answer faster than a wrong password.
        await hashPassword(secret);
        throw invalidCredentials();
      }
      if (text(record.passwordHash) === '') {
        throw failure('PASSWORD_NOT_SET', 'This account signs in with Google. Use Google sign-in, or reset the password to add one.');
      }
      if (!(await verifyPassword(secret, record.passwordHash))) throw invalidCredentials();
      return startSession(record.user);
    },
    async setPassword({ userId, password } = {}) {
      if (typeof userId !== 'string' || userId.trim() === '') throw failure('INVALID_USER', 'A user is required.');
      await storePassword(userId, password);
      return { updated: true };
    },
    async requestPasswordReset({ email, siteUrl = '' } = {}) {
      const address = normalizeEmail(email);
      if (address === '') throw failure('INVALID_EMAIL', 'Enter a valid email address.');
      const record = await repository.findUserByEmail(address);
      // An unknown or inactive account answers exactly like a real one, so the
      // endpoint cannot be used to find out who has an account.
      if (!record || record.user.status !== 'active') return { sent: true, delivery: null };
      const reset = createResetToken(clock(), random);
      await repository.createPasswordReset({ userId: record.user.id, tokenHash: reset.tokenHash, expiresAt: reset.expiresAt });
      return { sent: true, delivery: { to: record.user.email, link: resetLink(siteUrl, reset.token) } };
    },
    async resetPassword({ token, password } = {}) {
      const secret = typeof token === 'string' ? token.trim() : '';
      if (secret === '') throw failure('INVALID_RESET_TOKEN', 'That reset link is no longer valid. Ask for a new one.');
      // The password rules are checked before the token is spent, so a rejected
      // password never leaves the person with a dead link.
      assertPassword(password);
      const userId = await repository.consumePasswordReset(hashResetToken(secret));
      if (!userId) throw failure('INVALID_RESET_TOKEN', 'That reset link is no longer valid. Ask for a new one.');
      await storePassword(userId, password);
      await repository.revokeUserSessions(userId);
      return { reset: true, sessionsRevoked: true };
    },
    async authenticate(token) {
      const secret = typeof token === 'string' ? token.trim() : '';
      if (secret === '') return null;
      const at = clock();
      const record = await repository.findSessionUser(hashSessionToken(secret), { now: at, idleTtlMs: SESSION_IDLE_TTL_MS });
      // The repository drops an idle row in SQL; checking here as well keeps the
      // rule true for any repository that forgets to.
      if (!record || !sessionIsFresh(record.session, at)) return null;
      return { user: record.user, subscription: record.subscription };
    },
    signOut(token) {
      if (typeof token !== 'string' || token.trim() === '') return Promise.resolve();
      return repository.revokeSession(hashSessionToken(token));
    },
  };
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    try { cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return cookies;
}

export function cookie(name, value, { maxAge, secure = false } = {}) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (Number.isFinite(maxAge)) attributes.push(`Max-Age=${Math.max(0, Math.trunc(maxAge))}`);
  if (secure) attributes.push('Secure');
  return `${name}=${encodeURIComponent(value)}; ${attributes.join('; ')}`;
}

export function clearCookie(name, secure = false) { return cookie(name, '', { maxAge: 0, secure }); }

export function googleAuthorizationUrl(config, state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: config.googleRedirectUri, response_type: 'code', scope: 'openid email profile', state, access_type: 'online', prompt: 'select_account' });
  return url.toString();
}

export async function verifyGoogleCode({ code, config, fetchImpl = fetch }) {
  const tokenResponse = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret, redirect_uri: config.googleRedirectUri, grant_type: 'authorization_code' }) });
  if (!tokenResponse.ok) throw new Error('Google rejected the sign-in code.');
  const token = await tokenResponse.json();
  if (typeof token?.id_token !== 'string' || token.id_token === '') throw new Error('Google returned no identity token.');
  const profileResponse = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token.id_token)}`);
  if (!profileResponse.ok) throw new Error('Google identity verification failed.');
  const profile = await profileResponse.json();
  if (profile.aud !== config.googleClientId || profile.iss !== 'https://accounts.google.com' || profile.email_verified !== 'true') throw new Error('Google returned an unverified identity.');
  const googleSubject = text(profile.sub);
  const email = text(profile.email).toLowerCase();
  if (googleSubject === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Google returned an incomplete identity.');
  return { googleSubject, email, displayName: text(profile.name).slice(0, 200) };
}

export async function authenticateGoogleCallback({ authStore, config, request, fetchImpl = fetch, now = () => new Date() }) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  const state = text(url.searchParams.get('state'));
  const expectedState = text(cookies[OAUTH_STATE_COOKIE]);
  const code = text(url.searchParams.get('code'));
  if (state === '' || expectedState === '' || state !== expectedState) return { ok: false, error: { code: 'AUTH_STATE_INVALID', message: 'The sign-in session expired. Start again.' } };
  if (code === '') return { ok: false, error: { code: 'AUTH_CODE_MISSING', message: 'Google did not return a sign-in code.' } };
  const identity = await verifyGoogleCode({ code, config, fetchImpl });
  const user = await authStore.findOrCreateGoogleUser(identity);
  if (user?.status !== 'active') return { ok: false, error: { code: 'ACCOUNT_NOT_ACTIVE', message: 'This account is not active.' } };
  const session = createSession(now());
  await authStore.createSession(user.id, session.tokenHash, session.expiresAt);
  const secure = config.nodeEnv === 'production';
  return { ok: true, user, sessionCookie: cookie(SESSION_COOKIE, session.token, { maxAge: SESSION_TTL_MS / 1000, secure }), stateCookie: clearCookie(OAUTH_STATE_COOKIE, secure) };
}

export async function getAuthenticatedUser({ authStore, request }) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) return null;
  const result = await authStore.findSessionUser(hashSessionToken(token));
  // The idle rule lives in the lookup; the raw session stamps stay internal, so
  // callers only ever see the user and their subscription.
  if (!result || result.user?.status !== 'active') return null;
  return { user: result.user, subscription: result.subscription };
}

export async function revokeAuthenticatedSession({ authStore, request }) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (token) await authStore.revokeSession(hashSessionToken(token));
}

/**
 * Create or promote the administrator named by ADMIN_EMAIL.
 *
 * Called once at boot so a deployment needs no SQL console. It is idempotent: the
 * account is created the first time and promoted on every later boot. The password
 * only ever travels as a scrypt hash, and an empty ADMIN_PASSWORD leaves whatever
 * hash the row already holds, so removing the variable cannot lock out an
 * administrator who signs in with Google.
 *
 * Returned messages name the variable but never repeat its value, because they end
 * up in the deploy log.
 * @param {{ repository?: object, email?: string, password?: string }} [options]
 * @returns {Promise<{ skipped: string } | { created: boolean, user: object, passwordSet: boolean }>}
 */
export async function provisionAdminAccount({ repository, email, password } = {}) {
  const address = normalizeEmail(email);
  if (address === '') return { skipped: 'ADMIN_EMAIL is not a valid email address.' };
  if (!repository || typeof repository.ensureAdminAccount !== 'function') {
    return { skipped: 'this database cannot store an administrator.' };
  }
  const secret = typeof password === 'string' ? password : '';
  if (secret !== '') {
    const check = validatePassword(secret);
    if (!check.ok) return { skipped: 'ADMIN_PASSWORD is unusable: ' + check.message };
  }
  const canLookUp = typeof repository.findUserByEmail === 'function';
  const existing = canLookUp ? await repository.findUserByEmail(address) : null;
  const passwordHash = secret === '' ? '' : await hashPassword(secret);
  const user = await repository.ensureAdminAccount({ email: address, passwordHash });
  return {
    created: canLookUp ? existing === null : false,
    user,
    passwordSet: passwordHash !== '' || (existing?.passwordHash ?? '') !== '',
  };
}
