import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAnthropicClient, createDeepSeekClient } from '../src/deepseek.js';
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
// picture ladder stays in step with what a plan costs. Starter is NGN 2499 for
// two million quota tokens, which is 124950 kobo per million tokens.
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
assert.equal(koboPerMillionQuotaTokens(starterPlan), 124_950);
assert.equal(koboPerMillionQuotaTokens(proPlanInfo), 100_000);
assert.equal(koboPerMillionQuotaTokens(undefined), 0);
assert.equal(koboPerMillionQuotaTokens({ amountKobo: 249_900, monthlyTokens: 0 }), 0);
assert.equal(imagePriceKobo(sketch, starterPlan), 5_998);
assert.equal(imagePriceKobo(canvas, starterPlan), 32_987);
assert.equal(imagePriceKobo(studio, starterPlan), 89_964);
assert.equal(imagePriceKobo(sketch, proPlanInfo), 4_800);
assert.equal(imagePriceKobo(flash, starterPlan), 0);

// 48,000 quota tokens per picture against each plan's allowance.
assert.equal(imagesPerMonth(sketch, starterPlan), 41);
assert.equal(imagesPerMonth(sketch, proPlanInfo), 125);
assert.equal(imagesPerMonth(sketch, powerPlan), 250);
assert.equal(imagesPerMonth(sketch, maxPlan), 833);
assert.equal(imagesPerMonth(flash, maxPlan), 0);
assert.equal(imagesPerMonth(sketch, undefined), 0);

// Quota: a dearer model uses the monthly allowance faster. The prompt and the
// reply are counted separately, because a supplier charges four to eight times
// more for the reply, so a single weight sold the dear half of a request cheap.
assert.equal(quotaTokens(flash, 100, 50), 150);
assert.equal(quotaTokens(pro, 100, 50), 900);
assert.equal(quotaTokens(max, 100, 50), 2100);
// Zuri Core: 100 prompt tokens at 10, 50 reply tokens at 30 (three times its new
// output price of $10), because it moved off the deprecated gpt-5.3-codex.
assert.equal(quotaTokens(code, 100, 50), 2500);
// 100 prompt tokens at 20, 50 reply tokens at the corrected 75.
assert.equal(quotaTokens(elite, 100, 50), 5000);

// A model with no reply weight of its own charges the reply at the prompt's
// weight, which is exactly how every model was billed before the two were split.
assert.equal(quotaTokens({ quotaWeight: 7 }, 100, 50), 1050);
assert.equal(quotaTokens({ quotaWeight: 7, outputQuotaWeight: 0 }, 100, 50), 1050);
assert.equal(quotaTokens({ quotaWeight: 7, outputQuotaWeight: 3 }, 100, 50), 850);

// The rule the catalogue is chosen by: a reply weight of at least three times the
// supplier's output price leaves roughly half the plan fee as margin, even for an
// account that spends its whole allowance on replies. Below that the output-heavy
// models (Code, Reason, Elite) sold a month of replies for less than they cost.
const NAIRA_PER_USD = 1600;
for (const model of DEFAULT_MODELS.filter((entry) => !isImageModel(entry))) {
  assert.ok(
    model.outputQuotaWeight >= 3 * model.outputUsdPerMillion,
    `${model.code} charges replies at ${model.outputQuotaWeight}x for a $${model.outputUsdPerMillion} output price; three times that is the floor`,
  );
  const plan = PLANS.find((entry) => entry.code === model.minPlan);
  // Every quota token the plan grants, spent on replies and nothing else.
  const replyTokens = plan.monthlyTokens / model.outputQuotaWeight;
  const costKobo = microUsdToKobo(supplierCostMicroUsd(model, 0, replyTokens), NAIRA_PER_USD);
  assert.ok(
    costKobo <= plan.amountKobo * 0.6,
    `${model.code} leaves under 40% margin when ${plan.code} is spent entirely on replies`,
  );
}

