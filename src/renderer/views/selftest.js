/**
 * Self-test results (design node 0:15423).
 *
 * What is real here: the frames the node draws and the four a screen check
 * opens, the run-again button (it walks the same checks again and reports the
 * same drawn results), and Copy output, which puts the visible report on the
 * clipboard. What is not: the runner itself. Reading scripts/selftest.js's
 * output is the "run the self-test from the app" card, so this page shows the
 * drawn result set and does not invent a result it never measured.
 *
 * The check names and timings live in one table, so the suite headers, the
 * summary sentence and the rail's totals cannot drift apart. Two entries carry
 * an `assertion`: they are the failures the red frame lists, while the default
 * frame is the same suites after those two were fixed.
 */

/**
 * Every frame the page can be in. The screen check opens each name in turn
 * with `?state=`, so a name without a matching branch would land on a page
 * that looks like another state.
 */
const STATES = ['pass', 'fail', 'running', 'idle', 'loading', 'error', 'disabled'];

/**
 * The one standard name a screen check opens that the node has no frame for: a
 * run with no result yet is the idle frame, so `?state=empty` lands on the run
 * that has not started rather than on the passing one it would fall back to.
 */
const STATE_ALIASES = Object.freeze({ empty: 'idle' });

// KAI reads this to know which screens the page claims to draw; the alias is
// listed too, because ?state= accepts either spelling.
window.__KAI_STATES__ = [...STATES, ...Object.keys(STATE_ALIASES)];

/**
 * The design tokens this node is drawn with, as tokens.json names them. A screen
 * check reads each name back off the root element and compares the value with
 * the design file, so the raw numbers live in tokens.css.
 */
window.__KAI_TOKENS__ = [
  '--radius-radius-row',
  '--radius-radius-card',
  '--radius-radius-modal',
  '--radius-radius-overlay',
  '--radius-radius-pill',
];

/** Node has to load the modules before the first check runs; the drawn 1.8 s. */
const STARTUP_MS = 1800;

/**
 * The drawn result set. A check with `assertion` is the one the failing frame
 * lists by name, with the runner's own expected/received text.
 *
 * @typedef {{ name: string, ms: number, assertion?: { expected: string, received: string, at: string } }} Check
 * @typedef {{ id: string, name: string, file: string, checks: Check[] }} Suite
 * @type {Suite[]}
 */
const SUITES = [
  {
    id: 'store',
    name: 'Store',
    file: 'store.js',
    checks: [
      { name: 'readStore returns the defaults when the file is missing', ms: 8 },
      { name: 'readStore reports a file it cannot parse instead of guessing', ms: 6 },
      { name: 'writeStore writes through a temp file and renames it', ms: 74 },
      { name: 'a crash mid-write leaves the previous file intact', ms: 96 },
      {
        name: 'two chat appends in one tick keep their order',
        ms: 31,
        assertion: {
          expected: 'messages in call order',
          received: '[ "2", "1" ]',
          at: 'store.js:214',
        },
      },
      { name: 'chat ids stay unique across 1,000 creates', ms: 118 },
      { name: 'resolveStorePath refuses a name that climbs out of the folder', ms: 7 },
      { name: 'a deleted thread leaves the other threads readable', ms: 12 },
      { name: 'listThreads sorts by updated time, newest first', ms: 9 },
      { name: 'an empty chat gets one untitled thread', ms: 11 },
      { name: 'the store root follows the userData path', ms: 5 },
    ],
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    file: 'scheduler.js',
    checks: [
      { name: 'a cron expression is rejected before it is saved', ms: 6 },
      { name: 'nextRunAt is the next local time the expression matches', ms: 14 },
      {
        name: 'the catch-up sweep replays a run missed while Zuri was closed',
        ms: 88,
        assertion: {
          expected: 'one replay at launch',
          received: '0 replays, nextRunAt still in the past',
          at: 'scheduler.js:302',
        },
      },
      { name: 'a failed run keeps its nextRunAt so it is retried', ms: 24 },
      { name: 'one automation cannot schedule itself twice', ms: 9 },
      { name: 'stopping an automation clears its timer', ms: 7 },
      { name: 'an automation with no next run is skipped quietly', ms: 5 },
      { name: 'the sweep does not run a schedule twice in one launch', ms: 18 },
    ],
  },
  {
    id: 'tools',
    name: 'Tool allow-list',
    file: 'tools/index.js',
    checks: [
      { name: 'writeFile only writes inside the workspace', ms: 21 },
      { name: 'resolveWorkspacePath refuses a path with ..', ms: 6 },
      { name: 'openApp only launches a name on the allow-list', ms: 12 },
      { name: 'openUrl refuses a scheme other than https', ms: 5 },
      { name: 'readFile summarises a file over the size cap', ms: 34 },
      { name: 'a document is parsed only inside the workspace', ms: 48 },
      { name: 'webFetch refuses a host that resolves to a private address', ms: 16 },
      { name: 'a tool called with a missing argument fails fast', ms: 4 },
      { name: 'the tool list matches the preload channel list', ms: 3 },
      { name: 'an unknown tool name is refused, not guessed', ms: 4 },
      { name: 'a failed tool call leaves no temp file behind', ms: 22 },
      { name: 'the allowed apps list has no duplicates', ms: 2 },
    ],
  },
];

