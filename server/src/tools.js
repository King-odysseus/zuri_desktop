/**
 * Server-side web search for the cloud.
 *
 * A browser page cannot query a search engine directly: the engine sends no
 * cross-origin headers, so the request is blocked before it leaves. The server
 * therefore runs the search and hands back plain text.
 *
 * The search endpoint is a constant and the query is the only input, so there is
 * no caller-supplied URL here. That is deliberate: it is what keeps this file
 * free of server-side request forgery, and it must stay that way. Anything that
 * needs a user-supplied address is a different feature with its own allow-list.
 *
 * The parsing is ported from the desktop app (src/main/tools/index.js), which has
 * been reading DuckDuckGo's HTML page for a while. The parts that only made sense
 * in the main process (tool errors, a caller-chosen result limit) are dropped.
 */

/** DuckDuckGo's no-JavaScript results page. Fixed on purpose: see the note above. */
export const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';

/** Enough for a person to pick from, few enough to keep the reply small. */
export const SEARCH_LIMIT = 8;

const SEARCH_TIMEOUT_MS = 15_000;
// 2 MB. A results page is tens of kilobytes; the cap exists so a redirect to
// something enormous cannot be buffered into the server's memory.
const SEARCH_BODY_LIMIT = 2 * 1024 * 1024;
const TITLE_LIMIT = 200;
const SNIPPET_LIMIT = 400;
const URL_LIMIT = 500;
const USER_AGENT = 'Zuri/0.1 (cloud search)';
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * An error carrying a code the route can map to a status. The message is for the
 * log; the route writes its own wording for the person, so nothing from the
 * engine's own page is ever echoed back.
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function searchError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Decode the entities that matter for titles and snippets. Deliberately small: a
 * full decoder belongs to a library that is not installed.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/**
 * Flatten a fragment of HTML to readable text. Good enough for a result title or
 * snippet, not for reading a layout.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  const withoutNoise = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const spaced = withoutNoise.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(spaced).replace(/\s+/g, ' ').trim();
}

/**
 * Turn a result href into the page it points at. DuckDuckGo wraps results in
 * `/l/?uddg=<encoded>` redirects, so the real target has to be unwrapped, and only
 * http/https survives: a `javascript:` or `data:` href never reaches the client.
 * @param {string} href
 * @returns {string | null}
 */
function searchResultUrl(href) {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  const target = parsed.searchParams.get('uddg');
  if (target) {
    try {
      const decoded = new URL(target);
      return WEB_PROTOCOLS.has(decoded.protocol) ? decoded.toString() : null;
    } catch {
      return null;
    }
  }
  return WEB_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
}

/**
 * Extract { title, url, snippet } from a DuckDuckGo HTML results page.
 *
 * Narrow on purpose: it reads the two result classes, then falls back to any
 * anchor carrying an `uddg` redirect, so a markup change degrades to fewer
 * results instead of throwing. Hrefs are decoded before they are parsed, because
 * an entity inside the address would otherwise end up in the URL that is sent to
 * the client.
 * @param {string} html
 * @returns {{ title: string, url: string | null, snippet: string }[]}
 */
export function parseSearchResults(html) {
  const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (match) => htmlToText(match[1]),
  );

  let anchors = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  if (anchors.length === 0) {
    anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  }

  return anchors
    .map((match, index) => ({
      title: htmlToText(match[2]),
      url: searchResultUrl(decodeHtmlEntities(match[1])),
      snippet: snippets[index] ?? '',
    }))
    .filter((result) => result.url !== null && result.title !== '');
}

/**
 * Read a response body as UTF-8 text, stopping at a byte ceiling.
 *
 * The page is decoded as it arrives rather than with `response.text()`, so a
 * misbehaving response is dropped at the cap instead of being buffered whole.
 * @param {Response} response
 * @param {number} limit
 * @returns {Promise<string>}
 */
async function readCappedText(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    received += value.byteLength;
    if (received > limit) {
      // Cancel rather than drain: the rest of the page is of no use now.
      await reader.cancel().catch(() => {});
      throw searchError('SEARCH_INVALID_RESPONSE', 'The search service returned a page too large to read.');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Run one web search and return plain results.
 *
 * `fetch` is a parameter rather than a module-level global so a test can stub the
 * network and so the route can inject its own dependency.
 * @param {{ query: string, fetch?: typeof globalThis.fetch }} options
 * @returns {Promise<{ query: string, results: { title: string, url: string, snippet: string }[] }>}
 */
export async function searchWeb({ query, fetch: fetchImpl }) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (trimmed === '') throw searchError('SEARCH_FAILED', 'A web search needs a search term.');

  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== 'function') throw searchError('SEARCH_FAILED', 'This server cannot reach the web.');

  const endpoint = new URL(SEARCH_ENDPOINT);
  endpoint.searchParams.set('q', trimmed);

  let response;
  try {
    response = await doFetch(endpoint.toString(), {
      method: 'GET',
      headers: { accept: 'text/html', 'user-agent': USER_AGENT },
      // A redirect is followed because the engine moves between hosts; the
      // address requested is still the fixed endpoint.
      redirect: 'follow',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout, a DNS failure and a refused connection all land here.
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw searchError('SEARCH_FAILED', 'The search service took too long to answer.');
    }
    throw searchError('SEARCH_FAILED', 'The search service could not be reached.');
  }

  if (!response.ok) {
    throw searchError('SEARCH_FAILED', `The search service answered ${response.status}.`);
  }

  const html = await readCappedText(response, SEARCH_BODY_LIMIT);
  // An empty body, or one that holds no markup at all, is not a results page: a
  // captive portal or an interstitial would otherwise read as "no results".
  if (html.trim() === '' || !/<[a-z!/]/i.test(html)) {
    throw searchError('SEARCH_INVALID_RESPONSE', 'The search service answered with something other than a results page.');
  }

  const results = [];
  for (const result of parseSearchResults(html)) {
    if (results.length >= SEARCH_LIMIT) break;
    // A URL over the cap is dropped rather than shortened: half an address opens
    // the wrong page or nothing at all.
    if (result.url.length > URL_LIMIT) continue;
    results.push({
      title: result.title.slice(0, TITLE_LIMIT),
      url: result.url,
      snippet: result.snippet.slice(0, SNIPPET_LIMIT),
    });
  }

  return { query: trimmed, results };
}
