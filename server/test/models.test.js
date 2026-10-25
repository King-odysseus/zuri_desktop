import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAnthropicClient } from '../src/deepseek.js';
import { PLANS } from '../src/plans.js';
import { limitsForPlan } from '../src/limits.js';
import {
  DEFAULT_MODELS,
  MODEL_KINDS,
  canUseModel,
  findModel,
  imagePriceKobo,
  imageSupplierCostMicroUsd,
  imagesPerMonth,
  isImageModel,
  koboPerMillionQuotaTokens,
  limitsForModel,
  microUsdToKobo,
  publicImageModel,
  publicModel,
  quotaTokens,
  supplierCostMicroUsd,
  validateModelInput,
} from '../src/models.js';

const flash = DEFAULT_MODELS.find((model) => model.code === 'zuri-flash');
const pro = DEFAULT_MODELS.find((model) => model.code === 'zuri-pro');
const max = DEFAULT_MODELS.find((model) => model.code === 'zuri-max');
const code = DEFAULT_MODELS.find((model) => model.code === 'zuri-code');
const reason = DEFAULT_MODELS.find((model) => model.code === 'zuri-reason');
const elite = DEFAULT_MODELS.find((model) => model.code === 'zuri-elite');
const sketch = DEFAULT_MODELS.find((model) => model.code === 'zuri-sketch');
const canvas = DEFAULT_MODELS.find((model) => model.code === 'zuri-canvas');
const studio = DEFAULT_MODELS.find((model) => model.code === 'zuri-studio');