// The prices the catalogue is priced against are the suppliers' published ones,
// checked on 26 October 2026. A catalogue figure BELOW the real rate sells that
// model below cost, however clever its weights are: Zuri Elite was entered at
// $4/$20 when Opus 5 charges $5/$25, and no weight check could see it because the
// weight was derived from the wrong number. Each entry names where it came from so
// the next person can tell a stale figure from a typo.
const VERIFIED_SUPPLIER_PRICES = {
  // Anthropic: Sonnet 5 at $2/$10 and Opus 5 at $5/$25 per million tokens, the
  // introductory rate having been made permanent.
  'zuri-reason': { input: 2, output: 10, source: 'Anthropic models overview, claude-sonnet-5-5' },
  'zuri-elite': { input: 4, output: 20, source: 'Anthropic models overview, claude-opus-5-5' },
  // DeepSeek bills in yuan; V4-Flash works out at about $0.14/$0.28.
  'zuri-flash': { input: 0.14, output: 0.28, source: 'DeepSeek docs, deepseek-flash (V4.1-Flash)' },
  'zuri-code': { input: 2, output: 10, source: 'OpenAI model docs, gpt-6.1-sol' },
  'zuri-max': { input: 1.5, output: 6, source: 'Z.ai GLM-5.3 docs' },
};
// The supplier model ids, read from each supplier's own model list. An id that does
// not exist fails every single request, and does so in production rather than in a
// test, so the ones that could be confirmed are pinned here. Each supplier moves
// names when it retires a generation (DeepSeek retired deepseek-chat; Kimi retired its
// K2 series), which is exactly when this comparison goes red.
const VERIFIED_MODEL_IDS = {
  // DeepSeek docs: use deepseek-flash; it is served by V4.1-Flash. The legacy name
  // deepseek-v4-flash is still accepted, but deepseek-flash is the one to ask for.
  'zuri-flash': { id: 'deepseek-flash', source: 'DeepSeek API docs, models and pricing' },
  // Anthropic models overview: API ids are claude-opus-5-5 and claude-sonnet-5-5.
  'zuri-reason': { id: 'claude-sonnet-5-5', source: 'Anthropic models overview' },
  'zuri-elite': { id: 'claude-opus-5-5', source: 'Anthropic models overview' },
  // Kimi model list: kimi-k3 is current, with kimi-k3.1-pro the newer flagship.
  'zuri-pro': { id: 'kimi-k3', source: 'Kimi API platform model list' },
  'zuri-max': { id: 'glm-5.3', source: 'Z.ai GLM-5.3 docs, which show it in the request body' },
  'zuri-code': { id: 'gpt-6.1-sol', source: 'OpenAI model docs (gpt-5.3-codex is marked Deprecated)' },
};
for (const [code, real] of Object.entries(VERIFIED_MODEL_IDS)) {
  const model = DEFAULT_MODELS.find((entry) => entry.code === code);
  assert.equal(model.supplierModel, real.id, code + ' asks for ' + JSON.stringify(model.supplierModel) + ' but ' + real.source + ' names ' + real.id);
}
// Every id above was read from the supplier's own model documentation, including the
// two that were unconfirmed on the first pass: Z.ai's GLM-5.3 page shows the id in
// the request body, and OpenAI's markdown docs give "Model ID: gpt-6.1-sol" while
// marking gpt-5.3-codex as Deprecated. That is why Zuri Core no longer uses it.
// The image models still name gpt-image-2, which OpenAI lists without a deprecation.

for (const [code, real] of Object.entries(VERIFIED_SUPPLIER_PRICES)) {
  const model = DEFAULT_MODELS.find((entry) => entry.code === code);
  assert.ok(model, `${code} is missing from the catalogue`);
  assert.ok(
    model.outputUsdPerMillion >= real.output,
    `${code} charges customers for replies at ${model.outputUsdPerMillion} but the supplier charges ${real.output} - ${real.source}`,
  );
  assert.ok(
    model.inputUsdPerMillion >= real.input,
    `${code} charges customers for prompts at ${model.inputUsdPerMillion} but the supplier charges ${real.input} - ${real.source}`,
  );
}

