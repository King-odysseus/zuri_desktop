import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService, generateTemporaryPassword, verifyPassword } from '../src/auth.js';

const TARGET_ID = '11111111-1111-4111-8111-111111111111';

// The password an administrator hands out is readable aloud and never ambiguous.
const sample = generateTemporaryPassword();
assert.equal(sample.length, 14);
assert.match(sample, /^[A-HJ-NP-Za-km-z2-9]+$/, 'no 0, O, 1, l or I in a password people must read');
assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword(), 'every password is fresh');

/** A repository that records what the routes asked of it. */
function fakeRepository() {
  const calls = [];
  const state = { emailTaken: false, adminTarget: false, userExists: true, hashes: new Map() };
  return {
    calls,
    state,
    async createSession() {},
    async findSessionUser() { return null; },
    async adminListUsers(options) {
      calls.push({ list: options });
      return [{ id: TARGET_ID, email: 'ada@example.com', displayName: 'Ada', status: 'active', isAdmin: false, planCode: 'starter', usedTokens: 10, monthlyTokens: 2_000_000 }];
    },
    async adminCreateUser(request) {
      calls.push({ create: { ...request, passwordHash: '[hash]' } });
      if (state.emailTaken) throw Object.assign(new Error('An account with that email address already exists.'), { code: 'EMAIL_TAKEN' });
      state.hashes.set(request.email, request.passwordHash);
      return { id: TARGET_ID, email: request.email, displayName: request.displayName, status: 'active', isAdmin: false };
    },
    async adminSetUserStatus(userId, status) {
      calls.push({ status: { userId, status } });
      return state.adminTarget ? null : { id: userId, email: 'ada@example.com', status };
    },
    async adminSetUserPlan(userId, planCode, days) {
      calls.push({ plan: { userId, planCode, days } });
      if (!state.userExists) throw Object.assign(new Error('That account no longer exists.'), { code: 'USER_NOT_FOUND' });
    },
    async updatePasswordHash(userId, hash) { calls.push({ passwordFor: userId }); state.hashes.set(userId, hash); },
    async updateDisplayName(userId, displayName) { calls.push({ displayName: { userId, displayName } }); return { id: userId, email: 'boss@example.com', displayName, status: 'active', isAdmin: true }; },
    async revokeUserSessions(userId) { calls.push({ revoked: userId }); },
    async adminStats(days) {
      return { days, accounts: { active: 3, suspended: 1, joined: 2, seenToday: 1 }, usage: { requestsToday: 4, tokensToday: 400, requests: 9, tokens: 900, people: 2 }, daily: [], subscriptions: { paying: 2, monthlyKobo: 500000 }, topUsers: [], payments: { paid: 2, failed: 0 } };
    },
  };
}

function appFor(isAdmin, repository, extra = {}) {
  const service = createAuthService({ repository });
  const session = { user: { id: 'admin-1', email: 'boss@example.com', isAdmin }, subscription: { id: 's1', planCode: 'max', monthlyTokens: 1, currentPeriodStart: new Date(0), currentPeriodEnd: new Date(9e12) } };
  return createApp({ auth: { ...service, authenticate: async () => session }, repository, ...extra });
}

function call(app, path, options = {}) {
  return app(new Request(`https://cloud.example.com${path}`, { ...options, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } }));
}

