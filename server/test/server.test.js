import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { handleRequest, createApp } from '../src/app.js';
import { createRequestListener } from '../src/serve.js';
import { canConsume, usageStatus } from '../src/usage.js';
import { createAuthService, hashSessionToken, normalizeGoogleProfile, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../src/auth.js';
import { createRequestLimiter, limitsForPlan } from '../src/limits.js';
import { verifyPaystackSignature } from '../src/paystack.js';
import { downloadsFromReleases } from '../src/downloads.js';
import { createMailer } from '../src/mail.js';
import { readConfig } from '../src/config.js';

// A deployed server that was never given SITE_URL must still build a reset link
// that opens. Railway injects its public domain, so that is the last resort; a
// local run stays empty so the link falls back to the request's own origin.
assert.equal(readConfig({ RAILWAY_PUBLIC_DOMAIN: 'zuricloud.example.app' }).siteUrl, 'https://zuricloud.example.app');
assert.equal(readConfig({ SITE_URL: 'https://site.example.com/', RAILWAY_PUBLIC_DOMAIN: 'ignored.example.app' }).siteUrl, 'https://site.example.com');
assert.equal(readConfig({}).siteUrl, '');

// The download list is read from GitHub Releases on the deployed site. Tests must
// not depend on the network or on what has been published, so the repository is
// blanked and only the folder on disk can answer.
process.env.ZURI_RELEASE_REPO = '';

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');
const health = await handleRequest(new Request('https://cloud.example.com/api/health'), { now: fixedNow });
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true, service: 'zuri-cloud', time: '2026-10-24T12:00:00.000Z' });
const plans = await handleRequest(new Request('https://cloud.example.com/api/plans'));
assert.equal(plans.status, 200);
assert.deepEqual((await plans.json()).data.map((plan) => plan.code), ['starter', 'pro', 'power', 'max']);
const publicConfig = await handleRequest(new Request('https://cloud.example.com/api/public-config'), { googleClientId: 'client-id' });
// The site needs to know a password form exists and where to send reset links,
// so both travel with the Google client id.
assert.deepEqual(await publicConfig.json(), { ok: true, data: { googleClientId: 'client-id', passwordSignIn: true, siteUrl: '' } });
assert.equal((await handleRequest(new Request('https://cloud.example.com/api/unknown'))).status, 404);
const androidCors = createApp({ corsOrigins: ['https://localhost'] });
const preflight = await androidCors(new Request('https://cloud.example.com/api/auth/sign-in', {
  method: 'OPTIONS',
  headers: { origin: 'https://localhost' },
}));
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost');
const usage = usageStatus({ code: 'starter', monthlyTokens: 2_000_000 }, 1_650_001);
assert.deepEqual(usage, { planCode: 'starter', monthlyTokens: 2_000_000, usedTokens: 1_650_001, remainingTokens: 349_999, percentUsed: 83, overQuota: false, nearLimit: true });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 349_999), { allowed: true, reason: 'ok' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 350_000), { allowed: false, reason: 'quota_exceeded' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 'bad'), { allowed: false, reason: 'invalid_tokens' });
assert.deepEqual(limitsForPlan('starter'), { requestsPerMinute: 30, maxConcurrent: 2, maxInputTokens: 16_000, maxOutputTokens: 2_000 });
assert.equal(limitsForPlan('unknown').requestsPerMinute, 30);
let clock = 0;
const limiter = createRequestLimiter({ now: () => clock });
const first = limiter.acquire('user-1', limitsForPlan('starter'));
assert.equal(first.allowed, true);
const second = limiter.acquire('user-1', limitsForPlan('starter'));
assert.equal(second.allowed, true);
assert.equal(limiter.acquire('user-1', limitsForPlan('starter')).reason, 'concurrency_limit');
first.release();
second.release();
for (let index = 2; index < 30; index += 1) {
  const request = limiter.acquire('user-1', limitsForPlan('starter'));
  assert.equal(request.allowed, true);
  request.release();
}
assert.equal(limiter.acquire('user-1', limitsForPlan('starter')).reason, 'rate_limit');
clock = 60_000;
assert.equal(limiter.acquire('user-1', limitsForPlan('starter')).allowed, true);
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
  // The idle check reads the session row itself, so the stored record travels
  // back with the user.
  async findSessionUser(tokenHash) { const session = sessions.get(tokenHash); return session ? { user, subscription: { id: 'subscription-1', planCode: 'starter', monthlyTokens: 2_000_000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z') }, session: { expiresAt: session.expiresAt, lastUsedAt: fixedNow(), revoked: false } } : null; },
  async getUsage() { return { usedTokens: 125 }; },
  async reserveUsage() { return { id: 'reservation-1', reservedTokens: 9000 }; },
  async commitUsage() {},
  async releaseUsage() {},
  async createPayment(details) { return { id: 'payment-1', ...details, status: 'initialized' }; },
  async markPaymentFailed() {},
  async applySuccessfulPayment() { return { applied: true, planCode: 'starter' }; },
  async updateSubscriptionFromPaystack() { return { applied: true }; },
  async getBilling() { return { subscription: { planCode: 'starter' }, payments: [] }; },
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
assert.deepEqual((await limits.json()).data.limits, { requestsPerMinute: 30, maxConcurrent: 2, maxInputTokens: 16_000, maxOutputTokens: 2_000 });
const chat = await app(new Request('https://cloud.example.com/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello cloud' }] }),
}));
assert.equal(chat.status, 200);
assert.equal((await chat.json()).data.content, 'Cloud reply');
assert.equal(providerCalls.length, 1);
assert.equal(providerCalls[0].maxTokens, 2000);
const invalidChat = await app(new Request('https://cloud.example.com/api/chat', {
  method: 'POST',
  headers: { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [] }),
}));
assert.equal(invalidChat.status, 400);
{
  const headers = { authorization: `Bearer ${signedIn.token}`, 'content-type': 'application/json' };
  const ask = (model) => app(new Request('https://cloud.example.com/api/chat', { method: 'POST', headers, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }] }) }));
  const calls = providerCalls.length;
  const tooHigh = await ask('zuri-max');
  assert.equal(tooHigh.status, 403, 'a Starter plan cannot use a Max model');
  assert.equal((await tooHigh.json()).error.code, 'PLAN_UPGRADE_REQUIRED');
  assert.equal((await ask('no-such-model')).status, 400);
  assert.equal(providerCalls.length, calls, 'a refused model never reaches a supplier');
  const allowed = await (await ask('zuri-flash')).json();
  assert.equal(allowed.data.model, 'zuri-flash');
  assert.equal(providerCalls.at(-1).supplier, 'deepseek');
  assert.ok(!JSON.stringify(allowed).includes('deepseek'), 'the supplier name never reaches the customer');
  const listed = await (await app(new Request('https://cloud.example.com/api/models', { headers }))).json();
  assert.deepEqual(listed.data.map((model) => [model.code, model.available]), [
    ['zuri-flash', true],
    ['zuri-pro', true],
    ['zuri-max', false],
    ['zuri-code', false],
    ['zuri-reason', false],
    ['zuri-elite', false],
  ]);
  assert.ok(!JSON.stringify(listed).includes('supplier'));
  assert.equal((await app(new Request('https://cloud.example.com/api/admin/overview', { headers }))).status, 403, 'admin pages are admin-only');
  assert.equal((await app(new Request('https://cloud.example.com/api/admin/models', { method: 'PUT', headers, body: '{}' }))).status, 403);
}
{
  const { DEFAULT_MODELS, canUseModel, quotaTokens, supplierCostMicroUsd, microUsdToKobo, limitsForModel, validateModelInput } = await import('../src/models.js');
  const [flash, pro, max] = DEFAULT_MODELS;
  assert.equal(canUseModel(max, 'starter'), false);
  assert.equal(canUseModel(pro, 'power'), true);
  assert.equal(canUseModel(max, 'unknown'), false);
  assert.equal(quotaTokens(pro, 100, 50), 750, 'a dearer model burns quota faster');
  assert.equal(supplierCostMicroUsd(flash, 1_000_000, 1_000_000), 420_000);
  assert.equal(microUsdToKobo(1_000_000, 1600), 160_000);
  assert.equal(limitsForModel({ requestsPerMinute: 10, maxConcurrent: 2 }, max).requestsPerMinute, 2);
  assert.equal(validateModelInput({ ...pro }).ok, true);
  assert.equal(validateModelInput({ ...pro, supplier: 'nobody' }).ok, false);
  assert.equal(validateModelInput({ ...pro, rateFactor: 5 }).ok, false);
}
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