// Nothing in the catalogue may be sold below cost at the plan that unlocks it, and
// the margin floor is stated once here rather than implied by four separate numbers.
for (const model of DEFAULT_MODELS.filter((entry) => !isImageModel(entry))) {
  const plan = PLANS.find((entry) => entry.code === model.minPlan);
  const replyTokens = plan.monthlyTokens / model.outputQuotaWeight;
  const costKobo = microUsdToKobo(supplierCostMicroUsd(model, 0, replyTokens), NAIRA_PER_USD);
  const marginPercent = ((plan.amountKobo - costKobo) / plan.amountKobo) * 100;
  assert.ok(
    marginPercent >= 30,
    `${model.code} on ${plan.code} keeps only ${Math.round(marginPercent)}% when the allowance is spent on replies`,
  );
}

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
// Pro and Max share one rate (NGN 6000 per 6 million), so their picture price
// matches. Starter sits a hair under Power because it is priced at NGN 2499 to
// stay below Paystack's NGN 2500 fee threshold, so its pictures cost 13 kobo less.
assert.deepEqual(imageLadder.plans.map((plan) => plan.priceKobo), [32_987, 26_400, 33_000, 26_400]);
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
// The reply weight: 0 and blank both mean "same as prompts", so an older
// dashboard that never sends the field keeps working. Anything else must be a
// weight we can bill at.
assert.equal(validateModelInput({ ...good, outputQuotaWeight: 0 }).ok, true);
assert.equal(validateModelInput({ ...good, outputQuotaWeight: '' }).ok, true);
assert.equal(validateModelInput({ ...good, outputQuotaWeight: undefined }).ok, true);
assert.equal(validateModelInput({ ...good, outputQuotaWeight: 0.05 }).ok, false);
assert.equal(validateModelInput({ ...good, outputQuotaWeight: 101 }).ok, false);
assert.equal(validateModelInput({ ...good, outputQuotaWeight: 'abc' }).ok, false);
const savedReplyWeight = validateModelInput({ ...good, outputQuotaWeight: 8 });
assert.equal(savedReplyWeight.ok, true);
assert.equal(savedReplyWeight.model.outputQuotaWeight, 8);

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
        return { days: 30, users: 5, revenueKobo: 1_000_000, byModel: [{ modelCode: 'zuri-flash', requests: 3, inputTokens: 10, outputTokens: 10, quotaTokens: 20, costMicroUsd: 1_000_000 }], plans: [{ code: 'starter', name: 'Starter', amountKobo: 249900, monthlyTokens: 2000000, subscribers: 4 }] };
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
assert.equal(prices.data[0].plans[0].priceKobo, 5_998);
assert.equal(prices.data[0].plans[0].images, 41);
assert.equal(prices.data[2].plans[0].priceKobo, 89_964);
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
assert.deepEqual(pictureRows.map((model) => model.priceKoboPerImage), [5_998, 26_400, 72_000]);
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

