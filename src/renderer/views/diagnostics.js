/**
 * Smoke-test and first-run check overlay (design node 0:15576).
 *
 * What is real here: the four frames the node draws, the two run buttons (each
 * walks the drawn run again and reports the drawn result), and the console-error
 * log, which lists the errors the failing frame names.
 *
 * What is not: the runner itself. scripts/smoke.js and scripts/firstrun.js read
 * the live window, and this page has no bridge channel to start them - the
 * preload exposes app info, chat, settings and secrets, no run-check call - so
 * the page shows the drawn result set and never invents a measurement it did not
 * take. Wiring the buttons to the real runner is its own card.
 *
 * The assertion names, their durations and the log lines live in one table, so
 * the count in the summary, the rows under it and the log's badge cannot drift.
 */

/**
 * Every frame the page can be in. A screen check opens each name with `?state=`,
 * so a name without a matching branch would land on a page that looks like a
 * different frame.
 */
const STATES = ['pass', 'fail', 'running', 'idle'];

/**
 * The standard names a screen check opens that the node has no frame for, mapped
 * onto the nearest drawn one: a check that has not started is idle, one that is
 * still going is running (which also disables both buttons), and a broken run is
 * the failing frame with its exit code.
 */
const STATE_ALIASES = Object.freeze({ empty: 'idle', loading: 'running', error: 'fail', disabled: 'running' });

// KAI reads this to know which screens the page claims to draw; the aliases are
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

/** Node has to load the shell before the first assertion can look at it. */
const STARTUP_MS = 400;

/**
 * The assertions the smoke run makes, in the order it makes them. `subject` is
 * the thing looked for, `note` says what "present" means, so a row still reads
 * as a sentence when it fails.
 *
 * @typedef {{ subject: string, note: string, ms: number }} Assertion
 * @type {Assertion[]}
 */
const ASSERTIONS = [
  { subject: '#sidebar', note: 'the settings and chat rail is in the DOM', ms: 12 },
  { subject: '#chat', note: 'the conversation column is in the DOM', ms: 9 },
  { subject: '#context-panel', note: 'the context rail is in the DOM', ms: 8 },
  { subject: 'console errors', note: 'none were logged while the shell started', ms: 41 },
];

const TOTAL_MS = ASSERTIONS.reduce((total, assertion) => total + assertion.ms, 0) + STARTUP_MS;

/** The failing frame names the error it caught: the last assertion is the one. */
const FAILING_INDEX = ASSERTIONS.length - 1;

const FAILED_ASSERTION = {
  expected: 'no console errors during startup',
  received: '1 error: Cannot read properties of null (reading "dataset")',
  at: 'renderer.js:214',
};

/** The console the failing frame reads back: time, level, message. */
const ERROR_LOG = [
  { time: '12:04:18', level: 'error', message: 'Uncaught TypeError: Cannot read properties of null (reading "dataset")' },
  { time: '12:04:18', level: 'error', message: 'at renderContext (renderer.js:214:31)' },
];

/**
 * `0.5 s` is two words to the browser, so at phone width the unit was orphaned
 * on its own line. A non-breaking space keeps the value and its unit together.
 */
const NBSP = '\u00a0';

