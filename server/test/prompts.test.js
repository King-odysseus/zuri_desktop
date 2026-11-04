import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ENHANCER_GUIDE, enhancePrompt, readEnhancerReply } from '../src/prompts.js';

const fixedNow = () => new Date('2026-11-04T12:00:00.000Z');
const user = { id: 'user-1', email: 'user@example.com', status: 'active' };
let planCode = 'pro';
let status = 'active';
const calls = [];
// What the stand-in model says. An array is read one entry per call, so a test can
// give the first attempt one reply and the retry another.
let reply = [
  'PROMPT:',
  'Write a three line note to [name] asking to move Thursday 14:00 to Friday 10:00.',
  '',
  'SUGGESTIONS:',
  '- Name: who the note is going to.',
  '- Say whether the new time is fixed.',
].join('\n');
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
    const content = Array.isArray(reply) ? reply.shift() ?? '' : reply;
    return { model: request.model, content, usage: { inputTokens: 5, outputTokens: 5 } };
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

// A good message comes back rewritten, with the additions kept apart from it and the
// person's own words kept for undo.
const ok = await improve({ prompt: 'move my meeting to friday' });
assert.equal(ok.status, 200);
const data = (await ok.json()).data;
assert.equal(data.prompt, 'Write a three line note to [name] asking to move Thursday 14:00 to Friday 10:00.');
assert.deepEqual(data.suggestions, ['Name: who the note is going to.', 'Say whether the new time is fixed.']);
assert.equal(data.original, 'move my meeting to friday');
assert.equal(calls.length, 1, 'a well shaped reply costs one call');
assert.equal(calls[0].model, 'deepseek-flash', 'the cheapest model does the rewriting');
assert.equal(calls[0].messages[0].content, ENHANCER_GUIDE);
assert.equal(calls[0].messages[1].content, 'move my meeting to friday');

// The guide has to hold the line that matters: edit the words, never answer them.
assert.match(ENHANCER_GUIDE, /Never answer the message/);
assert.match(ENHANCER_GUIDE, /never put any part of an answer here/i);
assert.match(ENHANCER_GUIDE, /PROMPT:/);
assert.match(ENHANCER_GUIDE, /SUGGESTIONS:/);

// A model that answers the message instead of editing it never reaches the message
// box: the reply is asked for once more, and then refused.
calls.length = 0;
reply = [
  'Here is a budget tracker for you.',
  '',
  '1. Open a spreadsheet and add a column for each month.',
  '2. Total the spending column and subtract it from the budget.',
].join('\n');
const answered = await improve({ prompt: 'make a budget tracker' });
assert.equal(answered.status, 502);
assert.equal((await answered.json()).error.code, 'ENHANCE_FAILED');
assert.equal(calls.length, 2, 'the shape is asked for once more, then refused');

// A supplier failure is reported, never hidden: the person pressed a button and is
// waiting, so handing back their own words would look like nothing happened.
providerShouldFail = true;
const failed = await improve({ prompt: 'move my meeting' });
assert.equal(failed.status, 502);
assert.equal((await failed.json()).error.code, 'ENHANCE_FAILED');
providerShouldFail = false;

// The reply is read as two blocks: a preface or an answer before the first marker is
// dropped, and the additions are cleaned into lines worth adding.
const read = readEnhancerReply([
  'Sure. Here is a clearer prompt for you.',
  '',
  '**PROMPT:**',
  'Draft a budget tracker for [audience].',
  '',
  '**Suggestions:**',
  '1. By when: [date]',
  '- By when: [date]',
  '* Show a chart of spend by month.',
  '- Add a line naming the currency.',
  '- A fourth line that must be dropped by the cap.',
  '- ',
].join('\n'));
assert.equal(read.shaped, true);
assert.equal(read.prompt, 'Draft a budget tracker for [audience].');
assert.deepEqual(read.suggestions, ['By when: [date]', 'Show a chart of spend by month.', 'Add a line naming the currency.']);

// A bare rewrite with no blocks is not shaped, so it is never mistaken for an answer
// that passed the check.
assert.equal(readEnhancerReply('A clearer ask.').shaped, false);

// Wrappers a model likes to add are removed, and an empty rewrite is an error.
const wrapped = await enhancePrompt({
  chatProvider: async () => ({ content: 'PROMPT:\n```\nA clearer ask.\n```\nSUGGESTIONS:\n- By when: [date]' }),
  prompt: 'x',
});
assert.equal(wrapped.prompt, 'A clearer ask.');
assert.deepEqual(wrapped.suggestions, ['By when: [date]']);
const quoted = await enhancePrompt({
  chatProvider: async () => ({ content: 'PROMPT:\n"A clearer ask."' }),
  prompt: 'x',
});
assert.equal(quoted.prompt, 'A clearer ask.');
assert.deepEqual(quoted.suggestions, []);
await assert.rejects(() => enhancePrompt({ chatProvider: async () => ({ content: '   ' }), prompt: 'x' }), /sent back nothing/);
await assert.rejects(() => enhancePrompt({ chatProvider: undefined, prompt: 'x' }), /not switched on/);
await assert.rejects(
  () => enhancePrompt({ chatProvider: async () => ({ content: 'Here is your plan: 1. Start with a spreadsheet.' }), prompt: 'x' }),
  (error) => error.code === 'ENHANCER_FORMAT',
);

console.log('PASS the prompt enhancer rewrites a message and suggests additions, never answers it, and refuses an unshaped reply');
