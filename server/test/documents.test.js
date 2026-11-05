import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
// The builders are injected into the app the way server.js injects them, from the
// desktop app's own module, so this test proves the real files come out of the route.
import { buildOfficeFile, reviewOfficeContent } from '../../src/main/office.js';

const TOKEN = 'session-token';
const fixedNow = () => new Date('2026-10-29T10:00:00.000Z');

let subscriptionStatus = 'active';
const auth = {
  async authenticate(token) {
    if (token !== TOKEN) return null;
    return {
      user: { id: 'user-1', email: 'person@example.com' },
      subscription: {
        id: 'subscription-1',
        planCode: 'starter',
        status: subscriptionStatus,
        monthlyTokens: 2_000_000,
        currentPeriodStart: fixedNow(),
        currentPeriodEnd: new Date('2026-11-29T10:00:00.000Z'),
      },
    };
  },
};

const app = createApp({ auth, repository: {}, now: fixedNow, officeBuilder: { build: buildOfficeFile, review: reviewOfficeContent } });

/** @param {unknown} body @param {string} [token] @param {Function} [handler] */
function post(body, token = TOKEN, handler = app) {
  const headers = { 'content-type': 'application/json' };
  if (token !== '') headers.authorization = `Bearer ${token}`;
  return handler(new Request('https://cloud.example.com/api/tools/create-document', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

const DECK = { title: 'Deck', slides: [{ title: 'One', bullets: ['a', 'b'] }] };

// Each kind comes back as a real Office package: a ZIP, named for what was asked.
for (const [kind, content, mime] of [
  ['docx', { title: 'Plan', sections: [{ heading: 'Intro', paragraphs: ['Hello **world**'] }] }, 'wordprocessingml'],
  ['xlsx', { sheets: [{ name: 'Budget', columns: ['Item', 'Cost'], rows: [['Rent', 100]] }] }, 'spreadsheetml'],
  ['pptx', DECK, 'presentationml'],
]) {
  const made = await post({ kind, fileName: '..\\evil:name', content });
  assert.equal(made.status, 200, `${kind} is built`);
  const { data } = await made.json();
  assert.equal(data.kind, kind);
  assert.ok(data.name.endsWith(`.${kind}`), 'the name carries the extension');
  assert.ok(!/[\\/:]/.test(data.name), 'the name has no path or reserved characters');
  assert.ok(data.mime.includes(mime), 'the MIME type matches the kind');
  const bytes = Buffer.from(data.base64, 'base64');
  assert.equal(bytes.length, data.bytes);
  if (kind === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'pdf has a valid header');
  else assert.equal(bytes.subarray(0, 2).toString(), 'PK', `${kind} is a ZIP package`);
  assert.ok(Array.isArray(data.warnings));
}

const pdfApp = createApp({ auth, repository: {}, now: fixedNow, officeBuilder: { build: buildOfficeFile, review: reviewOfficeContent } });
const pdfResponse = await post({ kind: 'pdf', fileName: 'plan.pdf', content: { title: 'Plan', sections: [{ heading: 'Intro', paragraphs: ['Hello world'] }] } }, TOKEN, pdfApp);
assert.equal(pdfResponse.status, 200, 'pdf is built');
const pdfData = (await pdfResponse.json()).data;
assert.equal(pdfData.mime, 'application/pdf');
assert.equal(Buffer.from(pdfData.base64, 'base64').subarray(0, 5).toString(), '%PDF-');

// Content as a JSON string is accepted, as some suppliers send it.
assert.equal((await post({ kind: 'pptx', content: JSON.stringify(DECK) })).status, 200);

// Providers sometimes call the Word format "word" and flatten the document body.
// The route normalises those equivalent shapes before the builder sees them.
const wordAlias = await post({
  format: 'word',
  title: 'Alias plan',
  sections: [{ heading: 'Intro', paragraphs: ['Created through the tolerant boundary.'] }],
}, TOKEN, createApp({ auth, repository: {}, now: fixedNow, officeBuilder: { build: buildOfficeFile, review: reviewOfficeContent } }));
assert.equal(wordAlias.status, 200, 'the Word alias is accepted');
assert.equal((await wordAlias.json()).data.kind, 'docx');

// What will read badly is reported, not hidden.
const weak = await (await post({ kind: 'pptx', content: { title: 'Deck', slides: [{ title: 'Empty' }] } })).json();
assert.ok(weak.data.warnings.some((warning) => /nothing under it/.test(warning)), 'a slide with no body is flagged');

// Refusals are plain sentences with a code, never a stack trace.
const unknown = await post({ kind: 'exe', content: {} });
assert.equal(unknown.status, 400);
assert.equal((await unknown.json()).error.code, 'INVALID_KIND');
const noContent = await post({ kind: 'docx', content: 'not json' });
assert.equal(noContent.status, 400);
assert.equal((await noContent.json()).error.code, 'INVALID_CONTENT');
const empty = await post({ kind: 'docx', content: {} });
assert.equal(empty.status, 400, 'a document with nothing in it is refused');
assert.match((await empty.json()).error.message, /title or at least one section/);
const broken = await post('{not json');
assert.equal(broken.status, 400);

// Account rules: signed in and on a paid plan, like the other tools.
assert.equal((await post({ kind: 'docx', content: {} }, '')).status, 401);
assert.equal((await post({ kind: 'docx', content: {} }, 'other-token')).status, 401);
subscriptionStatus = 'canceled';
const lapsed = await post({ kind: 'pptx', content: DECK });
assert.equal(lapsed.status, 402);
assert.equal((await lapsed.json()).error.code, 'SUBSCRIPTION_REQUIRED');
subscriptionStatus = 'active';

// A deployment without the builders says so instead of failing.
const bare = createApp({ auth, repository: {}, now: fixedNow });
const notConfigured = await post({ kind: 'pptx', content: DECK }, TOKEN, bare);
assert.equal(notConfigured.status, 503);
assert.equal((await notConfigured.json()).error.code, 'TOOLS_NOT_CONFIGURED');

// A builder that throws something unexpected is logged and answered with a safe sentence.
const failing = createApp({ auth, repository: {}, now: fixedNow, officeBuilder: { build: async () => { throw new Error('secret internals'); } } });
const originalError = console.error;
console.error = () => {};
const failed = await post({ kind: 'pptx', content: DECK }, TOKEN, failing);
console.error = originalError;
assert.equal(failed.status, 500);
const failure = await failed.json();
assert.equal(failure.error.code, 'DOCUMENT_FAILED');
assert.ok(!JSON.stringify(failure).includes('secret internals'), 'internal error text is not echoed');

// An account cannot flood the builders: the sixth request in a minute is refused.
const limited = createApp({ auth, repository: {}, now: fixedNow, officeBuilder: { build: buildOfficeFile } });
for (let index = 0; index < 6; index += 1) {
  assert.equal((await post({ kind: 'pptx', content: DECK }, TOKEN, limited)).status, 200, `request ${index + 1} is allowed`);
}
const refused = await post({ kind: 'pptx', content: DECK }, TOKEN, limited);
assert.equal(refused.status, 429);
assert.equal((await refused.json()).error.code, 'RATE_LIMITED');

console.log('documents.test.js passed');
