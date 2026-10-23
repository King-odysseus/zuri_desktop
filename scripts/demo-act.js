/**
 * demo-act.js - the Act demo, run end to end with no window.
 *
 * The story it follows is the one a person would ask for: search the web, open
 * the page that matters, summarise it, and save the summary as Markdown in the
 * workspace. It then reads the Files listing back, because "did it really land
 * where the Files view looks?" is the question the demo exists to answer.
 *
 * What runs here is the real code, not a second copy of it: every step goes
 * through runTool in src/main/tools/index.js, and the listing comes from
 * listWorkspaceFiles, which is the same function behind `zuri:files:list` that
 * the Files view calls. Only the network and the model are stood in for:
 *
 * - The search is live when there is a network. When there is none (or
 *   ZURI_DEMO_OFFLINE=1), the same webSearch tool parses a saved results page
 *   instead, so the demo still completes on an offline machine. Which source was
 *   used is printed on the search line.
 * - The page that gets summarised is served from a small local HTTP server, so
 *   the fetch is a real fetch without depending on a stranger's site staying up
 *   or unchanged.
 * - The summary is written by an extractive summariser (the first few sentences
 *   of the page) rather than by a provider, because a demo must not need an API
 *   key. The tool path around it is the real one.
 *
 * Everything is written under a scratch folder in the system temp directory, so
 * the demo never touches the workspace or the data of whoever runs it.
 * Run via `npm run demo:act`. Exits 0 when every assertion passed, 1 otherwise.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { setStoreRoot } from '../src/main/store.js';
import { ensureWorkspace, listWorkspaceFiles, runTool, setWorkspaceRoot } from '../src/main/tools/index.js';

const QUERY = 'zuri desktop assistant release notes';

const SCRATCH_ROOT = path.join(os.tmpdir(), 'zuri-demo-act');
const STORE_DIR = path.join(SCRATCH_ROOT, 'store');
const WORKSPACE_DIR = path.join(SCRATCH_ROOT, 'workspace');

/** A live search that hangs must not hold the demo; the saved page takes over. */
const SEARCH_DEADLINE_MS = 8_000;

/** Set to 1 to skip the live search attempt, for a run with no network at all. */
const OFFLINE = process.env.ZURI_DEMO_OFFLINE === '1';

/**
 * A DuckDuckGo results page kept in the script, so the offline path still parses
 * real markup through the real parser instead of inventing result objects.
 */
const SAVED_SEARCH_HTML = `<!doctype html>
<html><body>
<div class="result">
  <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fzuri.example%2Frelease-notes">Zuri 0.1 release notes</a>
  <a class="result__snippet" href="https://zuri.example/release-notes">Act mode saves every result as Markdown in the workspace.</a>
</div>
<div class="result">
  <a class="result__a" href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fzuri.example%2Fscheduler">How the Autopilot scheduler catches up</a>
  <a class="result__snippet" href="https://zuri.example/scheduler">One catch-up run per automation at launch, and a reminder when a run needs attention.</a>
</div>
</body></html>`;

/** The page the fetch step reads. Local, so the demo does not depend on a live site. */
const ARTICLE_HTML = `<!doctype html>
<html><head><title>Zuri 0.1 release notes</title></head>
<body>
<article>
<h1>Zuri 0.1 release notes</h1>
<p>Zuri keeps chat, tasks, reminders and automations in one window, so a professional does not lose the thread between tools. The first release runs entirely on the local machine and keeps its data in a folder on disk.</p>
<p>Act mode shows every tool call as a step and asks before writing over a file that already exists. Saved results land in the workspace folder and appear under Files without a restart.</p>
<p>Autopilot runs scheduled work only while Zuri is open. A run missed because the app was closed is caught up once at the next launch, and a run that needs attention leaves a follow-up reminder behind.</p>
</article>
</body></html>`;

/** @type {string[]} */
const failures = [];

/**
 * Record one assertion. Details stay on the line so a failure says what it saw.
 * @param {string} label
 * @param {boolean} passed
 * @param {string} [detail]
 */
