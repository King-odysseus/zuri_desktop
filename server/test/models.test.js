import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { PLANS } from '../src/plans.js';
import { limitsForPlan } from '../src/limits.js';
import {
  DEFAULT_MODELS,
  canUseModel,
  findModel,
  limitsForModel,
  microUsdToKobo,
  publicModel,
  quotaTokens,
  supplierCostMicroUsd,
  validateModelInput,
} from '../src/models.js';

const flash = DEFAULT_MODELS.find((model) => model.code === 'zuri-flash');
const pro = DEFAULT_MODELS.find((model) => model.code === 'zuri-pro');
const max = DEFAULT_MODELS.find((model) => model.code === 'zuri-max');

// Plans: a Max plan exists, is the dearest, and has request limits of its own.
assert.equal(PLANS.at(-1).code, 'max');
assert.ok(limitsForPlan('max').requestsPerMinute > limitsForPlan('power').requestsPerMinute);

// Cost: dollars per million tokens is micro-dollars per token.
assert.equal(supplierCostMicroUsd(flash, 1_000_000, 1_000_000), 420_000);
assert.equal(supplierCostMicroUsd(pro, 1000, 1000), 3100);
assert.equal(supplierCostMicroUsd(flash, 0, 0), 0);
assert.equal(microUsdToKobo(1_000_000, 1600), 160_000);

// Quota: a dearer model uses the monthly allowance faster.
assert.equal(quotaTokens(flash, 100, 50), 150);
assert.equal(quotaTokens(pro, 100, 50), 750);
assert.equal(quotaTokens(max, 100, 50), 1800);

// Plan gating follows the price ladder.
assert.equal(canUseModel(flash, 'starter'), true);
assert.equal(canUseModel(pro, 'starter'), true);
assert.equal(canUseModel(max, 'starter'), false);
assert.equal(canUseModel(max, 'pro'), true);
assert.equal(canUseModel(max, 'nonsense'), false);

// Rate limits shrink for dear models, and never reach zero.
const proPlan = limitsForPlan('pro');
assert.equal(limitsForModel(proPlan, flash).requestsPerMinute, 60);
assert.equal(limitsForModel(proPlan, pro).requestsPerMinute, 30);
assert.equal(limitsForModel(proPlan, max).requestsPerMinute, 15);
assert.equal(limitsForModel(limitsForPlan('starter'), max).maxConcurrent, 1);

// Lookup: no code means the default; an unknown or switched-off model is refused.
assert.equal(findModel(DEFAULT_MODELS, undefined).code, 'zuri-flash');
assert.equal(findModel(DEFAULT_MODELS, 'gpt-4o'), null);
assert.equal(findModel([{ ...flash, isActive: false }], 'zuri-flash'), null);

// Customers never see the supplier.
const shown = JSON.stringify(publicModel(pro, 'starter'));
assert.ok(!shown.includes('moonshot'));
assert.ok(!shown.includes('kimi'));
assert.ok(!shown.includes('Usd'));
assert.equal(publicModel(pro, 'starter').available, true);

// Admin edits are validated.
const good = { ...pro, supplier: 'openai', supplierModel: 'gpt-4o-mini' };
assert.equal(validateModelInput(good).ok, true);
assert.equal(validateModelInput({ ...good, code: 'Bad Code' }).ok, false);
assert.equal(validateModelInput({ ...good, supplier: 'unknown' }).ok, false);
assert.equal(validateModelInput({ ...good, minPlan: 'platinum' }).ok, false);
assert.equal(validateModelInput({ ...good, quotaWeight: 0 }).ok, false);
assert.equal(validateModelInput({ ...good, rateFactor: 2 }).ok, false);
assert.equal(validateModelInput({ ...good, inputUsdPerMillion: -1 }).ok, false);

// Routes: a plain customer is refused the admin area; an admin gets the report.
function session(planCode, isAdmin) {
  return { user: { id: 'u1', email: 'a@b.c', isAdmin }, subscription: { id: 's1', planCode, monthlyTokens: 1_000_000, currentPeriodStart: new Date(0), currentPeriodEnd: new Date(9e12) } };
}
const saved = [];
const chats = [];
function appFor(planCode, isAdmin) {
  return createApp({
    auth: { authenticate: async () => session(planCode, isAdmin) },
    repository: {
      async reserveUsage(request) { chats.push({ reserved: request.requestedTokens }); return { id: 'r1' }; },
      async commitUsage(entry) { chats.push({ committed: entry }); },
      async releaseUsage() {},
      async saveModel(model) { saved.push(model); return model; },
      async adminOverview() {
        return { days: 30, users: 5, revenueKobo: 1_000_000, byModel: [{ modelCode: 'zuri-flash', requests: 3, inputTokens: 10, outputTokens: 10, quotaTokens: 20, costMicroUsd: 1_000_000 }], plans: [{ code: 'starter', name: 'Starter', amountKobo: 250000, monthlyTokens: 2000000, subscribers: 4 }] };
      },
    },
    chatProvider: async (request) => ({ model: request.model, content: 'hi', usage: { inputTokens: 100, outputTokens: 50 } }),
    nairaPerUsd: 1500,
  });
}
function call(app, path, options = {}) {
  return app(new Request(`https://cloud.example.com${path}`, { ...options, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } }));
}

const customer = appFor('starter', false);
assert.equal((await call(customer, '/api/admin/overview')).status, 403);
assert.equal((await call(customer, '/api/admin/models', { method: 'PUT', body: JSON.stringify(good) })).status, 403);

const listed = await (await call(customer, '/api/models')).json();
assert.equal(listed.data.length, 3);
assert.ok(!JSON.stringify(listed).includes('deepseek'));

const admin = appFor('starter', true);
const overview = (await (await call(admin, '/api/admin/overview')).json()).data;
assert.equal(overview.costKobo, 150_000);
assert.equal(overview.marginKobo, 850_000);
assert.equal(overview.spendByModel[0].costKobo, 150_000);
assert.equal(overview.models.length, 3);

const edit = await call(admin, '/api/admin/models', { method: 'PUT', body: JSON.stringify(good) });
assert.equal(edit.status, 200);
assert.equal(saved.length, 1);
assert.equal((await call(admin, '/api/admin/models', { method: 'PUT', body: JSON.stringify({ ...good, quotaWeight: 0 }) })).status, 400);

// Chat: a Starter plan cannot reach a Max model, and a Flash chat records cost and weight.
const upgrade = await call(customer, '/api/chat', { method: 'POST', body: JSON.stringify({ model: 'zuri-max', messages: [{ role: 'user', content: 'hi' }] }) });
assert.equal(upgrade.status, 403);
assert.equal((await upgrade.json()).error.code, 'PLAN_UPGRADE_REQUIRED');
const unknown = await call(customer, '/api/chat', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }) });
assert.equal(unknown.status, 400);

const ok = await call(customer, '/api/chat', { method: 'POST', body: JSON.stringify({ model: 'zuri-flash', messages: [{ role: 'user', content: 'hi' }] }) });
assert.equal(ok.status, 200);
const body = (await ok.json()).data;
assert.equal(body.model, 'zuri-flash');
assert.equal(body.modelName, 'Zuri Flash');
const committed = chats.find((entry) => entry.committed).committed;
assert.equal(committed.modelCode, 'zuri-flash');
assert.equal(committed.quotaTokens, 150);
assert.equal(committed.costMicroUsd, 28);

console.log('PASS server models');