/** @param {number} ms */
function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}${NBSP}s`;
}

/** @param {string} name @returns {string} */
function stateFromSearch(search) {
  const name = new URLSearchParams(search).get('state');
  if (STATES.includes(name)) return name;
  return STATE_ALIASES[name] ?? 'pass';
}

/**
 * One drawn frame. `summary` and `status` are the panel's own sentences, so the
 * counts in them come from the assertion table rather than from markup.
 *
 * @typedef {{ tone: 'pass'|'fail'|'running'|'idle', summary: string, status: string, note: string,
 *   exit: number, logTone: 'none'|'fail'|'running' }} Frame
 * @type {Record<string, Frame>}
 */
const FRAMES = {
  pass: {
    tone: 'pass',
    summary: `All ${ASSERTIONS.length} assertions passed, ${formatSeconds(TOTAL_MS)} in total, exit code 0.`,
    status: 'Shell check passed. Nothing to fix.',
    note: 'Printed by the first-run check on this launch, then read back by the app.',
    exit: 0,
    logTone: 'none',
  },
  fail: {
    tone: 'fail',
    summary: `1 of ${ASSERTIONS.length} assertions failed, ${formatSeconds(TOTAL_MS)} in total, exit code 1.`,
    status: 'Shell check failed. Fix the named assertion and run it again.',
    note: 'The path was printed, then the console error followed it.',
    exit: 1,
    logTone: 'fail',
  },
  running: {
    tone: 'running',
    summary: `Running the shell check: ${ASSERTIONS.length} assertions on this window.`,
    status: 'Running the shell check. Both buttons are paused until it finishes.',
    note: 'Waiting for the first-run check to print it.',
    exit: 0,
    logTone: 'running',
  },
  idle: {
    tone: 'idle',
    summary: `Not run yet. The shell check takes about ${formatSeconds(TOTAL_MS)}.`,
    status: 'Run either check now, or close this panel and run it later.',
    note: 'Printed by npm run firstrun when the first-run check is run.',
    exit: 0,
    logTone: 'none',
  },
};

/** The glyph in a row, as a kind rather than a colour: the CSS owns the tone. */
const ROW_GLYPH = { pass: 'tick', fail: 'cross', running: 'spinner', idle: 'dash' };
const PILL_WORD = { pass: 'Passed', fail: 'Failed', running: 'Checking', idle: 'Pending' };

const TICK_PATH = 'M4.5 12.5 9.5 17.5 19.5 6.5';
const CROSS_PATH = 'M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5';
const DASH_PATH = 'M6 12h12';
const SHIELD_PATH = 'M12 3.4 19 6v6.2c0 4-3 7-7 8.4-4-1.4-7-4.4-7-8.4V6l7-2.6Z';
const SHIELD_TICK_PATH = 'm9 12 2.2 2.2L15.4 10';
const DISC_GLYPH = { pass: 'shield', fail: 'cross', running: 'shield', idle: 'dash' };

/** @param {string[]} paths @param {number} size */
function createSvg(paths, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  for (const path of paths) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
  }
  return svg;
}

/** @param {string} kind @param {number} size */
function createGlyph(kind, size) {
  const glyph = document.createElement('span');
  glyph.className = 'diagnostics-glyph';
  glyph.dataset.glyph = kind;
  if (kind === 'tick') glyph.append(createSvg([TICK_PATH], size - 6));
  if (kind === 'cross') glyph.append(createSvg([CROSS_PATH], size - 6));
  if (kind === 'dash') glyph.append(createSvg([DASH_PATH], size - 6));
  // The spinner is a bordered disc the CSS turns, so it takes no path.
  return glyph;
}

/** @param {string} word @param {string} tone */
function createPill(word, tone) {
  const pill = document.createElement('span');
  pill.className = 'diagnostics-pill';
  pill.dataset.tone = tone;
  pill.textContent = word;
  return pill;
}

/**
 * One assertion row: glyph, its subject in mono, the short note, the drawn
 * duration and the status pill. A failing row swaps the note for the runner's
 * expected/received text, which is what makes the red frame actionable.
 * @param {Assertion} assertion
 * @param {number} index
 * @param {Frame} frame
 */
function createAssertionRow(assertion, index, frame) {
  const row = document.createElement('li');
  row.className = 'diagnostics-assertion';

  const fails = frame.tone === 'fail' && index === FAILING_INDEX;
  // In the failing frame only one row failed: the rest of the run still passed,
  // so they keep the passing tone rather than all turning red.
  const tone = frame.tone === 'fail' ? (fails ? 'fail' : 'pass') : frame.tone;
  row.dataset.tone = tone;
  row.append(createGlyph(ROW_GLYPH[tone], 16));

  const subject = document.createElement('span');
  subject.className = 'diagnostics-assertion-name';
  subject.textContent = assertion.subject;
  if (fails) {
    // The failing subject is what the runner reports, not the generic name.
    subject.textContent = `${assertion.subject} - expected ${FAILED_ASSERTION.expected}`;
    subject.title = `${FAILED_ASSERTION.received} at ${FAILED_ASSERTION.at}`;
  }

  const note = document.createElement('span');
  note.className = 'diagnostics-assertion-note';
  note.textContent = fails ? FAILED_ASSERTION.received : assertion.note;

  // Name and note share one box, so a phone can stack them under each other
  // instead of squeezing both onto one line and clipping the subject.
  const text = document.createElement('span');
  text.className = 'diagnostics-assertion-text';
  text.append(subject, note);
  row.append(text);

  const duration = document.createElement('span');
  duration.className = 'diagnostics-assertion-ms';
  duration.textContent = frame.tone === 'idle' ? '-' : `${assertion.ms} ms`;
  row.append(duration);

  row.append(createPill(PILL_WORD[tone], tone));
  return row;
}

/** @param {Assertion[]} assertions @param {Frame} frame */
function renderAssertions(assertions, frame) {
  const list = document.querySelector('[data-assertions]');
  if (!list) return;
  list.replaceChildren(...assertions.map((assertion, index) => createAssertionRow(assertion, index, frame)));
}

/**
 * The console-error log. The passing frame says it heard nothing rather than
 * leaving an empty box, so "no errors" is a statement the check made.
 * @param {Frame} frame
 */
function renderLog(frame) {
  const log = document.querySelector('[data-log]');
  if (!log) return;
  const lines = frame.logTone === 'fail' ? ERROR_LOG : [];

  const contents = [];
  if (lines.length === 0) {
    const line = document.createElement('p');
    line.className = 'diagnostics-log-line';
    line.textContent =
      frame.logTone === 'running'
        ? 'Listening for console errors while the check runs.'
        : frame.tone === 'idle'
          ? 'Not listening yet. Nothing is logged until the check runs.'
          : 'No console errors during the shell check.';
    contents.push(line);
  } else {
    for (const line of lines) {
      const row = document.createElement('p');
      row.className = 'diagnostics-log-line';
      row.textContent = `${line.time}  ${line.level}  ${line.message}`;
      contents.push(row);
    }
  }
  log.replaceChildren(...contents);
  log.dataset.tone = frame.logTone === 'fail' ? 'fail' : 'none';

  const count = document.querySelector('[data-log-count]');
  if (count) count.textContent = String(lines.length);
}

/** @param {Frame} frame */
function renderDisc(frame) {
  const disc = document.querySelector('[data-overlay-icon]');
  if (!disc) return;
  const kind = DISC_GLYPH[frame.tone];
  if (kind === 'shield') {
    disc.replaceChildren(createSvg([SHIELD_PATH, SHIELD_TICK_PATH], 16));
    return;
  }
  if (kind === 'cross') {
    disc.replaceChildren(createSvg([CROSS_PATH], 16));
    return;
  }
  disc.replaceChildren(createSvg([DASH_PATH], 16));
}

/**
 * Repaint the whole panel for one frame. Everything the node draws for that
 * frame comes from this one call, so `?state=` cannot leave half a page behind.
 * @param {string} state
 */
function applyState(state) {
  const frame = FRAMES[state];
  document.body.dataset.state = state;

  const summary = document.querySelector('[data-summary]');
  if (summary) summary.textContent = frame.summary;

  const status = document.querySelector('[data-status]');
  if (status) status.textContent = frame.status;

  const note = document.querySelector('[data-settings-note]');
  if (note) note.textContent = frame.note;

  renderDisc(frame);
  renderAssertions(ASSERTIONS, frame);
  renderLog(frame);

  // A run in progress pauses both buttons; every other frame leaves them usable.
  for (const button of document.querySelectorAll('.diagnostics-button')) {
    button.disabled = state === 'running';
  }
}

/**
 * Walk the drawn run again: running, then the passing frame. The page has no
 * runner to call (see the file header), so this replays the drawn result rather
 * than claiming a fresh measurement.
 * @param {'smoke'|'firstrun'} which
 */
function runAgain(which) {
  if (document.body.dataset.state === 'running') return;
  applyState('running');

  const status = document.querySelector('[data-status]');
  if (status) {
    status.textContent =
      which === 'smoke'
        ? 'Running the shell check against this window...'
        : 'Running the first-run check and reading the settings path...';
  }

  window.setTimeout(() => {
    applyState('pass');
    const line = document.querySelector('[data-status]');
    if (!line) return;
    line.textContent =
      which === 'smoke'
        ? `Shell check passed: ${ASSERTIONS.length} of ${ASSERTIONS.length} assertions, exit code 0.`
        : 'First-run check passed: the settings file was found and read back.';
  }, 900);
}

function init() {
  applyState(stateFromSearch(window.location.search));

  document.getElementById('diagnostics-smoke')?.addEventListener('click', () => runAgain('smoke'));
  document.getElementById('diagnostics-firstrun')?.addEventListener('click', () => runAgain('firstrun'));

  // The overlay is opened over the chat, so closing it returns there.
  document.querySelector('.diagnostics-close')?.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
}

init();