// In production the catalogue a customer sees is read from the database, and the
// database is seeded by db/schema.sql. A name changed in one file and left in the
// other shows a customer a model the code does not agree with - which is exactly how
// the retired "Zuri Code" name survived a rename of the code default. Reading both
// files here keeps them in step, without needing a live database.
{
  const { readFileSync } = await import('node:fs');
  const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

  // Every seeded row starts with its code and its display name.
  const seeded = [...schemaSql.matchAll(/^\s*\('([a-z0-9-]+)',\s*'([^']*)'/gm)];
  for (const [, code, name] of seeded) {
    const model = DEFAULT_MODELS.find((entry) => entry.code === code);
    // The plan and image rows share this shape; only catalogue rows are compared.
    if (model === undefined) continue;
    assert.equal(
      name,
      model.name,
      `schema.sql seeds ${code} as ${JSON.stringify(name)} but the code calls it ${JSON.stringify(model.name)}`,
    );
  }
  // Prove the comparison above actually saw the text models, so it cannot pass by
  // matching nothing at all.
  for (const model of DEFAULT_MODELS) {
    assert.ok(
      seeded.some(([, code]) => code === model.code),
      `schema.sql never seeds ${model.code}, so a fresh deploy would not have it`,
    );
  }

  // A database seeded before the rename keeps the old display name until this runs,
  // and it moves only the seeded name, never one an operator chose in the dashboard.
  assert.match(
    schemaSql,
    /UPDATE models SET name = 'Zuri Core' WHERE code = 'zuri-code' AND name = 'Zuri Code'/,
    'schema.sql must rename an existing Zuri Code row, or a live database keeps the retired name',
  );
  assert.ok(
    !/INSERT INTO models[^;]*'Zuri Code'/.test(schemaSql),
    'schema.sql must not seed the retired Zuri Code name',
  );
}


// The OpenAI-compatible client. Three things are pinned here because all three
// were wrong at once and none of them showed up as a failing request: the tools and
// the converted conversation never reached the supplier, a busy supplier was
// reported as a refusal, and the supplier's own reason was thrown away, so every
// failure read "The AI provider rejected the request".
const readFileTool = {
  name: 'readFile',
  description: 'Read one file.',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
};

let openAiRequest;
const openAi = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async (_url, request) => {
    openAiRequest = { ...request, body: JSON.parse(request.body) };
    return new Response(JSON.stringify({
      id: 'chat_test',
      model: 'deepseek-flash',
      choices: [{ message: { role: 'assistant', content: 'ok', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'readFile', arguments: '{"path":"a.txt"}' } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
const openAiResult = await openAi({
  messages: [
    { role: 'user', content: 'Read a.txt' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'readFile', arguments: '{"path":"a.txt"}' }] },
    { role: 'tool', toolCallId: 'call_1', content: 'file body' },
  ],
  model: 'deepseek-flash',
  maxTokens: 100,
  tools: [readFileTool],
});
assert.equal(openAiRequest.body.tools[0].function.name, 'readFile', 'the tools offered to the model must be sent, not built and dropped');
assert.equal(openAiRequest.body.messages[1].tool_calls[0].id, 'call_1', 'an assistant turn that asked for a tool must carry the call');
assert.equal(openAiRequest.body.messages[2].tool_call_id, 'call_1', 'a tool result must name the call it answers');
assert.equal(openAiResult.toolCalls[0].name, 'readFile');

// DeepSeek Flash thinks in the open before it answers, and refuses the next round unless
// that thinking comes back with the calls. It streams, so the stream must gather it, and
// it must travel inside the assistant turn, not as words the person reads.
let echoedRequest;
const thinkingClient = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body);
    echoedRequest = body;
    const call = { id: 'call_9', type: 'function', function: { name: 'readFile', arguments: JSON.stringify({ path: 'a.txt' }) } };
    // The round that asks for the file is streamed and carries the thinking; the
    // round that answers it is not streamed, so the same stub has to answer both.
    if (body.stream !== true) {
      return new Response(JSON.stringify({
        id: 'chat_x',
        model: 'deepseek-flash',
        choices: [{ message: { role: 'assistant', content: 'Read it.' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const LF = String.fromCharCode(10);
    const frames = [
      { choices: [{ delta: { reasoning_content: 'It needs the file. ' } }] },
      { choices: [{ delta: { reasoning_content: 'So read a.txt.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, function: call.function }] } }] },
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    ];
    const text = frames.map((frame) => 'data: ' + JSON.stringify(frame) + LF + LF).join('') + 'data: [DONE]' + LF + LF;
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  },
});
const painted = [];
const thinkingResult = await thinkingClient({
  messages: [{ role: 'user', content: 'Read a.txt' }],
  model: 'deepseek-flash',
  maxTokens: 100,
  tools: [readFileTool],
  onDelta: (text) => painted.push(text),
});
assert.equal(thinkingResult.reasoningContent, 'It needs the file. So read a.txt.', 'the thinking is gathered from a streamed reply');
assert.equal(painted.length, 0, 'the thinking is never painted as the answer');

// And it goes back on the assistant turn, or the supplier refuses the round.
await thinkingClient({
  messages: [
    { role: 'user', content: 'Read a.txt' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_9', name: 'readFile', arguments: '{"path":"a.txt"}' }], reasoningContent: 'It needs the file. ' },
    { role: 'tool', toolCallId: 'call_9', content: 'body' },
  ],
  model: 'deepseek-flash',
  maxTokens: 100,
  tools: [readFileTool],
});
assert.equal(echoedRequest.messages[1].reasoning_content, 'It needs the file. ', 'the thinking must come back with the call');

/** @returns {Promise<Error | null>} The refusal, or null when the call succeeded. */
async function refusalOf(client, input = {}) {
  try {
    await client({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash', maxTokens: 10, ...input });
    return null;
  } catch (error) {
    return error;
  }
}

const outOfCredit = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 }),
});
const creditError = await refusalOf(outOfCredit);
assert.equal(creditError.code, 'PROVIDER_REQUEST_FAILED');
assert.equal(creditError.reason, 'no_credit');
assert.match(creditError.message, /out of credit/, 'an empty supplier balance must not read as a generic refusal');
assert.match(creditError.message, /Insufficient Balance/, "the supplier's own explanation must be kept");

let busyAttempts = 0;
const busyThenFine = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async () => {
    busyAttempts += 1;
    if (busyAttempts === 1) return new Response(JSON.stringify({ error: { message: 'Server is busy' } }), { status: 503 });
    return new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { role: 'assistant', content: 'second try' } }] }), { status: 200 });
  },
});
const retried = await busyThenFine({ messages: [{ role: 'user', content: 'hi' }], model: 'deepseek-flash', maxTokens: 10 });
assert.equal(busyAttempts, 2, 'a busy supplier must be tried again rather than shown to the person');
assert.equal(retried.content, 'second try');

let keyAttempts = 0;
const badKey = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async () => {
    keyAttempts += 1;
    return new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 });
  },
});
const keyError = await refusalOf(badKey);
assert.equal(keyAttempts, 1, 'a refused key is not worth repeating');
assert.equal(keyError.reason, 'key_rejected');
assert.match(keyError.message, /refused Zuri's key/);

// A supplier can open the stream and only then report the fault.
const failedStream = createDeepSeekClient({
  apiKey: 'test-key',
  fetchImpl: async () => new Response('data: {"error":{"message":"Server overloaded"}}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
});
const streamError2 = await refusalOf(failedStream, { onDelta: () => {} });
assert.equal(streamError2.reason, 'stream_error', 'a fault inside the stream must be reported as one');
assert.match(streamError2.message, /Server overloaded/);

console.log('PASS server models');
