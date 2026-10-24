import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleRequest, createApp } from '../src/app.js';
import { canConsume, usageStatus } from '../src/usage.js';
import { createAuthService, hashSessionToken, normalizeGoogleProfile } from '../src/auth.js';
import { createRequestLimiter, limitsForPlan } from '../src/limits.js';
import { verifyPaystackSignature } from '../src/paystack.js';

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');
const health = await handleRequest(new Request('https://cloud.example.com/api/health'), { now: fixedNow });
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: 'zuri-cloud', time: '2026-10-24T12:00:00.000Z' });
const plans = await handleRequest(new Request('https://cloud.example.com/api/plans'));
assert.equal(plans.status, 200);
assert.deepEqual((await plans.json()).data.map((plan) => plan.code), ['free', 'starter', 'pro', 'power']);
const publicConfig = await handleRequest(new Request('https://cloud.example.com/api/public-config'), { googleClientId: 'client-id' });
assert.deepEqual(await publicConfig.json(), { ok: true, data: { googleClientId: 'client-id' } });
assert.equal((await handleRequest(new Request('https://cloud.example.com/api/unknown'))).status, 404);
const usage = usageStatus({ code: 'starter', monthlyTokens: 2_000_000 }, 1_650_001);
assert.deepEqual(usage, { planCode: 'starter', monthlyTokens: 2_000_000, usedTokens: 1_650_001, remainingTokens: 349_999, percentUsed: 83, overQuota: false, nearLimit: true });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 349_999), { allowed: true, reason: 'ok' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 350_000), { allowed: false, reason: 'quota_exceeded' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 'bad'), { allowed: false, reason: 'invalid_tokens' });
assert.deepEqual(limitsForPlan('free'), { requestsPerMinute: 10, maxConcurrent: 1, maxInputTokens: 8_000, maxOutputTokens: 1_000 });
assert.equal(limitsForPlan('unknown').requestsPerMinute, 10);
let clock = 0;
const limiter = createRequestLimiter({ now: () => clock });
const first = limiter.acquire('user-1', limitsForPlan('free'));
assert.equal(first.allowed, true);
assert.equal(limiter.acquire('user-1', limitsForPlan('free')).reason, 'concurrency_limit');
first.release();
for (let index = 1; index < 10; index += 1) {
  const request = limiter.acquire('user-1', limitsForPlan('free'));
  assert.equal(request.allowed, true);
  request.release();
}
assert.equal(limiter.acquire('user-1', limitsForPlan('free')).reason, 'rate_limit');
clock = 60_000;
assert.equal(limiter.acquire('user-1', limitsForPlan('free')).allowed, true);
const webhookSecret = 'paystack-test-secret';
const paystackCalls = [];
const paystack = {
  async initializeTransaction(request) {
    paystackCalls.push(request);
    return { authorization_url: 'https://checkout.paystack.com/test', access_code: 'access-test' };
  },
  async verifyTransaction(reference) {
    return { id: 123, status: 'success', reference, amount: 250_000, currency: 'NGN', customer: { email: user.email }, authorization: { authorization_code: 'AUTH_test' }, subscription_code: 'SUB_test' };
  },
};
assert.equal(verifyPaystackSignature('body', createHmac('sha512', webhookSecret).update('body').digest('hex'), webhookSecret), true);
assert.equal(verifyPaystackSignature('body', 'invalid', webhookSecret), false);
assert.deepEqual(normalizeGoogleProfile({ sub: 'workspace-1', email: 'person@company.example', name: 'Company User', email_verified: true }), {
  googleSubject: 'workspace-1',
  email: 'person@company.example',
  displayName: 'Company User',
});