const ALL_CHECKS = SUITES.flatMap((suite) => suite.checks);
const TOTAL_MS = ALL_CHECKS.reduce((total, check) => total + check.ms, 0) + STARTUP_MS;

/** @param {number} ms */
function formatMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** @param {number} ms */
function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** @param {string} name @returns {string} */
function stateFromSearch(search) {
  const name = new URLSearchParams(search).get('state');
  if (STATES.includes(name)) return name;
  return STATE_ALIASES[name] ?? 'pass';
}

const GLYPH = {
  pass: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 12.4 4.4 4.4L19 7.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  pending: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.4" stroke="currentColor" stroke-width="1.8"/></svg>',
  running: '<span class="selftest-spinner"></span>',
};

/**
 * @param {Check} check
 * @param {'pass' | 'fail' | 'pending' | 'running'} tone
 * @param {string} time
 */
function checkRow(check, tone, time) {
  const row = document.createElement('li');
  row.className = 'selftest-check';
  row.dataset.tone = tone;

  const icon = document.createElement('span');
  icon.className = 'selftest-check-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = GLYPH[tone === 'fail' ? 'fail' : tone === 'pending' ? 'pending' : tone === 'running' ? 'running' : 'pass'];

  const text = document.createElement('span');
  text.className = 'selftest-check-text';

  const name = document.createElement('span');
  name.className = 'selftest-check-name';
  name.textContent = check.name;
  text.append(name);

  if (tone === 'fail' && check.assertion) {
    const assertion = document.createElement('span');
    assertion.className = 'selftest-assert';
    for (const [key, toneName] of [
      ['expected', 'expected'],
      ['received', 'received'],
    ]) {
      const line = document.createElement('span');
      line.className = 'selftest-assert-line';
      line.dataset.tone = toneName;
      line.textContent = `${key}: ${check.assertion[key]}`;
      assertion.append(line);
    }
    const at = document.createElement('span');
    at.className = 'selftest-assert-at';
    at.textContent = `at ${check.assertion.at}`;
    assertion.append(at);
    text.append(assertion);
  }

  const duration = document.createElement('span');
  duration.className = 'selftest-check-time';
  duration.textContent = time;

  row.append(icon, text, duration);
  return row;
}

/** The loading frame keeps the row rhythm so the card does not jump. @param {number} count */
function skeletonRows(count) {
  return Array.from({ length: count }, () => {
    const row = document.createElement('li');
    row.className = 'selftest-check';
    row.dataset.tone = 'pending';

    const icon = document.createElement('span');
    icon.className = 'selftest-check-icon';
    const disc = document.createElement('span');
    disc.className = 'selftest-skeleton';
    disc.dataset.width = 'icon';
    icon.append(disc);

    const text = document.createElement('span');
    text.className = 'selftest-check-text';
    const bar = document.createElement('span');
    bar.className = 'selftest-skeleton';
    bar.dataset.width = 'name';
    text.append(bar);

    const time = document.createElement('span');
    time.className = 'selftest-skeleton';
    time.dataset.width = 'time';

    row.append(icon, text, time);
    return row;
  });
}

/**
 * One render for every frame: the suites' header, their rows and the summary
 * all read from the same state, so a frame cannot show a green header over red
 * rows.
 * @param {string} state
 */