const dashboardPage = await app(new Request('https://cloud.example.com/'));
assert.equal(dashboardPage.status, 200);
assert.match(dashboardPage.headers.get('content-type'), /text\/html/);
assert.ok(dashboardPage.headers.get('content-security-policy'));
// The React bundle is fingerprinted per build, so pick whatever the build produced.
const builtAssets = await readdir(new URL('../public/assets/', import.meta.url));
const scriptAsset = builtAssets.find((name) => name.endsWith('.js'));
assert.ok(scriptAsset, 'the web bundle should be built into server/public/assets (npm run web:build)');
const assetResponse = await app(new Request(`https://cloud.example.com/assets/${scriptAsset}`));
assert.equal(assetResponse.status, 200);
assert.match(assetResponse.headers.get('content-type'), /javascript/);
assert.match(assetResponse.headers.get('cache-control') ?? '', /immutable/);
assert.equal((await app(new Request('https://cloud.example.com/dashboard.js'))).status, 404);
assert.equal((await app(new Request('https://cloud.example.com/..%2Fsrc%2Fconfig.js'))).status, 404);
assert.equal((await app(new Request('https://cloud.example.com/package.json'))).status, 404);

// The two account screens are client routes: the server has to hand back the
// shell for them or a reload on /signin lands on a 404.
for (const route of ['/signin', '/signup']) {
  const page = await app(new Request(`https://cloud.example.com${route}`));
  assert.equal(page.status, 200, `${route} should serve the app shell`);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<div id="root">/);
}
// A missing image is still a miss; only extension-less routes fall back.
assert.equal((await app(new Request('https://cloud.example.com/img/missing.jpg'))).status, 404);

