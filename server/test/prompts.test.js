import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ENHANCER_GUIDE, enhancePrompt } from '../src/prompts.js';

const fixedNow = () => new Date('2026-11-04T12:00:00.000Z');
const user = { id: 'user-1', email: 'user@example.com', status: 'active' };
let planCode = 'pro';
let status = 'active';
const calls = [];
let reply = 'Write a three line note to [name] asking to move Thursday 14:00 to Friday 10:00.';
let providerShouldFail = false;

const repository = {
  async reserveUsage() { throw new Error('the enhancer must not reserve usage'); },
};
const auth = {
  async authenticate(token) {
    if (token !== 'good') return null;
    return { user, subscription: { id: 'sub-1', planCode, status, monthlyTokens: 10_000_000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-12-04T12:00:00.000Z') } };
  },
};
const app = createApp({
  auth,
  repository,
  now: fixedNow,
  chatProvider: async (request) => {
    calls.push(request);
    if (providerShouldFail) {
      const error = new Error('Supplier down');
      error.code = 'PROVIDER_REQUEST_FAILED';
      throw error;
    }
    return { model: request.model, content: reply, usage: { inputTokens: 5, outputTokens: 5 } };
  },
});

const improve = (body, token = 'good') => app(new Request('https://cloud.example.com/api/prompts/enhance', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));

// Signed out and empty messages are refused before a model is called.
assert.equal((await improve({ prompt: 'move my meeting' }, 'bad')).status, 401);
assert.equal((await improve({ prompt: '   ' })).status, 400);
assert.equal(calls.length, 0);

// A subscription that cannot chat cannot spend a model call on phrasing the chat either.
status = 'canceled';
const unpaid = await improve({ prompt: 'move my meeting' });
assert.equal(unpaid.status, 402);
assert.equal((await unpaid.json()).error.code, 'SUBSCRIPTION_REQUIRED');
assert.equal(calls.length, 0);
status = 'active';

// A good message comes back rewritten, with the person's own words kept for undo.
const ok = await improve({ prompt: 'move my meeting to friday' });
assert.equal(ok.status, 200);
const data = (await ok.json()).data;
assert.equal(data.prompt, reply);
assert.equal(data.original, 'move my meeting to friday');
assert.equal(calls.length, 1);
assert.equal(calls[0].model, 'deepseek-flash', 'the cheapest model does the rewriting');
assert.equal(calls[0].messages[0].content, ENHANCER_GUIDE);
assert.equal(calls[0].messages[1].content, 'move my meeting to friday');

// A supplier failure is reported, never hidden: the person pressed a button and is
// waiting, so handing back their own words would look like nothing happened.
providerShouldFail = true;
const failed = await improve({ prompt: 'move my meeting' });
assert.equal(failed.status, 502);
assert.equal((await failed.json()).error.code, 'ENHANCE_FAILED');
providerShouldFail = false;

// Wrappers a model likes to add are removed, and an empty rewrite is an error.
assert.equal(await enhancePrompt({ chatProvider: async () => ({ content: '```\nA clearer ask.\n```' }), prompt: 'x' }), 'A clearer ask.');
assert.equal(await enhancePrompt({ chatProvider: async () => ({ content: '"A clearer ask."' }), prompt: 'x' }), 'A clearer ask.');
await assert.rejects(() => enhancePrompt({ chatProvider: async () => ({ content: '   ' }), prompt: 'x' }), /sent back nothing/);
await assert.rejects(() => enhancePrompt({ chatProvider: undefined, prompt: 'x' }), /not switched on/);

console.log('PASS the prompt enhancer rewrites a message, refuses an unsubscribed account and reports a failure');