function renderChecks(state) {
  for (const suite of SUITES) {
    const card = document.querySelector(`[data-suite="${suite.id}"]`);
    if (card === null) continue;

    const list = card.querySelector('[data-checks]');
    const meta = card.querySelector('[data-suite-meta]');
    const pill = card.querySelector('[data-suite-pill]');
    const icon = card.querySelector('[data-suite-icon]');
    list.replaceChildren();

    if (state === 'loading') {
      card.dataset.tone = 'pending';
      meta.textContent = 'reading the last run';
      pill.textContent = 'Loading';
      pill.dataset.tone = 'idle';
      icon.innerHTML = GLYPH.pending;
      list.append(...skeletonRows(4));
      continue;
    }

    if (state === 'idle') {
      card.dataset.tone = 'pending';
      meta.textContent = `${suite.checks.length} checks`;
      pill.textContent = 'Not run';
      pill.dataset.tone = 'idle';
      icon.innerHTML = GLYPH.pending;
      list.append(...suite.checks.map((check) => checkRow(check, 'pending', '')));
      continue;
    }

    if (state === 'running') {
      card.dataset.tone = 'pending';
      meta.textContent = `${suite.checks.length} checks`;
      pill.textContent = 'Running';
      pill.dataset.tone = 'running';
      icon.innerHTML = '<span class="selftest-spinner"></span>';
      list.append(
        ...suite.checks.map((check, index) =>
          checkRow(check, index === 0 ? 'running' : 'pending', index === 0 ? 'now' : ''),
        ),
      );
      continue;
    }

    if (state === 'error') {
      card.dataset.tone = 'pending';
      meta.textContent = `${suite.checks.length} checks`;
      pill.textContent = 'Unknown';
      pill.dataset.tone = 'idle';
      icon.innerHTML = GLYPH.pending;
      list.append(...suite.checks.map((check) => checkRow(check, 'pending', '—')));
      continue;
    }

    // pass, fail and disabled share the drawn rows: only the failing checks
    // change tone, and the disabled frame leaves the numbers exactly as run.
    const failing = state === 'fail';
    const suiteFails = failing && suite.checks.some((check) => check.assertion);
    card.dataset.tone = suiteFails ? 'fail' : 'pass';
    meta.textContent = `${suite.checks.length} checks · ${formatMs(suite.checks.reduce((total, check) => total + check.ms, 0))}`;
    pill.textContent = suiteFails ? `${suite.checks.filter((check) => check.assertion).length} failed` : 'Passed';
    pill.dataset.tone = suiteFails ? 'fail' : 'pass';
    icon.innerHTML = suiteFails ? GLYPH.fail : GLYPH.pass;
    list.append(
      ...suite.checks.map((check) =>
        checkRow(check, failing && check.assertion ? 'fail' : 'pass', formatMs(check.ms)),
      ),
    );
  }
}

/**
 * The summary sentence, its supporting line and the rail, per frame. Kept in
 * one function beside renderChecks so the two cannot disagree about a run.
 * @param {string} state
 */