// The Node adapter has to copy bytes: decoding the body as text turned every
// image into replacement characters and sent more bytes than the file holds.
{
  const listener = createRequestListener({ app, port: 0 });
  const nodeServer = createServer((request, response) => void listener(request, response));
  await new Promise((resolve) => nodeServer.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = nodeServer.address();
    const onDisk = await readFile(new URL('../public/zuri-logo.png', import.meta.url));
    const served = Buffer.from(await (await fetch(`http://127.0.0.1:${port}/zuri-logo.png`)).arrayBuffer());
    assert.equal(served.length, onDisk.length, 'the logo must be served byte for byte');
    assert.equal(served.subarray(0, 4).toString('hex'), '89504e47', 'the PNG signature must survive the adapter');
    assert.ok(served.equals(onDisk), 'served bytes must equal the file on disk');
  } finally {
    await new Promise((resolve) => nodeServer.close(resolve));
  }
}

// Downloads: publishing a release must be enough to change what the page offers,
// so the mapping from GitHub's reply to a download card is checked against a
// fixture. Drafts and prereleases are skipped, only the newest build per platform
// is offered, and the updater's side files (.blockmap, latest.yml) never become a
// download.
{
  const mapped = downloadsFromReleases([
    {
      tag_name: 'v0.3.0',
      html_url: 'https://github.com/King-odysseus/zuri-releases/releases/tag/v0.3.0',
      draft: false,
      prerelease: false,
      assets: [
        { name: 'Zuri-0.3.0-Setup.exe', size: 300, browser_download_url: 'https://github.com/o/r/releases/download/v0.3.0/Zuri-0.3.0-Setup.exe' },
        { name: 'Zuri-0.3.0.apk', size: 280, browser_download_url: 'https://github.com/o/r/releases/download/v0.3.0/Zuri-0.3.0.apk' },
        { name: 'Zuri-0.3.0-Setup.exe.blockmap', size: 2, browser_download_url: 'https://example.test/blockmap' },
        { name: 'latest.yml', size: 1, browser_download_url: 'https://example.test/latest.yml' },
      ],
    },
    {
      tag_name: 'v0.2.0',
      draft: false,
      prerelease: false,
      assets: [
        { name: 'Zuri-0.2.0-Setup.exe', size: 200, browser_download_url: 'https://example.test/older.exe' },
        { name: 'Zuri-0.2.0.dmg', size: 250, browser_download_url: 'https://example.test/Zuri-0.2.0.dmg' },
      ],
    },
    { tag_name: 'v0.4.0', draft: true, prerelease: false, assets: [{ name: 'Zuri-0.4.0-Setup.exe', size: 400, browser_download_url: 'https://example.test/draft.exe' }] },
    { tag_name: 'v0.5.0', draft: false, prerelease: true, assets: [{ name: 'Zuri-0.5.0-Setup.exe', size: 500, browser_download_url: 'https://example.test/pre.exe' }] },
  ]);

  assert.deepEqual(mapped.map((file) => file.platform), ['windows', 'macos', 'android'], 'Windows first, one card per platform');
  const [windowsRelease, macRelease, androidRelease] = mapped;
  assert.equal(windowsRelease.version, '0.3.0', 'the newest published release wins over older, draft and prerelease builds');
  assert.equal(windowsRelease.url, 'https://github.com/o/r/releases/download/v0.3.0/Zuri-0.3.0-Setup.exe');
  assert.equal(windowsRelease.size, 300, 'the size the page prints comes from here');
  assert.equal(windowsRelease.releaseUrl, 'https://github.com/King-odysseus/zuri-releases/releases/tag/v0.3.0');
  assert.equal(macRelease.version, '0.2.0', 'macOS falls back to the newest release that actually carries a dmg');
  assert.equal(macRelease.url, 'https://example.test/Zuri-0.2.0.dmg');
  assert.equal(androidRelease.version, '0.3.0', 'Android uses the newest published APK');
  assert.ok(!mapped.some((file) => /\.blockmap$|\.yml$/.test(file.name)), 'updater side files are never a download');
  assert.deepEqual(downloadsFromReleases([]), [], 'nothing published means nothing offered, not an error');
}

