import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const SESSION_COOKIE = 'zuri_session';
export const OAUTH_STATE_COOKIE = 'zuri_oauth_state';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

export function normalizeGoogleProfile(payload) {
  const googleSubject = text(payload?.sub);
  const email = text(payload?.email).toLowerCase();
  const displayName = text(payload?.name).slice(0, 200);
  if (googleSubject === '' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || payload?.email_verified !== true) return null;
  return { googleSubject, email, displayName };
}

export function createGoogleVerifier(clientId, client = new OAuth2Client(clientId)) {
  if (typeof clientId !== 'string' || clientId.trim() === '') throw new Error('GOOGLE_CLIENT_ID is required for Google sign-in.');
  return async (credential) => {
    if (typeof credential !== 'string' || credential.trim() === '') throw new Error('Google credential is required.');
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const profile = normalizeGoogleProfile(ticket.getPayload());
    if (!profile) throw new Error('Google did not return a verified email identity.');
    return profile;
  };
}

export function hashSessionToken(token) { return createHash('sha256').update(token, 'utf8').digest('hex'); }

export function createSession(now = new Date(), random = () => randomBytes(32)) {
  const token = random().toString('base64url');
  return { token, tokenHash: hashSessionToken(token), expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
}

export function createAuthService({ repository, verifyGoogleCredential, now = () => new Date(), random }) {
  if (!repository || typeof repository.findOrCreateGoogleUser !== 'function') throw new Error('An auth repository is required.');
  if (typeof verifyGoogleCredential !== 'function') throw new Error('A Google verifier is required.');
  return {
    async signInWithGoogle(credential) {
      const profile = await verifyGoogleCredential(credential);
      const user = await repository.findOrCreateGoogleUser(profile);
      if (user.status !== 'active') {
        const error = new Error('This account is not active.');
        error.code = 'ACCOUNT_NOT_ACTIVE';
        throw error;
      }
      const session = createSession(now(), random);
      await repository.createSession(user.id, session.tokenHash, session.expiresAt);
      return { token: session.token, expiresAt: session.expiresAt.toISOString(), user };
    },
    authenticate(token) {
      if (typeof token !== 'string' || token.trim() === '') return null;
      return repository.findSessionUser(hashSessionToken(token));
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
  return result?.user?.status === 'active' ? result : null;
}

export async function revokeAuthenticatedSession({ authStore, request }) {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (token) await authStore.revokeSession(hashSessionToken(token));
}