function renderSummary(state) {
  const summary = document.querySelector('.selftest-summary');
  const icon = document.querySelector('[data-summary-icon]');
  const title = document.querySelector('#selftest-summary-title');
  const line = document.querySelector('[data-summary-line]');
  const run = /** @type {HTMLButtonElement} */ (document.querySelector('#selftest-run'));
  const copy = /** @type {HTMLButtonElement} */ (document.querySelector('#selftest-copy'));
  const detail = (name) => document.querySelector(`[data-detail="${name}"]`);

  const failed = ALL_CHECKS.filter((check) => check.assertion);
  const passed = ALL_CHECKS.length - failed.length;

  const frames = {
    pass: {
      tone: 'pass',
      glyph: GLYPH.pass,
      title: `All ${ALL_CHECKS.length} checks passed`,
      line: `${SUITES.length} suites, ${formatSeconds(TOTAL_MS)} in total, exit code 0.`,
      exit: '0',
      duration: formatSeconds(TOTAL_MS),
      checks: `${ALL_CHECKS.length} of ${ALL_CHECKS.length} passed`,
      finished: 'just now',
      disabled: false,
    },
    fail: {
      tone: 'fail',
      glyph: GLYPH.fail,
      title: `${failed.length} checks failed`,
      line: `${passed} of ${ALL_CHECKS.length} passed, ${formatSeconds(TOTAL_MS)} in total, exit code 1.`,
      exit: '1',
      duration: formatSeconds(TOTAL_MS),
      checks: `${passed} of ${ALL_CHECKS.length} passed`,
      finished: 'just now',
      disabled: false,
    },
    running: {
      tone: 'running',
      glyph: '<span class="selftest-spinner"></span>',
      title: `Running ${SUITES.length} suites`,
      line: `${ALL_CHECKS.length} checks queued. The summary fills in when the last one finishes.`,
      exit: '—',
      duration: 'running',
      checks: `0 of ${ALL_CHECKS.length}`,
      finished: 'running now',
      disabled: true,
    },
    idle: {
      tone: 'idle',
      glyph: GLYPH.pending,
      title: 'No run yet',
      line: 'Run the self-test to check the store, the scheduler and the tool allow-list.',
      exit: '—',
      duration: '—',
      checks: `${ALL_CHECKS.length} checks ready`,
      finished: 'never',
      disabled: false,
    },
    loading: {
      tone: 'idle',
      glyph: '<span class="selftest-spinner"></span>',
      title: 'Reading the last run',
      line: 'The results file in the app data folder is being read.',
      exit: '—',
      duration: '—',
      checks: 'reading',
      finished: 'reading',
      disabled: true,
    },
    error: {
      tone: 'fail',
      glyph: GLYPH.fail,
      title: 'The last result could not be read',
      line: 'selftest-results.json in the app data folder is missing or unreadable. Run again.',
      exit: '—',
      duration: '—',
      checks: 'unknown',
      finished: 'unknown',
      disabled: false,
    },
    disabled: {
      tone: 'pass',
      glyph: GLYPH.pass,
      title: `All ${ALL_CHECKS.length} checks passed`,
      line: 'Run again is off while another window is running the self-test.',
      exit: '0',
      duration: formatSeconds(TOTAL_MS),
      checks: `${ALL_CHECKS.length} of ${ALL_CHECKS.length} passed`,
      finished: 'just now',
      disabled: true,
    },
  };

  const frame = frames[state] ?? frames.pass;
  summary.dataset.tone = frame.tone;
  icon.innerHTML = frame.glyph;
  title.textContent = frame.title;
  line.textContent = frame.line;
  run.disabled = frame.disabled;
  copy.disabled = false;
  detail('exit').textContent = frame.exit;
  detail('duration').textContent = frame.duration;
  detail('startup').textContent = state === 'pass' || state === 'fail' || state === 'disabled' ? formatSeconds(STARTUP_MS) : '—';
  detail('checks').textContent = frame.checks;
  detail('finished').textContent = frame.finished;
}

/** @param {string} state */
function applyState(state) {
  document.body.dataset.state = state;
  renderSummary(state);
  renderChecks(state);
}

const el = {
  run: /** @type {HTMLButtonElement} */ (document.querySelector('#selftest-run')),
  copy: /** @type {HTMLButtonElement} */ (document.querySelector('#selftest-copy')),
  status: document.querySelector('[data-status]'),
};

/** @param {string} message */
function announce(message) {
  el.status.textContent = message;
}

/**
 * Run again replays the drawn checks. The frame it settles on is the frame the
 * page was opened in: the same code run twice gives the same result, so a
 * passing run stays green and the failing frame keeps its failures.
 * Every suite is announced in turn and the button cannot be pressed twice,
 * because a second click during a run would interleave two sequences.
 */
function runAgain() {
  if (el.run.disabled) return;

  const settled = stateFromSearch(window.location.search) === 'fail' ? 'fail' : 'pass';
  applyState('running');
  announce('Running the self-test...');

  const stepMs = 420;
  SUITES.forEach((suite, index) => {
    window.setTimeout(() => {
      announce(`${suite.name}: ${suite.checks.length} checks...`);
    }, stepMs * index);
  });

  window.setTimeout(() => {
    applyState(settled);
    announce(
      settled === 'fail'
        ? 'Finished with failures. The failing checks are listed with their assertion.'
        : `Finished: all ${ALL_CHECKS.length} checks passed.`,
    );
  }, stepMs * SUITES.length);
}