const patch = (app, id, body) => call(app, `/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

// A customer reaches none of it.
const customerRepo = fakeRepository();
const customer = appFor(false, customerRepo);
assert.equal((await call(customer, '/api/admin/users')).status, 403);
assert.equal((await call(customer, '/api/admin/stats')).status, 403);
assert.equal((await call(customer, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'a@b.co' }) })).status, 403);
assert.equal(customerRepo.calls.length, 0, 'a refused call never reaches the repository');

const repo = fakeRepository();
const admin = appFor(true, repo);

const renamed = await call(admin, '/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: 'Boss Zuri' }) });
assert.equal(renamed.status, 200);
assert.equal((await renamed.json()).data.user.displayName, 'Boss Zuri');
assert.deepEqual(repo.calls.at(-1), { displayName: { userId: 'admin-1', displayName: 'Boss Zuri' } });

const tooLong = await call(admin, '/api/me', { method: 'PATCH', body: JSON.stringify({ displayName: 'x'.repeat(61) }) });
assert.equal(tooLong.status, 400);

// The list passes the search through and returns what the repository found.
const listed = await (await call(admin, '/api/admin/users?search=Ada')).json();
assert.equal(listed.ok, true);
assert.equal(listed.data.users[0].email, 'ada@example.com');
assert.deepEqual(repo.calls.at(-1), { list: { search: 'Ada' } });

// Creating an account: a generated password comes back once, only its hash is stored.
const created = await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: ' Ada@Example.com ', displayName: 'Ada', planCode: 'pro', days: 60 }) });
assert.equal(created.status, 201);
const createdBody = await created.json();
assert.equal(createdBody.data.temporaryPassword.length, 14);
assert.equal(createdBody.data.planCode, 'pro');
assert.equal(createdBody.data.days, 60);
assert.ok(!JSON.stringify(createdBody).includes('passwordHash'));
assert.equal(await verifyPassword(createdBody.data.temporaryPassword, repo.state.hashes.get('ada@example.com')), true, 'the stored hash matches the password that was handed out');
assert.deepEqual(repo.calls.at(-1).create, { email: 'ada@example.com', passwordHash: '[hash]', displayName: 'Ada', planCode: 'pro', days: 60 });

// A plan and a length default to Starter for thirty days.
const defaults = await (await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'new@example.com' }) })).json();
assert.equal(defaults.data.planCode, 'starter');
assert.equal(defaults.data.days, 30);

// Bad input is refused before anything is written.
const before = repo.calls.length;
assert.equal((await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'not an email' }) })).status, 400);
assert.equal((await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'x@y.co', planCode: 'platinum' }) })).status, 400);
assert.equal((await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'x@y.co', days: 0 }) })).status, 400);
assert.equal((await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'x@y.co', days: 400 }) })).status, 400);
assert.equal(repo.calls.length, before);

repo.state.emailTaken = true;
const taken = await call(admin, '/api/admin/users', { method: 'POST', body: JSON.stringify({ email: 'ada@example.com' }) });
assert.equal(taken.status, 409);
assert.equal((await taken.json()).error.code, 'EMAIL_TAKEN');
repo.state.emailTaken = false;

// Suspend and restore, but never yourself and never another administrator.
assert.equal((await patch(admin, 'admin-1', { action: 'suspend' })).status, 404, 'a non-uuid id is not a route');
assert.equal((await patch(admin, TARGET_ID, { action: 'suspend' })).status, 200);
assert.deepEqual(repo.calls.at(-1), { status: { userId: TARGET_ID, status: 'suspended' } });
assert.equal((await patch(admin, TARGET_ID, { action: 'restore' })).status, 200);
assert.deepEqual(repo.calls.at(-1), { status: { userId: TARGET_ID, status: 'active' } });
repo.state.adminTarget = true;
assert.equal((await patch(admin, TARGET_ID, { action: 'suspend' })).status, 404);
repo.state.adminTarget = false;
const selfApp = createApp({ auth: { ...createAuthService({ repository: repo }), authenticate: async () => ({ user: { id: TARGET_ID, email: 'me@example.com', isAdmin: true }, subscription: { id: 's', planCode: 'max', monthlyTokens: 1, currentPeriodStart: new Date(0), currentPeriodEnd: new Date(9e12) } }) }, repository: repo });
assert.equal((await patch(selfApp, TARGET_ID, { action: 'suspend' })).status, 409, 'an administrator cannot suspend themselves');

// Plan changes validate the plan and report a vanished account.
assert.equal((await patch(admin, TARGET_ID, { action: 'set-plan', planCode: 'power', days: 45 })).status, 200);
assert.deepEqual(repo.calls.at(-1), { plan: { userId: TARGET_ID, planCode: 'power', days: 45 } });
assert.equal((await patch(admin, TARGET_ID, { action: 'set-plan', planCode: 'gold' })).status, 400);
repo.state.userExists = false;
assert.equal((await patch(admin, TARGET_ID, { action: 'set-plan', planCode: 'pro' })).status, 404);
repo.state.userExists = true;

// An administrator can put themselves on a plan too, which is the other half of the
// same gesture: unlike suspend, a plan change on your own account is allowed.
assert.equal((await patch(selfApp, TARGET_ID, { action: 'set-plan', planCode: 'max', days: 365 })).status, 200);
assert.deepEqual(repo.calls.at(-1), { plan: { userId: TARGET_ID, planCode: 'max', days: 365 } });

// A reset replaces the password and signs the person out everywhere.
const reset = await (await patch(admin, TARGET_ID, { action: 'reset-password' })).json();
assert.equal(reset.data.temporaryPassword.length, 14);
assert.equal(await verifyPassword(reset.data.temporaryPassword, repo.state.hashes.get(TARGET_ID)), true);
assert.deepEqual(repo.calls.at(-1), { revoked: TARGET_ID });

assert.equal((await patch(admin, TARGET_ID, { action: 'delete-everything' })).status, 400);
assert.equal((await call(admin, `/api/admin/users/${TARGET_ID}`)).status, 405);

// The health report adds what only the server knows.
const stats = await (await call(admin, '/api/admin/stats?days=7')).json();
assert.equal(Number(stats.data.days), 7);
assert.equal(stats.data.accounts.active, 3);
assert.ok(stats.data.server.uptimeSeconds >= 0);
assert.ok(stats.data.server.databaseMs >= 0);

// An unknown admin address is a 404, not the overview by accident.
assert.equal((await call(admin, '/api/admin/nothing')).status, 404);

// An administrator is never sent to Paystack. The route refuses before any payment
// row is written, so no money can be taken for a plan the account gets for free.
const billingRepo = fakeRepository();
let paymentsWritten = 0;
billingRepo.createPayment = async () => { paymentsWritten += 1; };
billingRepo.markPaymentFailed = async () => {};
const billing = {
  paystack: {
    async initializeTransaction() {
      return { authorization_url: 'https://checkout.paystack.com/test', access_code: 'access-test' };
    },
  },
  paystackPlanCodes: { starter: 'PLN_starter' },
  paystackCallbackUrl: 'https://cloud.example.com/billing/callback',
};
const adminCheckout = await call(appFor(true, billingRepo, billing), '/api/billing/checkout', {
  method: 'POST',
  body: JSON.stringify({ planCode: 'starter' }),
});
assert.equal(adminCheckout.status, 409);
assert.equal((await adminCheckout.json()).error.code, 'ADMIN_PLAN_IS_FREE');
assert.equal(paymentsWritten, 0, 'a refused checkout writes no payment row');

// The same request from a customer still starts a real checkout.
const customerCheckout = await call(appFor(false, billingRepo, billing), '/api/billing/checkout', {
  method: 'POST',
  body: JSON.stringify({ planCode: 'starter' }),
});
assert.equal(customerCheckout.status, 200);
assert.equal(paymentsWritten, 1);

console.log('PASS admin user management');
