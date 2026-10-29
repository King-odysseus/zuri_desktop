import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

// The route under test is the only one touched here, so auth is a stub that answers
// for one token, and `fetch` is stubbed the same way the other suites stub
// `chatProvider`: injected through createApp, never the real network.
const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
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

// Two results, written the way DuckDuckGo's no-JavaScript page writes them: a
// `result__a` title, an `uddg` redirect for the address, and a `result__snippet`
// anchor that may contain markup of its own.
const RESULT_PAGE = `<!DOCTYPE html><html><body>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide%3Fa%3D1&amp;rut=abc">Example &amp; guide</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide%3Fa%3D1">A <b>short</b> summary
    of the guide.</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fstory">Second story</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fstory">Another one.</a>
</div>
</body></html>`;

const calls = [];
let reply = async () => new Response(RESULT_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const app = createApp({
  auth,
  repository: {},
  now: fixedNow,
  fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return reply(String(url), init);
  },
});

/** @param {unknown} body @param {string} [token] */
function post(body, token = TOKEN) {
  const headers = { 'content-type': 'application/json' };
  if (token !== '') headers.authorization = `Bearer ${token}`;
  return app(new Request('https://cloud.example.com/api/tools/web-search', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

// No token: the search is behind the same sign-in as everything else.
{
  const anonymous = await post({ query: 'lagos weather' }, '');
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'AUTH_REQUIRED');
  assert.equal(calls.length, 0, 'an anonymous request never reaches the search engine');
}

// A lapsed account: a search costs this server a request, so it is not free.
{
  subscriptionStatus = 'pending';
  const lapsed = await post({ query: 'lagos weather' });
  assert.equal(lapsed.status, 402);
  assert.equal((await lapsed.json()).error.code, 'SUBSCRIPTION_REQUIRED');
  assert.equal(calls.length, 0);
  subscriptionStatus = 'active';
}

// The query itself: empty, and whitespace that trims to empty, are both refused
// before anything is sent to the engine.
{
  for (const query of ['', '    ', '\n\t ']) {
    const refused = await post({ query });
    assert.equal(refused.status, 400, `${JSON.stringify(query)} is not a search`);
    assert.equal((await refused.json()).error.code, 'INVALID_QUERY');
  }
  const oneCharacter = await post({ query: 'a' });
  assert.equal(oneCharacter.status, 400, 'a single character is below the minimum');
  const notAString = await post({ query: 42 });
  assert.equal(notAString.status, 400);
  const tooLong = await post({ query: 'x'.repeat(401) });
  assert.equal(tooLong.status, 400, 'over the maximum is refused rather than truncated');
  assert.equal(calls.length, 0);
}

// The happy path: the body is trimmed, the results come back as plain text, and
// HTML entities in a title are decoded rather than returned raw.
{
  const response = await post({ query: '  lagos weather  ' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.query, 'lagos weather');
  assert.deepEqual(body.data.results, [
    {
      title: 'Example & guide',
      url: 'https://example.com/guide?a=1',
      snippet: 'A short summary of the guide.',
    },
    {
      title: 'Second story',
      url: 'https://news.example.com/story',
      snippet: 'Another one.',
    },
  ]);
  assert.equal(calls.length, 1);
  // The address the server asked for is the fixed endpoint, with the query in `q`
  // and nothing of the request's own choosing in it.
  const asked = new URL(calls[0].url);
  assert.ok(calls[0].url.startsWith(SEARCH_ENDPOINT), `asked ${calls[0].url}`);
  assert.equal(asked.searchParams.get('q'), 'lagos weather');
  assert.equal(asked.origin, 'https://html.duckduckgo.com');
}

// At most eight results are returned, however many the page holds.
{
  const many = Array.from({ length: 12 }, (_, index) => (
    `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F${index}">Result ${index}</a>`
  )).join('\n');
  const previousReply = reply;
  reply = async () => new Response(`<html><body>${many}</body></html>`, { status: 200 });
  const capped = await (await post({ query: 'many results' })).json();
  assert.equal(capped.data.results.length, 8);
  assert.equal(capped.data.results[0].url, 'https://example.com/0');
  reply = previousReply;
}

// The engine answering 500 is a bad gateway for the customer, not a crash, and the
// engine's own page never travels back in the message.
{
  const previousReply = reply;
  reply = async () => new Response('<html><body>internal error</body></html>', { status: 500 });
  const failed = await post({ query: 'lagos weather' });
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.equal(body.error.code, 'SEARCH_FAILED');
  assert.ok(!body.error.message.includes('<'), 'the message is a sentence, not markup');
  assert.ok(!JSON.stringify(body).includes('internal error'));
  reply = previousReply;
}

// A network failure is the same answer: 502 with a code, thrown nowhere.
{
  const previousReply = reply;
  reply = async () => {
    throw new TypeError('fetch failed');
  };
  const unreachable = await post({ query: 'lagos weather' });
  assert.equal(unreachable.status, 502);
  assert.equal((await unreachable.json()).error.code, 'SEARCH_FAILED');
  reply = previousReply;
}

// A page that holds no results markup is reported as unreadable rather than as
// "nothing found", so a captive portal cannot look like an empty search.
{
  const previousReply = reply;
  reply = async () => new Response('plain text, no markup at all', { status: 200 });
  const unreadable = await post({ query: 'lagos weather' });
  assert.equal(unreadable.status, 502);
  assert.equal((await unreadable.json()).error.code, 'SEARCH_INVALID_RESPONSE');
  reply = previousReply;
}

// One account cannot hammer the engine: the fixed per-account ceiling answers 429
// with a retry hint once it is spent. Ten searches a minute is the configured
// ceiling, so the tenth is allowed and the eleventh is refused.
{
  // A fresh app, so this test does not depend on the requests above.
  const hammered = createApp({
    auth,
    repository: {},
    now: fixedNow,
    fetch: async () => new Response(RESULT_PAGE, { status: 200 }),
  });
  const ask = () => hammered(new Request('https://cloud.example.com/api/tools/web-search', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'lagos weather' }),
  }));
  for (let index = 0; index < 10; index += 1) {
    assert.equal((await ask()).status, 200, `request ${index + 1} is allowed`);
  }
  const refused = await ask();
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).error.code, 'RATE_LIMITED');
  assert.equal(refused.headers.get('retry-after'), '60');
}