// A folder on disk still serves, as a fallback for a local run. Each installer
// there must come back as a file attachment. The folder is not in git, so the
// count is compared against the disk rather than hard-coded.
{
  const listed = await app(new Request('https://cloud.example.com/api/downloads'));
  assert.equal(listed.status, 200);
  const { files } = (await listed.json()).data;
  assert.ok(Array.isArray(files));

  const onDisk = await readdir(new URL('../downloads/', import.meta.url)).catch(() => []);
  assert.equal(files.length, onDisk.filter((name) => /\.(exe|dmg)$/i.test(name)).length);

  for (const file of files) {
    assert.ok(['windows', 'macos', 'android'].includes(file.platform), 'each file needs a known platform');
    assert.match(file.url, /^\/downloads\//, 'a file on disk is served by this server');
    assert.ok(file.size > 0, 'the size the page prints comes from here');

    const download = await app(new Request(`https://cloud.example.com${file.url}`));
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
    assert.equal(download.headers.get('content-disposition'), `attachment; filename="${file.name}"`);
    assert.equal(Number(download.headers.get('content-length')), file.size);
  }
}
// A name that is not an installer, or tries to climb out of the folder, is a miss.
assert.equal((await app(new Request('https://cloud.example.com/downloads/%2e%2e%2fsrc%2fconfig.js'))).status, 404);
assert.equal((await app(new Request('https://cloud.example.com/downloads/notes.txt'))).status, 404);
assert.equal((await app(new Request('https://cloud.example.com/downloads/missing.exe'))).status, 404);

// Password accounts: creating one, signing in, and getting back in after a
// forgotten password.
//
// The repository is held in memory so the suite still needs no Postgres, but it
// follows the contract db.js does: createUserWithPassword answers EMAIL_TAKEN for
// a duplicate address, findUserByEmail keeps the hash beside the public user, and
// consumePasswordReset spends a token exactly once. The mailer is the real one
// with a stubbed transport, because the reset link in the message is the only way
// the token can be observed from outside: it is never in a response body.
{
  const passwordUsers = [];
  const passwordSessions = new Map();
  const passwordResets = [];
  /** @param {object} record */
  const publicPasswordUser = (record) => ({
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    status: record.status,
    isAdmin: false,
    hasPassword: record.passwordHash !== '',
    createdAt: fixedNow().toISOString(),
  });

  const passwordRepository = {
    async createUserWithPassword({ email, passwordHash, displayName }) {
      if (passwordUsers.some((record) => record.email === email)) {
        const taken = new Error('An account with that email address already exists.');
        taken.code = 'EMAIL_TAKEN';
        throw taken;
      }
      const record = {
        id: `password-user-${passwordUsers.length + 1}`,
        email,
        displayName: displayName ?? '',
        passwordHash,
        status: 'active',
      };
      passwordUsers.push(record);
      return publicPasswordUser(record);
    },
    async findUserByEmail(email) {
      const record = passwordUsers.find((entry) => entry.email === email);
      return record ? { user: publicPasswordUser(record), passwordHash: record.passwordHash } : null;
    },
    async updatePasswordHash(userId, passwordHash) {
      const record = passwordUsers.find((entry) => entry.id === userId);
      if (!record) {
        const error = new Error('That account no longer exists.');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }
      record.passwordHash = passwordHash;
    },
    async createPasswordReset({ userId, tokenHash, expiresAt }) {
      passwordResets.push({ userId, tokenHash, expiresAt, usedAt: null });
    },
    // Single use and expiry in one step, the way the UPDATE in db.js does it.
    async consumePasswordReset(tokenHash) {
      const reset = passwordResets.find((entry) => entry.tokenHash === tokenHash && entry.usedAt === null && entry.expiresAt > fixedNow());
      if (!reset) return null;
      reset.usedAt = fixedNow();
      return reset.userId;
    },
    async revokeUserSessions(userId) {
      for (const session of passwordSessions.values()) {
        if (session.userId === userId) session.revoked = true;
      }
    },
    async createSession(userId, tokenHash, expiresAt) {
      passwordSessions.set(tokenHash, { userId, expiresAt, revoked: false, lastUsedAt: fixedNow() });
    },
    async findSessionUser(tokenHash) {
      const session = passwordSessions.get(tokenHash);
      if (!session || session.revoked) return null;
      const record = passwordUsers.find((entry) => entry.id === session.userId);
      if (!record) return null;
      return {
        user: publicPasswordUser(record),
        subscription: {
          id: 'password-subscription',
          planCode: 'starter',
          planName: 'Starter',
          monthlyTokens: 2_000_000,
          currentPeriodStart: fixedNow(),
          currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z'),
        },
        session: { lastUsedAt: session.lastUsedAt, expiresAt: session.expiresAt },
      };
    },
    async revokeSession(tokenHash) {
      const session = passwordSessions.get(tokenHash);
      if (session) session.revoked = true;
    },
    async getUsage(userId, periodStart, subscription) {
      return { usedTokens: 0, subscription };
    },
  };

  // A counter keeps every session and reset token distinct, so one revoked
  // session cannot hide behind another that happens to share a token.
  let passwordTokenSeed = 0;
  const passwordAuth = createAuthService({
    repository: passwordRepository,
    now: fixedNow,
    random: () => Buffer.from(`password-token-${(passwordTokenSeed += 1)}`),
  });

  const resetEmails = [];
  const mailer = createMailer({
    apiKey: 'brevo-test-key',
    from: 'cloud@zuri.example',
    fetchImpl: async (endpoint, init) => {
      resetEmails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messageId: 'mail-1' }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(mailer.configured, true, 'forgot-password needs a configured mailer');

  const passwordApp = createApp({
    auth: passwordAuth,
    repository: passwordRepository,
    mailer,
    now: fixedNow,
    siteUrl: 'https://cloud.example.com',
  });

  /** @param {string} route @param {object} body @param {string} [token] */
  const postJson = (route, body, token) => passwordApp(new Request(`https://cloud.example.com${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }));

  const email = 'ada@example.com';
  const password = 'correct horse battery';

  // 1. Sign-up creates the account and hands back a usable session.
  const signUp = await postJson('/api/auth/sign-up', { email, password, displayName: 'Ada' });
  assert.equal(signUp.status, 201, 'a new account is a creation, not a 200');
  assert.equal(signUp.headers.get('cache-control'), 'no-store');
  const signUpBody = await signUp.json();
  assert.equal(signUpBody.ok, true);
  assert.equal(signUpBody.data.user.email, email);
  assert.equal(signUpBody.data.user.displayName, 'Ada');
  assert.equal(signUpBody.data.user.hasPassword, true);
  assert.equal(signUpBody.data.user.passwordHash, undefined, 'the hash never leaves the server');
  assert.equal(typeof signUpBody.data.token, 'string');
  assert.ok(signUpBody.data.token !== '', 'signing up signs you in');
  assert.ok(Date.parse(signUpBody.data.expiresAt) > fixedNow().getTime());

  assert.equal(passwordUsers.length, 1, 'exactly one row is written');
  assert.match(passwordUsers[0].passwordHash, /^scrypt\$/, 'only a scrypt hash is stored');
  assert.notEqual(passwordUsers[0].passwordHash, password);

  const me = await passwordApp(new Request('https://cloud.example.com/api/me', {
    headers: { authorization: `Bearer ${signUpBody.data.token}` },
  }));
  assert.equal(me.status, 200, 'the token from sign-up authenticates straight away');
  assert.equal((await me.json()).data.user.email, email);

  // 2. A second account on the same address is refused, in any letter case.
  const duplicate = await postJson('/api/auth/sign-up', { email: 'Ada@Example.com', password });
  assert.equal(duplicate.status, 409);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.ok, false);
  assert.equal(duplicateBody.error.code, 'EMAIL_TAKEN');
  assert.equal(passwordUsers.length, 1, 'the taken address is never written twice');

  // 3. A password outside the rule (short, too long, or absent) is a 400 that
  //    names the rule, and no account appears.
  const shortPassword = await postJson('/api/auth/sign-up', { email: 'short@example.com', password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) });
  assert.equal(shortPassword.status, 400);
  const shortBody = await shortPassword.json();
  assert.equal(shortBody.error.code, 'INVALID_PASSWORD');
  assert.ok(shortBody.error.message.includes(`between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`), 'the message states the rule');

  const missingPassword = await postJson('/api/auth/sign-up', { email: 'missing@example.com' });
  assert.equal(missingPassword.status, 400);
  assert.equal((await missingPassword.json()).error.code, 'INVALID_PASSWORD');

  const longPassword = await postJson('/api/auth/sign-up', { email: 'long@example.com', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) });
  assert.equal(longPassword.status, 400);
  assert.equal((await longPassword.json()).error.code, 'INVALID_PASSWORD');

  const badEmail = await postJson('/api/auth/sign-up', { email: 'not-an-email', password });
  assert.equal(badEmail.status, 400);
  assert.equal((await badEmail.json()).error.code, 'INVALID_EMAIL');
  assert.equal(passwordUsers.length, 1, 'a refused sign-up never creates an account');

  // 4. The right password signs in, the wrong one and an unknown address answer
  //    the same 401 so neither can be told from the other.
  const signIn = await postJson('/api/auth/sign-in', { email: 'Ada@Example.com', password });
  assert.equal(signIn.status, 200);
  const signInBody = await signIn.json();
  assert.equal(signInBody.ok, true);
  assert.equal(signInBody.data.user.email, email, 'the address is normalised before it is matched');
  assert.equal(typeof signInBody.data.token, 'string');
  assert.equal(signInBody.data.usage.usedTokens, 0, 'the dashboard gets the quota with the session');

  const wrongPassword = await postJson('/api/auth/sign-in', { email, password: 'not-the-password' });
  assert.equal(wrongPassword.status, 401);
  const wrongPasswordBody = await wrongPassword.json();
  assert.equal(wrongPasswordBody.ok, false);
  assert.equal(wrongPasswordBody.error.code, 'INVALID_CREDENTIALS');

  const unknownAccount = await postJson('/api/auth/sign-in', { email: 'nobody@example.com', password });
  assert.equal(unknownAccount.status, 401);
  assert.deepEqual(await unknownAccount.json(), wrongPasswordBody, 'a missing account answers exactly like a wrong password');

  // 5. Forgot-password answers identically whether or not the address is real.
  const knownReset = await postJson('/api/auth/forgot-password', { email });
  const unknownReset = await postJson('/api/auth/forgot-password', { email: 'stranger@example.com' });
  assert.equal(knownReset.status, 200);
  assert.equal(unknownReset.status, 200);
  assert.deepEqual(await unknownReset.json(), await knownReset.json(), 'the answer must not reveal who is registered');
  assert.equal(resetEmails.length, 1, 'a link is only ever sent to a real account');
  assert.equal(resetEmails[0].to[0].email, email);
  assert.match(resetEmails[0].subject, /reset/i);

  const resetEmail = resetEmails[0];
  const link = /https?:\/\/\S+/.exec(resetEmail.textContent)?.[0] ?? '';
  assert.match(link, /^https:\/\/cloud\.example\.com\/reset-password\?token=/, 'the link points at the site reset screen, built from SITE_URL');
  const resetToken = new URL(link).searchParams.get('token') ?? '';
  assert.ok(resetToken !== '', 'the message must carry a token');

  // Without a configured mailer the route says so instead of pretending it sent
  // one: an unconfigured deployment is a state, not a bad address.
  const noMailApp = createApp({ auth: passwordAuth, repository: passwordRepository, now: fixedNow });
  const noMail = await noMailApp(new Request('https://cloud.example.com/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  }));
  assert.equal(noMail.status, 503);
  assert.equal((await noMail.json()).error.code, 'MAIL_NOT_CONFIGURED');

  // 6. The mailed token sets a new password; the old one stops working with it.
  const newPassword = 'brand new passphrase';
  const reset = await postJson('/api/auth/reset-password', { token: resetToken, password: newPassword });
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { ok: true, data: { reset: true, sessionsRevoked: true } });

  const oldPassword = await postJson('/api/auth/sign-in', { email, password });
  assert.equal(oldPassword.status, 401, 'the old password must stop working');
  assert.equal((await oldPassword.json()).error.code, 'INVALID_CREDENTIALS');

  const newPasswordSignIn = await postJson('/api/auth/sign-in', { email, password: newPassword });
  assert.equal(newPasswordSignIn.status, 200, 'the new password signs in');
  assert.equal((await newPasswordSignIn.json()).data.user.email, email);

  // The reset revokes every session the account held, including the sign-up one.
  const afterReset = await passwordApp(new Request('https://cloud.example.com/api/me', {
    headers: { authorization: `Bearer ${signUpBody.data.token}` },
  }));
  assert.equal(afterReset.status, 401);

  // A token works once, and a token that was never issued is refused.
  const reused = await postJson('/api/auth/reset-password', { token: resetToken, password: 'another passphrase' });
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).error.code, 'INVALID_RESET_TOKEN');

  const bogus = await postJson('/api/auth/reset-password', { token: 'never-issued', password: 'another passphrase' });
  assert.equal(bogus.status, 400);
  assert.equal((await bogus.json()).error.code, 'INVALID_RESET_TOKEN');

  // The password rule is checked before the token is looked at, so a rejected
  // password is answered as such rather than spending the link on it.
  const shortReset = await postJson('/api/auth/reset-password', { token: resetToken, password: 'short' });
  assert.equal(shortReset.status, 400);
  assert.equal((await shortReset.json()).error.code, 'INVALID_PASSWORD');

  // 7. set-password takes the account from the session, never from the body.
  const noSession = await postJson('/api/auth/set-password', { password: 'another passphrase' });
  assert.equal(noSession.status, 401);
  assert.equal(noSession.headers.get('www-authenticate'), 'Bearer');
  assert.deepEqual(await noSession.json(), { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });

  const sessionToken = (await (await postJson('/api/auth/sign-in', { email, password: newPassword })).json()).data.token;
  const setPassword = await postJson('/api/auth/set-password', { password: 'third passphrase' }, sessionToken);
  assert.equal(setPassword.status, 200);
  assert.deepEqual(await setPassword.json(), { ok: true, data: { updated: true } });

  assert.equal((await postJson('/api/auth/sign-in', { email, password: newPassword })).status, 401, 'the replaced password stops working');
  assert.equal((await postJson('/api/auth/sign-in', { email, password: 'third passphrase' })).status, 200);

  const shortSetPassword = await postJson('/api/auth/set-password', { password: 'x' }, sessionToken);
  assert.equal(shortSetPassword.status, 400);
  assert.equal((await shortSetPassword.json()).error.code, 'INVALID_PASSWORD');

  // The route is /api/auth/set-password and nothing else. The desktop handler
  // (src/main/main.js handleCloudSetPassword) posts to /api/auth/password, which
  // lands on the catch-all 404 below: this pins the real path so a client typo
  // cannot be papered over by quietly adding an alias route on the server.
  const aliasRoute = await postJson('/api/auth/password', { password: 'another passphrase' }, sessionToken);
  assert.equal(aliasRoute.status, 404);
  assert.equal((await aliasRoute.json()).error.code, 'NOT_FOUND');
}

console.log('PASS server contract');