const user = { id: 'user-1', email: 'user@example.com', status: 'active' };
const sessions = new Map();
const repository = {
  async findOrCreateGoogleUser() { return user; },
  async createSession(userId, tokenHash, expiresAt) { sessions.set(tokenHash, { userId, expiresAt }); },
  async findSessionUser(tokenHash) { const session = sessions.get(tokenHash); return session ? { user, subscription: { id: 'subscription-1', planCode: 'free', monthlyTokens: 1000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z') } } : null; },
  async getUsage() { return { usedTokens: 125 }; },
  async reserveUsage() { return { id: 'reservation-1', reservedTokens: 9000 }; },
  async commitUsage() {},
  async releaseUsage() {},
  async createPayment(details) { return { id: 'payment-1', ...details, status: 'initialized' }; },
  async markPaymentFailed() {},
  async applySuccessfulPayment() { return { applied: true, planCode: 'starter' }; },
  async updateSubscriptionFromPaystack() { return { applied: true }; },
  async getBilling() { return { subscription: { planCode: 'free' }, payments: [] }; },
  async revokeSession(tokenHash) { sessions.delete(tokenHash); },
};
const auth = createAuthService({ repository, verifyGoogleCredential: async () => ({ googleSubject: 'google-1', email: user.email, displayName: 'User' }), now: fixedNow, random: () => Buffer.from('session-token') });
const signedIn = await auth.signInWithGoogle('credential');
assert.equal(signedIn.user.id, user.id);
assert.ok(sessions.has(hashSessionToken(signedIn.token)));
const providerCalls = [];
const app = createApp({
  auth,
  repository,
  now: fixedNow,
  chatProvider: async (request) => {
    providerCalls.push(request);
    return { model: request.model, content: 'Cloud reply', usage: { inputTokens: 12, outputTokens: 8 } };
  },
  paystack,
  paystackSecretKey: webhookSecret,
  paystackPlanCodes: { starter: 'PLN_starter' },
});
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
const limits = await app(new Request('https://cloud.example.com/api/me/limits', { headers: { authorization: `Bearer ${signedIn.token}` } }));
assert.equal(limits.status, 200);
assert.deepEqual((await limits.json()).data.limits, { requestsPerMinute: 10, maxConcurrent: 1, maxInputTokens: 8_000, maxOutputTokens: 1_000 });
const chat = await app(new Request('https://cloud.example.com/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello cloud' }] }),
}));
assert.equal(chat.status, 200);
assert.equal((await chat.json()).data.content, 'Cloud reply');
assert.equal(providerCalls.length, 1);
assert.equal(providerCalls[0].maxTokens, 1000);
const invalidChat = await app(new Request('https://cloud.example.com/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
}));
assert.equal(invalidChat.status, 400);
const checkout = await app(new Request('https://cloud.example.com/api/billing/checkout', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ planCode: 'starter' }),
}));
assert.equal(checkout.status, 200);
assert.equal((await checkout.json()).data.authorizationUrl, 'https://checkout.paystack.com/test');
assert.equal(paystackCalls[0].amountKobo, 250_000);
const verified = await app(new Request('https://cloud.example.com/api/billing/verify?reference=zuri-test-ref'));
assert.equal(verified.status, 200);
const invalidWebhook = await app(new Request('https://cloud.example.com/api/paystack/webhook', {
  method: 'POST',
  headers: { 'x-paystack-signature': 'invalid' },
  body: JSON.stringify({ event: 'charge.success', data: { reference: 'zuri-test-ref' } }),
}));
assert.equal(invalidWebhook.status, 401);
const webhookBody = JSON.stringify({ event: 'subscription.disable', data: { subscription_code: 'SUB_test' } });
const webhook = await app(new Request('https://cloud.example.com/api/paystack/webhook', {
  method: 'POST',
  headers: { 'x-paystack-signature': createHmac('sha512', webhookSecret).update(webhookBody).digest('hex') },
  body: webhookBody,
}));
assert.equal(webhook.status, 200);
const billing = await app(new Request('https://cloud.example.com/api/me/billing', { headers: { authorization: `Bearer ${signedIn.token}` } }));
assert.equal(billing.status, 200);
const quotaApp = createApp({
  auth,
  repository: {
    ...repository,
    async reserveUsage() {
      const error = new Error('This request would exceed the plan quota.');
      error.code = 'QUOTA_EXCEEDED';
      throw error;
    },
  },
  chatProvider: async () => ({ model: 'deepseek-chat', content: 'not reached', usage: { inputTokens: 1, outputTokens: 1 } }),
  now: fixedNow,
});
const quotaResponse = await quotaApp(new Request('https://cloud.example.com/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Over quota' }] }),
}));
assert.equal(quotaResponse.status, 429);
const unauthorized = await app(new Request('https://cloud.example.com/api/me'));
assert.equal(unauthorized.status, 401);
const signedOut = await app(new Request('https://cloud.example.com/api/auth/sign-out', { method: 'POST', headers: { authorization: `Bearer ${signedIn.token}` } }));
assert.equal(signedOut.status, 200);
assert.equal((await app(new Request('https://cloud.example.com/api/me', { headers: { authorization: `Bearer ${signedIn.token}` } }))).status, 401);

console.log('PASS server contract');