/** The visible report as plain text, so it can be pasted into a bug report. */
function reportText() {
  const lines = [`Zuri Desktop self-test, ${document.body.dataset.state}`, `npm run selftest`];
  for (const suite of SUITES) {
    const failures = suite.checks.filter((check) => check.assertion && document.body.dataset.state === 'fail');
    lines.push('', `${suite.name} (${suite.file})`);
    for (const check of suite.checks) {
      const mark = failures.includes(check) ? 'FAIL' : 'ok';
      lines.push(`  ${mark}  ${check.name} (${formatMs(check.ms)})`);
      if (failures.includes(check)) {
        lines.push(`        expected: ${check.assertion.expected}`);
        lines.push(`        received: ${check.assertion.received}`);
        lines.push(`        at ${check.assertion.at}`);
      }
    }
  }
  return lines.join('\n');
}

async function copyOutput() {
  try {
    await navigator.clipboard.writeText(reportText());
    announce('The report is on the clipboard.');
  } catch {
    // A browser without clipboard permission is the expected failure in a
    // preview window; say so rather than showing a toast that claims success.
    announce('Copy is not available in this window. Select the rows instead.');
  }
}

/**
 * Phone bottom bar. The node puts six destinations in a column beside the page;
 * six 44 px rows do not fit across a 390 px window, so on a phone the four the
 * page leads with sit on a bar a thumb reaches and the rest open under More: no
 * hamburger, no destination dropped. The rows are copied from that column, so a
 * destination added to the nav appears in both places.
 */
const TABBAR_ROWS = ['account.html', 'audit.html', 'handoff.html', 'selftest.html'];

/** Short labels: the bar has room for a word, not for "Desktop capabilities". */
const TABBAR_LABELS = {
  'account.html': 'Account',
  'audit.html': 'Audit',
  'handoff.html': 'Handoff',
  'selftest.html': 'Self-test',
  'connectors.html': 'Connect',
  'desktop.html': 'Desktop',
};

const MORE_GLYPH =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></svg>';

/** @param {Element} link a row of the side nav @returns {string} */
function tabLabel(link) {
  const href = link.getAttribute('href') ?? '';
  return TABBAR_LABELS[href] ?? href.replace('.html', '');
}

/**
 * @param {Element} link a row of the side nav
 * @param {string} className
 * @returns {HTMLAnchorElement}
 */
function tabRow(link, className) {
  const row = document.createElement('a');
  row.className = className;
  row.href = link.getAttribute('href') ?? '';
  row.setAttribute('aria-label', (link.textContent ?? '').trim());
  const glyph = link.querySelector('svg');
  if (glyph !== null) row.append(glyph.cloneNode(true));
  const label = document.createElement('span');
  label.className = 'selftest-tab-label';
  label.textContent = tabLabel(link);
  row.append(label);
  if (link.getAttribute('aria-current') === 'page') row.setAttribute('aria-current', 'page');
  return row;
}

function buildTabBar() {
  const nav = document.querySelector('.selftest-settings-nav');
  if (nav === null) return;

  const links = [...nav.querySelectorAll('a[href]')];
  const bar = document.createElement('nav');
  bar.className = 'selftest-tabbar';
  bar.setAttribute('aria-label', 'Settings and self-test');

  for (const href of TABBAR_ROWS) {
    const link = links.find((row) => row.getAttribute('href') === href);
    if (link !== undefined) bar.append(tabRow(link, 'selftest-tab'));
  }

  // Only build the panel when something is left out of the bar, so a nav of four
  // or fewer keeps a plain row of tabs.
  const rest = links.filter((link) => !TABBAR_ROWS.includes(link.getAttribute('href')));
  if (rest.length > 0) {
    const more = document.createElement('details');
    more.className = 'selftest-tab-more';
    const summary = document.createElement('summary');
    summary.className = 'selftest-tab';
    summary.innerHTML = `${MORE_GLYPH}<span class="selftest-tab-label">More</span>`;
    const panel = document.createElement('div');
    panel.className = 'selftest-tab-more-panel';
    for (const link of rest) panel.append(tabRow(link, 'selftest-tab-more-row'));
    more.append(summary, panel);
    bar.append(more);
  }

  document.body.append(bar);
}

el.run.addEventListener('click', runAgain);
el.copy.addEventListener('click', copyOutput);

applyState(stateFromSearch(window.location.search));
buildTabBar();
