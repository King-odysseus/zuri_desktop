import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAutomationScheduler, checkedCadence, firstRunAt, nextRunAfter, runAutomation } from '../src/automations.js';
import { createMailer, automationResultBody, automationResultSubject } from '../src/mail.js';

const now = new Date('2026-10-29T12:00:00.000Z');

assert.deepEqual(checkedCadence({ type: 'interval', minutes: 30 }), {
  ok: true,
  type: 'interval',
  intervalMinutes: 30,
  timeOfDay: null,
  at: null,
});
assert.equal(checkedCadence({ type: 'interval', minutes: 14 }).ok, false);
assert.equal(checkedCadence({ type: 'daily', timeOfDay: '24:00' }).ok, false);
assert.equal(checkedCadence({ type: 'once', at: 'not-a-date' }).ok, false);
assert.equal(firstRunAt({ type: 'interval', intervalMinutes: 30 }, now), '2026-10-29T12:30:00.000Z');
assert.equal(firstRunAt({ type: 'daily', timeOfDay: '11:00' }, now), '2026-10-30T11:00:00.000Z');
assert.equal(nextRunAfter({ type: 'once' }, now), null);
assert.equal(nextRunAfter({ type: 'daily', timeOfDay: '13:00' }, now), '2026-10-29T13:00:00.000Z');
console.log('PASS automation cadence validation and arithmetic');

const session = { user: { id: 'user-a', email: 'a@example.com' }, subscription: { status: 'active', planCode: 'starter' } };
const automations = new Map();
const runs = new Map();
let sequence = 0;
const repository = {
  async listAutomations(userId) {
    return [...automations.values()].filter((row) => row.userId === userId);
  },
  async createAutomation(input) {
    const row = {
      id: `automation-${++sequence}`,
      ...input,
      cadence: input.cadenceType === 'daily'
        ? { type: 'daily', timeOfDay: input.timeOfDay }
        : input.cadenceType === 'interval'
          ? { type: 'interval', minutes: input.intervalMinutes }
          : { type: 'once', at: input.nextRunAt },
      enabled: true,
      deliverEmail: input.deliverEmail === true,
      nextRunAt: input.nextRunAt,
    };
    automations.set(row.id, row);
    return row;
  },
  async updateAutomation({ userId, id, enabled, nextRunAt }) {
    const row = automations.get(id);
    if (!row || row.userId !== userId) return null;
    row.enabled = enabled;
    if (nextRunAt !== undefined) row.nextRunAt = nextRunAt;
    return row;
  },
  async deleteAutomation({ userId, id }) {
    const row = automations.get(id);
    if (!row || row.userId !== userId) return 0;
    automations.delete(id);
    return 1;
  },
  async listAutomationRuns({ userId, automationId }) {
    const row = automations.get(automationId);
    return row?.userId === userId ? [...runs.values()].filter((run) => run.automationId === automationId) : [];
  },
};
const auth = { authenticate: async (token) => token === 'token-a' ? session : token === 'token-b' ? { user: { id: 'user-b' }, subscription: session.subscription } : null };
const app = createApp({ auth, repository, now: () => now });
const request = (method, path, body, token = 'token-a') => app(new Request(`https://cloud.example.com${path}`, {
  method,
  headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
}));

assert.equal((await request('GET', '/api/automations', undefined, 'none')).status, 401);
const created = await request('POST', '/api/automations', {
  prompt: 'Check project manager jobs in Scotland',
  cadence: { type: 'daily', timeOfDay: '07:30' },
  deliverEmail: true,
});
assert.equal(created.status, 200);
const createdBody = (await created.json()).data.automation;
assert.equal(createdBody.cadence.timeOfDay, '07:30');
assert.equal(createdBody.deliverEmail, true);
const listed = await request('GET', '/api/automations');
assert.deepEqual((await listed.json()).data.automations.map((row) => row.id), [createdBody.id]);
const foreignPatch = await request('PATCH', `/api/automations/${createdBody.id}`, { enabled: false }, 'token-b');
assert.equal(foreignPatch.status, 404);
const paused = await request('PATCH', `/api/automations/${createdBody.id}`, { enabled: false });
assert.equal((await paused.json()).data.automation.enabled, false);
const history = await request('GET', `/api/automations/${createdBody.id}/runs`);
assert.deepEqual((await history.json()).data.runs, []);
const removed = await request('DELETE', `/api/automations/${createdBody.id}`);
assert.equal((await removed.json()).data.id, createdBody.id);
console.log('PASS automation routes are authenticated and account-scoped');

const usageCalls = [];
const searches = [];
const providerReplies = [
  {
    model: 'supplier-model',
    content: '',
    reasoningContent: '',
    toolCalls: [{ id: 'call-1', name: 'webSearch', arguments: JSON.stringify({ query: 'project manager jobs Scotland' }) }],
    usage: { inputTokens: 10, outputTokens: 4 },
  },
  { model: 'supplier-model', content: 'Found two current listings.', toolCalls: [], usage: { inputTokens: 30, outputTokens: 12 } },
];
const runRepository = {
  async reserveUsage(input) { usageCalls.push(['reserve', input]); return { id: `reservation-${usageCalls.length}` }; },
  async commitUsage(input) { usageCalls.push(['commit', input]); },
  async releaseUsage(input) { usageCalls.push(['release', input]); },
};
const outcome = await runAutomation({
  automation: { id: 'automation-run', userId: 'user-a', prompt: 'Check jobs', cadence: { type: 'daily', timeOfDay: '07:00' } },
  owner: { subscriptionId: 'subscription-a', planCode: 'starter' },
  repository: runRepository,
  chatProvider: async (input) => { assert.equal(input.tools[0].name, 'webSearch'); return providerReplies.shift(); },
  searchWeb: async (input) => { searches.push(input); return { query: input.query, results: [{ title: 'Role', url: 'https://jobs.example/1', snippet: 'A current role.' }] }; },
  models: [{ code: 'zuri-flash', supplierModel: 'supplier-model', supplier: 'deepseek', minPlan: 'starter', rateFactor: 1, isActive: true, inputUsdPerMillion: 1, outputUsdPerMillion: 1 }],
  now: () => now,
});
assert.deepEqual(outcome, { status: 'ok', text: 'Found two current listings.', error: '', searches: 1 });
assert.deepEqual(searches, [{ query: 'project manager jobs Scotland' }]);
assert.equal(usageCalls.filter(([kind]) => kind === 'commit').length, 2);
console.log('PASS an automation run searches, then answers and records usage');