let anthropicRequest;
const anthropic = createAnthropicClient({
  apiKey: 'test-key',
  fetchImpl: async (_url, request) => {
    anthropicRequest = { ...request, body: JSON.parse(request.body) };
    return new Response(JSON.stringify({ id: 'msg_test', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 9, output_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
const anthropicResult = await anthropic({ messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hi' }], model: 'claude-sonnet-5-5', maxTokens: 100 });
assert.equal(anthropicResult.content, 'hello');
assert.deepEqual(anthropicResult.usage, { inputTokens: 9, outputTokens: 4 });
assert.equal(anthropicRequest.headers['x-api-key'], 'test-key');
assert.equal(anthropicRequest.body.system, 'Be concise.');

// Plans: a Max plan exists, is the dearest, and has request limits of its own.
assert.equal(PLANS.at(-1).code, 'max');
assert.ok(limitsForPlan('max').requestsPerMinute > limitsForPlan('power').requestsPerMinute);

// Cost: dollars per million tokens is micro-dollars per token.
assert.equal(supplierCostMicroUsd(flash, 1_000_000, 1_000_000), 420_000);
assert.equal(supplierCostMicroUsd(pro, 1000, 1000), 3100);
assert.equal(supplierCostMicroUsd(flash, 0, 0), 0);
assert.equal(microUsdToKobo(1_000_000, 1600), 160_000);

// Image: the price a customer pays comes from the plan's own naira rate, so the
// picture ladder stays in step with what a plan costs. Starter is NGN 2500 for
// two million quota tokens, which is 125000 kobo per million tokens.
assert.equal(MODEL_KINDS.includes('image'), true);
assert.equal(isImageModel(sketch), true);
assert.equal(isImageModel(flash), false);
assert.equal(imageSupplierCostMicroUsd(sketch), 12_000);
assert.equal(imageSupplierCostMicroUsd(canvas), 70_000);
assert.equal(imageSupplierCostMicroUsd(studio), 190_000);
assert.equal(imageSupplierCostMicroUsd(flash), 0);

const starterPlan = PLANS.find((plan) => plan.code === 'starter');
const proPlanInfo = PLANS.find((plan) => plan.code === 'pro');
const powerPlan = PLANS.find((plan) => plan.code === 'power');
const maxPlan = PLANS.find((plan) => plan.code === 'max');
assert.equal(koboPerMillionQuotaTokens(starterPlan), 125_000);
assert.equal(koboPerMillionQuotaTokens(proPlanInfo), 100_000);
assert.equal(koboPerMillionQuotaTokens(undefined), 0);
assert.equal(koboPerMillionQuotaTokens({ amountKobo: 250_000, monthlyTokens: 0 }), 0);
assert.equal(imagePriceKobo(sketch, starterPlan), 6_000);
assert.equal(imagePriceKobo(canvas, starterPlan), 33_000);
assert.equal(imagePriceKobo(studio, starterPlan), 90_000);
assert.equal(imagePriceKobo(sketch, proPlanInfo), 4_800);
assert.equal(imagePriceKobo(flash, starterPlan), 0);

// 48,000 quota tokens per picture against each plan's allowance.
assert.equal(imagesPerMonth(sketch, starterPlan), 41);
assert.equal(imagesPerMonth(sketch, proPlanInfo), 125);
assert.equal(imagesPerMonth(sketch, powerPlan), 250);
assert.equal(imagesPerMonth(sketch, maxPlan), 833);
assert.equal(imagesPerMonth(flash, maxPlan), 0);
assert.equal(imagesPerMonth(sketch, undefined), 0);

// Quota: a dearer model uses the monthly allowance faster.
assert.equal(quotaTokens(flash, 100, 50), 150);
assert.equal(quotaTokens(pro, 100, 50), 750);
assert.equal(quotaTokens(max, 100, 50), 1800);
assert.equal(quotaTokens(code, 100, 50), 1500);
assert.equal(quotaTokens(elite, 100, 50), 3000);

// Plan gating follows the price ladder.
assert.equal(canUseModel(flash, 'starter'), true);
assert.equal(canUseModel(pro, 'starter'), true);
assert.equal(canUseModel(max, 'starter'), false);
assert.equal(canUseModel(max, 'pro'), true);
assert.equal(canUseModel(code, 'pro'), true);
assert.equal(canUseModel(reason, 'pro'), true);
assert.equal(canUseModel(elite, 'pro'), false);
assert.equal(canUseModel(elite, 'max'), true);
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

// The picture ladder a customer sees, with no supplier anywhere in it.
const imageLadder = publicImageModel(canvas, PLANS);
assert.equal(imageLadder.code, 'zuri-canvas');
assert.equal(imageLadder.kind, 'image');
assert.equal(imageLadder.quotaTokensPerImage, 264_000);
assert.deepEqual(imageLadder.plans.map((plan) => plan.code), ['starter', 'pro', 'power', 'max']);
// Starter and Power share one rate (NGN 2500 per 2 million), as do Pro and Max
// (NGN 6000 per 6 million), so the per-picture price follows the plan rate.
assert.deepEqual(imageLadder.plans.map((plan) => plan.priceKobo), [33_000, 26_400, 33_000, 26_400]);
assert.deepEqual(imageLadder.plans.map((plan) => plan.images), [7, 22, 45, 151]);
const shownImage = JSON.stringify(publicImageModel(studio, PLANS));
assert.ok(!shownImage.includes('supplier'));

// Admin edits are validated.
const good = { ...pro, supplier: 'openai', supplierModel: 'gpt-4o-mini' };
assert.equal(validateModelInput(good).ok, true);
assert.equal(validateModelInput({ ...reason, supplier: 'anthropic' }).ok, true);
assert.equal(validateModelInput({ ...good, code: 'Bad Code' }).ok, false);
assert.equal(validateModelInput({ ...good, supplier: 'unknown' }).ok, false);
assert.equal(validateModelInput({ ...good, minPlan: 'platinum' }).ok, false);
assert.equal(validateModelInput({ ...good, quotaWeight: 0 }).ok, false);
assert.equal(validateModelInput({ ...good, rateFactor: 2 }).ok, false);
assert.equal(validateModelInput({ ...good, inputUsdPerMillion: -1 }).ok, false);

// Image models must say how much of the allowance one picture spends; text models
// can never be billed per image.
assert.equal(validateModelInput({ ...sketch, supplier: 'zai' }).ok, true);
assert.equal(validateModelInput({ ...sketch, supplier: 'zai', quotaTokensPerImage: 0 }).ok, false);
assert.equal(validateModelInput({ ...sketch, supplier: 'zai', quotaTokensPerImage: 12.5 }).ok, false);
assert.equal(validateModelInput({ ...sketch, supplier: 'zai', usdPerImage: -1 }).ok, false);
assert.equal(validateModelInput({ ...sketch, supplier: 'zai', imageQuality: 'x'.repeat(21) }).ok, false);
assert.equal(validateModelInput({ ...sketch, supplier: 'zai', kind: 'video' }).ok, false);
const forcedText = validateModelInput({ ...good, usdPerImage: 5, quotaTokensPerImage: 9_000 });
assert.equal(forcedText.ok, true);
assert.equal(forcedText.model.kind, 'text');
assert.equal(forcedText.model.usdPerImage, 0);
assert.equal(forcedText.model.quotaTokensPerImage, 0);

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
// The catalogue carries both meters now: six text models and three image models.
assert.equal(listed.data.length, 9);
assert.ok(!JSON.stringify(listed).includes('deepseek'));

// The picture price list is public so the marketing page can quote it before
// anyone signs in, and it never names a supplier.
const prices = await (await call(customer, '/api/image-prices')).json();
assert.deepEqual(prices.data.map((model) => model.code), ['zuri-sketch', 'zuri-canvas', 'zuri-studio']);
assert.equal(prices.data[0].plans[0].priceKobo, 6_000);
assert.equal(prices.data[0].plans[0].images, 41);
assert.equal(prices.data[2].plans[0].priceKobo, 90_000);
assert.ok(!JSON.stringify(prices).includes('supplier'));
assert.equal((await call(customer, '/api/image-prices', { method: 'POST' })).status, 405);

const admin = appFor('starter', true);
const overview = (await (await call(admin, '/api/admin/overview')).json()).data;
assert.equal(overview.costKobo, 150_000);
assert.equal(overview.marginKobo, 850_000);
assert.equal(overview.spendByModel[0].costKobo, 150_000);
assert.equal(overview.models.length, 9);

// The dashboard reports each picture on the plan that sells it first, with what
// the supplier charges, so the margin is the real one and not a Starter guess.
const pictureRows = overview.models.filter((model) => model.kind === 'image');
assert.deepEqual(pictureRows.map((model) => model.code), ['zuri-sketch', 'zuri-canvas', 'zuri-studio']);
assert.deepEqual(pictureRows.map((model) => model.pricePlanCode), ['starter', 'pro', 'max']);
assert.deepEqual(pictureRows.map((model) => model.supplierCostKoboPerImage), [1_800, 10_500, 28_500]);
assert.deepEqual(pictureRows.map((model) => model.priceKoboPerImage), [6_000, 26_400, 72_000]);
for (const row of pictureRows) {
  assert.ok(row.priceKoboPerImage > row.supplierCostKoboPerImage, `${row.code} must earn more than its supplier charge`);
}
const textRow = overview.models.find((model) => model.code === 'zuri-flash');
assert.equal(textRow.kind, 'text');
assert.equal(textRow.priceKoboPerImage, 0);
assert.equal(textRow.pricePlanCode, '');

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

// A picture model is billed per image, so chat must refuse it rather than reach
// the text supplier with a picture model name and record no charge.
const picture = await call(customer, '/api/chat', { method: 'POST', body: JSON.stringify({ model: 'zuri-sketch', messages: [{ role: 'user', content: 'draw a cat' }] }) });
assert.equal(picture.status, 400);
assert.equal((await picture.json()).error.code, 'IMAGE_MODEL');

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
