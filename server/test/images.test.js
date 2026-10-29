import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createImageClient, improveImagePrompt } from '../src/images.js';

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');
const user = { id: 'user-1', email: 'user@example.com', status: 'active' };
let planCode = 'pro';
const calls = { reserve: [], commit: [], release: [], image: [], chat: [] };
let imageShouldFail = false;

const repository = {
  async reserveUsage(details) { calls.reserve.push(details); return { id: 'reservation-1' }; },
  async commitUsage(details) { calls.commit.push(details); },
  async releaseUsage(id) { calls.release.push(id); },
};
const auth = {
  async authenticate(token) {
    if (token !== 'good') return null;
    return { user, subscription: { id: 'sub-1', planCode, status: 'active', monthlyTokens: 10_000_000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z') } };
  },
};
const app = createApp({
  auth,
  repository,
  now: fixedNow,
  chatProvider: async (request) => {
    calls.chat.push(request);
    return { model: request.model, content: 'A detailed prompt', usage: { inputTokens: 5, outputTokens: 5 } };
  },
  imageProvider: async (request) => {
    calls.image.push(request);
    if (imageShouldFail) {
      const error = new Error('Supplier down');
      error.code = 'PROVIDER_REQUEST_FAILED';
      throw error;
    }
    return { mime: 'image/png', base64: 'AAAA' };
  },
});

const draw = (body, token = 'good') => app(new Request('https://cloud.example.com/api/images', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));

// Signed out, empty and unknown requests are refused before any supplier is called.
assert.equal((await draw({ prompt: 'a cat', model: 'zuri-canvas' }, 'bad')).status, 401);
assert.equal((await draw({ prompt: '  ', model: 'zuri-canvas' })).status, 400);
assert.equal((await draw({ prompt: 'a cat', model: 'zuri-flash' })).status, 400, 'a chat model cannot draw');
assert.equal((await draw({ prompt: 'a cat', model: 'zuri-canvas', shape: 'wide' })).status, 400);
assert.equal(calls.image.length, 0);

// A plan below the model's tier is told to upgrade and is not charged.
planCode = 'starter';
const tooLow = await draw({ prompt: 'a cat', model: 'zuri-canvas' });
assert.equal(tooLow.status, 403);
assert.equal((await tooLow.json()).error.code, 'PLAN_UPGRADE_REQUIRED');
assert.equal(calls.reserve.length, 0);

// A good request is improved, drawn, charged by the picture and returned once.
planCode = 'pro';
const ok = await draw({ prompt: 'a cat in Lagos', model: 'zuri-canvas', shape: 'landscape' });
assert.equal(ok.status, 200);
const made = (await ok.json()).data;
assert.equal(made.imageBase64, 'AAAA');
assert.equal(made.mime, 'image/png');
assert.equal(made.prompt, 'A detailed prompt', 'the improved prompt is shown back to the person');
assert.equal(calls.image[0].prompt, 'A detailed prompt');
assert.equal(calls.image[0].shape, 'landscape');
assert.equal(calls.image[0].supplier, 'openai');
assert.equal(calls.reserve[0].requestedTokens, 264_000);
assert.equal(calls.commit[0].quotaTokens, 264_000, 'a Canvas picture burns its fixed share of the allowance');
assert.equal(calls.commit[0].modelCode, 'zuri-canvas');
assert.ok(!JSON.stringify(made).includes('gpt-image'), 'the supplier name never reaches the customer');

// The improver can be switched off, and then the person's own words are sent.
await draw({ prompt: 'exactly this', model: 'zuri-canvas', improve: false });
assert.equal(calls.image.at(-1).prompt, 'exactly this');
assert.equal(calls.chat.length, 1, 'no improver call when it is off');

// A supplier failure releases the reservation, so nothing is charged.
imageShouldFail = true;
const releasedBefore = calls.release.length;
const commitsBefore = calls.commit.length;
const failed = await draw({ prompt: 'a dog', model: 'zuri-canvas' });
assert.equal(failed.status, 502);
assert.equal(calls.release.length, releasedBefore + 1);
assert.equal(calls.commit.length, commitsBefore, 'a failed picture is not charged');
imageShouldFail = false;

// The improver never blocks a picture: a failure falls back to the person's words.
const kept = await improveImagePrompt({ chatProvider: async () => { throw new Error('down'); }, prompt: 'my words', supplier: 'zai' });
assert.equal(kept, 'my words');
assert.equal(await improveImagePrompt({ chatProvider: async () => ({ content: '   ' }), prompt: 'my words', supplier: 'zai' }), 'my words');

// The supplier client sends the right size per supplier and refuses a missing key.
const sent = [];
const client = createImageClient({
  openaiApiKey: 'k',
  zaiApiKey: '',
  fetchImpl: async (_url, request) => {
    sent.push(JSON.parse(request.body));
    return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), { status: 200 });
  },
});
const result = await client({ supplier: 'openai', supplierModel: 'gpt-image-2', quality: 'high', shape: 'portrait', prompt: 'p' });
assert.equal(result.base64, 'QUJD');
assert.equal(sent[0].size, '1024x1536');
assert.equal(sent[0].quality, 'high');
await assert.rejects(() => client({ supplier: 'zai', supplierModel: 'cogview-4', quality: 'standard', shape: 'square', prompt: 'p' }), /not switched on/);

console.log('PASS the picture route is paid per picture, keeps nothing and refunds a failure');