function check(label, passed, detail = '') {
  const suffix = detail === '' ? '' : ` - ${detail}`;
  if (passed) {
    console.log(`ok   ${label}${suffix}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL ${label}${suffix}`);
}

/**
 * A fetch that gives up after `ms`, so one unreachable host cannot stall the demo
 * for the tool layer's full 15 second timeout.
 * @param {number} ms
 * @returns {typeof fetch}
 */
function fetchWithDeadline(ms) {
  return async (url, init) => {
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    });
    try {
      return await Promise.race([globalThis.fetch(url, init), deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The saved results page, answered as a normal HTTP response. */
async function savedSearchPage() {
  return new Response(SAVED_SEARCH_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * Search through the real webSearch tool: live when the machine has a network,
 * saved page otherwise, and never an invented result list.
 * @returns {Promise<{ source: string, results: { title: string, url: string, snippet: string }[] }>}
 */
async function searchWeb() {
  if (!OFFLINE) {
    const live = await runTool(
      'webSearch',
      { query: QUERY, limit: 5 },
      { dependencies: { fetch: fetchWithDeadline(SEARCH_DEADLINE_MS) } },
    );
    const liveResults = live.ok ? live.data.results : [];
    if (liveResults.length > 0) return { source: 'live', results: liveResults };

    const reason = live.ok ? 'the service returned no results' : live.error.code;
    console.log(`note the live search did not answer (${reason}), reading the saved results page instead`);
  }

  const saved = await runTool('webSearch', { query: QUERY, limit: 5 }, { dependencies: { fetch: savedSearchPage } });
  return { source: 'saved page', results: saved.ok ? saved.data.results : [] };
}

/**
 * Stand-in for the provider call: the first few sentences of the page, which is a
 * summary a reader can check against the page itself.
 * @param {{ text: string }} input
 * @returns {Promise<{ ok: true, data: { summary: string, label: string } }>}
 */
async function extractiveSummarise(input) {
  // De-duplicated because a page's <title> and its <h1> usually say the same thing.
  const sentences = [...new Set(
    String(input.text)
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 40),
  )].slice(0, 3);
  return {
    ok: true,
    data: { summary: sentences.join(' '), label: 'extractive demo summariser' },
  };
}

/**
 * Drop the page title from the start of its own text. Readable text repeats the
 * <title> and the <h1>, and a summary that opens with the heading said twice reads
 * like a bug rather than a summary.
 * @param {string} text
 * @param {string} title
 * @returns {string}
 */
function stripLeadingTitle(text, title) {
  let body = text.trimStart();
  const heading = title.trim().toLowerCase();
  while (heading !== '' && body.toLowerCase().startsWith(heading)) {
    body = body.slice(title.trim().length).trimStart();
  }
  return body;
}

/** A file name that reads well in the Files list and sorts by day. */
function summaryFileName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = QUERY.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `act-demo/${slug}-${stamp}.md`;
}

/**
 * Serve the article on a random loopback port for the fetch step.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
async function startArticleServer() {
  const server = http.createServer((request, response) => {
    if (request.url === '/zuri-demo.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(ARTICLE_HTML);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/zuri-demo.html`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/** @param {{ title: string, url: string, snippet: string }[]} results @param {any} page @param {any} summary @param {string} summaryLabel */
function buildMarkdown(results, page, summary, summaryLabel) {
  const lines = [
    `# Act demo: ${QUERY}`,
    '',
    `Run at ${new Date().toISOString()} in Act mode.`,
    '',
    '## What the search found',
    '',
    ...results.map((result) => `- [${result.title}](${result.url}) - ${result.snippet}`),
    '',
    '## The page that was opened',
    '',
    `[${page.title || page.url}](${page.url})`,
    '',
    '## Summary',
    '',
    summary,
    '',
    '---',
    `Saved by the Zuri Act demo. Summary method: ${summaryLabel}.`,
    '',
  ];
  return lines.join('\n');
}

async function main() {
  // A clean folder every run, so "the file appears in the listing" is this run's
  // file and not yesterday's leftover.
  await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
  await fs.mkdir(STORE_DIR, { recursive: true });
  setStoreRoot(STORE_DIR);
  setWorkspaceRoot(WORKSPACE_DIR);
  await ensureWorkspace();

  // 1. Search.
  const search = await searchWeb();
  check(
    'webSearch returns results',
    search.results.length > 0,
    `${search.results.length} result(s) from the ${search.source}`,
  );
  check('webSearch results carry a title and a url', search.results.every((r) => r.title !== '' && /^https?:/.test(r.url)));

  // 2. Fetch the page. A local server keeps the step real without a live site.
  const article = await startArticleServer();
  /** @type {any} */
  let page = null;
  try {
    const fetched = await runTool('webFetch', { url: article.url });
    check(
      'webFetch reads the page',
      fetched.ok === true && fetched.data.text.length > 0,
      fetched.ok === true ? `${fetched.data.text.length} characters` : fetched.error.code,
    );
    if (fetched.ok === true) page = fetched.data;
  } finally {
    await article.close();
  }

  // 3. Summarise what was fetched.
  /** @type {any} */
  let summary = null;
  /** @type {string} */
  let summaryLabel = 'none';
  if (page !== null) {
    const summarised = await runTool(
      'summarizeDocument',
      { text: stripLeadingTitle(page.text, page.title), name: page.title || 'zuri-demo.html', path: page.url, instruction: 'What changed in this release?' },
      { dependencies: { summarize: extractiveSummarise } },
    );
    check(
      'summarizeDocument returns a summary',
      summarised.ok === true && summarised.data.summary.length > 0,
      summarised.ok === true ? summarised.data.summary.slice(0, 60) : summarised.error.code,
    );
    if (summarised.ok === true) {
      summary = summarised.data.summary;
      summaryLabel = summarised.data.label ?? 'unknown';
    }
  } else {
    check('summarizeDocument returns a summary', false, 'there was no page to summarise');
  }

  // 4. Save it into the workspace. writeFile changes something outside Zuri, so it
  // only runs with the confirmation the step's Confirm button sends.
  const relativePath = summaryFileName();
  const markdown = buildMarkdown(search.results, page ?? { title: '', url: article.url }, summary ?? '', summaryLabel);

  const refused = await runTool('writeFile', { path: relativePath, content: markdown });
  check(
    'writeFile refuses to run without confirmation',
    refused.ok === false && refused.error.code === 'TOOL_CONFIRMATION_REQUIRED',
    refused.ok === false ? refused.error.code : 'the write went ahead',
  );

  const written = await runTool('writeFile', { path: relativePath, content: markdown }, { confirmed: true });
  check(
    'writeFile saves the Markdown summary',
    written.ok === true && written.data.overwritten === false,
    written.ok === true ? written.data.relative : written.error.code,
  );

  const savedPath = written.ok === true ? written.data.path : path.join(WORKSPACE_DIR, relativePath);

  // 5. The Files listing is what the Files view asks for, so this is the
  // "appears in Files" assertion rather than a second directory scan written here.
  const listing = await listWorkspaceFiles();
  const listed = listing.files.find((file) => file.path === relativePath);
  check('the saved file is in the Files listing', listed !== undefined, listed === undefined ? 'not listed' : listed.path);
  check(
    'the listing reports the saved size',
    listed !== undefined && listed.bytes === Buffer.byteLength(markdown, 'utf8'),
    listed === undefined ? 'no entry' : `${listed.bytes} bytes`,
  );

  // 6. A second write over the same name, still unconfirmed, must change nothing.
  const overwrite = await runTool('writeFile', { path: relativePath, content: 'overwritten without asking' });
  const afterOverwrite = await fs.readFile(savedPath, 'utf8').catch(() => null);
  check(
    'an unconfirmed overwrite leaves the saved file as it was',
    overwrite.ok === false && afterOverwrite === markdown,
    overwrite.ok === false ? overwrite.error.code : 'the file was overwritten',
  );

  if (failures.length > 0) {
    console.log(`FAIL demo:act: ${failures.length} assertion(s) failed`);
    process.exit(1);
  }

  console.log(`workspace: ${WORKSPACE_DIR}`);
  console.log(`saved: ${relativePath} (${Buffer.byteLength(markdown, 'utf8')} bytes, search source: ${search.source})`);
  console.log('PASS demo:act');
  process.exit(0);
}

main().catch((error) => {
  console.log(`FAIL demo:act: ${error.message}`);
  process.exit(1);
});
