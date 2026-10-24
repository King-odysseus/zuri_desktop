import assert from 'node:assert/strict';
import { handleRequest, createApp } from '../src/app.js';
import { canConsume, usageStatus } from '../src/usage.js';
import { createAuthService, hashSessionToken } from '../src/auth.js';

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');
const health = await handleRequest(new Request('https://cloud.example.com/api/health'), { now: fixedNow });
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: 'zuri-cloud', time: '2026-10-24T12:00:00.000Z' });
const plans = await handleRequest(new Request('https://cloud.example.com/api/plans'));
assert.equal(plans.status, 200);
assert.deepEqual((await plans.json()).data.map((plan) => plan.code), ['free', 'starter', 'pro', 'power']);
assert.equal((await handleRequest(new Request('https://cloud.example.com/api/unknown'))).status, 404);
const usage = usageStatus({ code: 'starter', monthlyTokens: 2_000_000 }, 1_650_001);
assert.deepEqual(usage, { planCode: 'starter', monthlyTokens: 2_000_000, usedTokens: 1_650_001, remainingTokens: 349_999, percentUsed: 83, overQuota: false, nearLimit: true });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 349_999), { allowed: true, reason: 'ok' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 350_000), { allowed: false, reason: 'quota_exceeded' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 'bad'), { allowed: false, reason: 'invalid_tokens' });

const user = { id: 'user-1', email: 'user@example.com', status: 'active' };
const sessions = new Map();
const repository = {
  async findOrCreateGoogleUser() { return user; },
  async createSession(userId, tokenHash, expiresAt) { sessions.set(tokenHash, { userId, expiresAt }); },
  async findSessionUser(tokenHash) { const session = sessions.get(tokenHash); return session ? { user, subscription: { planCode: 'free', monthlyTokens: 1000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z') } } : null; },
  async getUsage() { return { usedTokens: 125 }; },
  async revokeSession(tokenHash) { sessions.delete(tokenHash); },
};
const auth = createAuthService({ repository, verifyGoogleCredential: async () => ({ googleSubject: 'google-1', email: user.email, displayName: 'User' }), now: fixedNow, random: () => Buffer.from('session-token') });
const signedIn = await auth.signInWithGoogle('credential');
assert.equal(signedIn.user.id, user.id);
assert.ok(sessions.has(hashSessionToken(signedIn.token)));
const app = createApp({ auth, repository, now: fixedNow });
const googleRoute = await app(new Request('https://cloud.example.com/api/auth/google', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ credential: 'google-credential' }),
}));
assert.equal(googleRoute.status, 200);
assert.equal((await googleRoute.json()).data.user.id, user.id);
const me = await app(new Request('https://cloud.example.com/api/me', { headers: { authorization: `Bearer ${signedIn.token}` } }));
assert.equal(me.status, 200);
assert.equal((await me.json()).data.user.id, user.id);
const unauthorized = await app(new Request('https://cloud.example.com/api/me'));
assert.equal(unauthorized.status, 401);
const signedOut = await app(new Request('https://cloud.example.com/api/auth/sign-out', { method: 'POST', headers: { authorization: `Bearer ${signedIn.token}` } }));
assert.equal(signedOut.status, 200);
assert.equal((await app(new Request('https://cloud.example.com/api/me', { headers: { authorization: `Bearer ${signedIn.token}` } }))).status, 401);

console.log('PASS server contract');