// A silent round used to end the whole run as failed. It is asked once more with no
// tools, and a search written into the text as markup is never saved as the answer.
{
  const models = [{ code: 'zuri-flash', supplierModel: 'supplier-model', supplier: 'deepseek', minPlan: 'starter', rateFactor: 1, isActive: true, inputUsdPerMillion: 1, outputUsdPerMillion: 1 }];
  const quietRepository = {
    async reserveUsage() { return { id: 'quiet-reservation' }; },
    async commitUsage() {},
    async releaseUsage() {},
  };
  const run = (replies, seen = []) => runAutomation({
    automation: { id: 'automation-quiet', userId: 'user-a', prompt: 'Check jobs', cadence: { type: 'daily', timeOfDay: '07:00' } },
    owner: { subscriptionId: 'subscription-a', planCode: 'starter' },
    repository: quietRepository,
    chatProvider: async (input) => { seen.push(input); return replies.shift(); },
    searchWeb: async () => ({ query: '', results: [] }),
    models,
    now: () => now,
  });
  const usage = { inputTokens: 5, outputTokens: 1 };
  const markup = '<tool_call>{"name": "webSearch", "arguments": {"query": "jobs"}}</tool_call>';

  const seen = [];
  const recovered = await run([
    { model: 'supplier-model', content: '', toolCalls: [], usage },
    { model: 'supplier-model', content: 'Two roles found.', toolCalls: [], usage },
  ], seen);
  assert.equal(recovered.status, 'ok');
  assert.equal(recovered.text, 'Two roles found.');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].tools.length, 0, 'the retry offers no tools');

  const markupOnly = await run([
    { model: 'supplier-model', content: markup, toolCalls: [], usage },
    { model: 'supplier-model', content: 'Nothing new today.', toolCalls: [], usage },
  ]);
  assert.equal(markupOnly.text, 'Nothing new today.', 'raw markup is never the saved answer');

  const stubborn = await run([
    { model: 'supplier-model', content: '', toolCalls: [], usage },
    { model: 'supplier-model', content: markup, toolCalls: [], usage },
  ]);
  assert.equal(stubborn.status, 'failed');
  assert.equal(stubborn.text, '');
  console.log('PASS a silent automation round is asked again before the run is called failed');
}

const settled = [];
const sent = [];
const schedulerRepository = {
    async claimDueAutomations() { return [{ id: 'automation-1', userId: 'user-a', prompt: 'Check jobs', cadence: { type: 'once', at: now.toISOString() }, deliverEmail: true }]; },
    async findAutomationOwner() { return { email: 'a@example.com', subscriptionId: 'subscription-a', planCode: 'starter' }; },
    async reserveUsage() { return { id: 'scheduler-reservation' }; },
    async commitUsage() {},
    async releaseUsage() {},
    async startAutomationRun() { return 'run-1'; },
    async finishAutomationRun(input) { runs.set('run-1', input); },
    async settleAutomation(input) { settled.push(input); },
};
const scheduler = createAutomationScheduler({
  repository: schedulerRepository,
  chatProvider: async () => ({ model: 'supplier-model', content: 'Done', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }),
  searchWeb: async () => ({ query: '', results: [] }),
  mailer: { async sendAutomationResult(input) { sent.push(input); } },
  loadModels: async () => [{ code: 'zuri-flash', supplierModel: 'supplier-model', supplier: 'deepseek', minPlan: 'starter', rateFactor: 1, isActive: true, inputUsdPerMillion: 1, outputUsdPerMillion: 1 }],
  now: () => now,
});
assert.deepEqual(await scheduler.sweepOnce(), { ran: 1 });
assert.equal(runs.get('run-1').status, 'ok');
assert.equal(settled[0].nextRunAt, null);
assert.deepEqual(sent, [{ to: 'a@example.com', prompt: 'Check jobs', text: 'Done', failure: '' }]);
console.log('PASS automation scheduler can be constructed with result delivery');

assert.equal(automationResultSubject('Check project manager jobs').startsWith('Zuri: Check'), true);
assert.match(automationResultBody({ prompt: 'Check jobs', text: 'Found a role.' }), /Found a role\./);
let mailRequest;
const mailer = createMailer({ apiKey: 'key', from: 'zuri@example.com', fetchImpl: async (_url, options) => { mailRequest = JSON.parse(options.body); return { ok: true, async json() { return { messageId: 'msg-1' }; } }; } });
const mailResult = await mailer.sendAutomationResult({ to: 'a@example.com', prompt: 'Check jobs', text: 'Found a role.' });
assert.deepEqual(mailResult, { sent: true, id: 'msg-1' });
assert.equal(mailRequest.subject, 'Zuri: Check jobs');
assert.match(mailRequest.textContent, /Found a role\./);
console.log('PASS automation result email is plain text and uses the prompt in its subject');

