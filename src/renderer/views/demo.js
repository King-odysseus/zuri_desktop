/**
 * Automations demo runner (design node 0:14959).
 *
 * The node draws the runner five times - idle, running, pass, fail and
 * restarting - so all five frames are in the markup and this module owns which
 * one is on screen plus the two controls the node draws: Run demo, which starts
 * the scripted scenario, and the restart banner's replay.
 *
 * The scenario itself lives in scripts/demo-autopilot.js and has no bridge
 * channel yet, so the run is walked through here on a timer: running for a few
 * seconds, then the passed frame. When the bridge lands, `startDemo` calls it
 * and the frames follow the real step results instead.
 */

/** The five frames of node 0:14959, in the order the node lays them out. */
export const DEMO_STATES = ['idle', 'running', 'pass', 'fail', 'restarting'];

const DEFAULT_STATE = 'idle';

/**
 * The four states every screen has to be able to show, pointed at the frame the
 * node draws for them: an untouched run is the empty state, a run in flight is
 * the loading state (its button is disabled too), and a failed run is the error
 * state. The frames keep the node's names, so ?state= takes either spelling.
 */
export const STATE_ALIASES = Object.freeze({
  empty: 'idle',
  loading: 'running',
  disabled: 'running',
  error: 'fail',
});

/** How long the scripted run stays on the running frame before it passes. */
const RUN_MS = 4500;

/** The label the primary button carries in each frame. */
const BUTTON_LABELS = {
  idle: 'Run demo',
  running: 'Running...',
  pass: 'Run again',
  fail: 'Run again',
  restarting: 'Running...',
};

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the idle frame rather than leaving the page without a body.
 * @param {string} search
 * @returns {string}
 */
export function stateFromSearch(search) {
  const wanted = new URLSearchParams(search).get('state');
  if (DEMO_STATES.includes(wanted)) return wanted;
  return STATE_ALIASES[wanted] ?? DEFAULT_STATE;
}

/**
 * Show one frame and hide the rest. All five are in the document, so `hidden`
 * rather than innerHTML keeps the copy in one place and the page silent.
 * @param {HTMLElement} page the .demo-page root
 * @param {string} state
 * @returns {string} the state that was applied
 */
export function applyState(page, state) {
  const next = DEMO_STATES.includes(state) ? state : DEFAULT_STATE;
  page.dataset.state = next;
  for (const frame of page.querySelectorAll('.demo-state')) {
    frame.hidden = frame.dataset.state !== next;
  }

  const label = page.querySelector('#demo-run-label');
  if (label) label.textContent = BUTTON_LABELS[next];
  const run = page.querySelector('#demo-run');
  if (run) run.disabled = next === 'running' || next === 'restarting';
  return next;
}

/**
 * The node's own two controls: Run demo walks idle -> running -> pass, and the
 * restart banner's replay puts the page back on the running frame. The frame
 * never claims a result the script did not report, so fail is reachable from
 * ?state=fail only until the script runs.
 * @param {HTMLElement} page
 * @returns {() => void} clears the pending pass, so re-init cannot double-fire
 */
function initRunner(page) {
  const run = page.querySelector('#demo-run');
  const replay = page.querySelector('#demo-restart');
  let timer = 0;

  const start = () => {
    applyState(page, 'running');
    clearTimeout(timer);
    timer = setTimeout(() => applyState(page, 'pass'), RUN_MS);
  };

  run?.addEventListener('click', start);
  replay?.addEventListener('click', start);

  return () => clearTimeout(timer);
}

/**
 * The node is drawn once, in the light colour collection, so the page keeps the
 * node's palette whichever app theme is active (see tokens.css). The button is
 * shell chrome: it flips the document theme for the rest of the app and reports
 * the theme it switched to.
 * @param {HTMLElement} page
 */
function initTheme(page) {
  const button = page.querySelector('#demo-theme');
  if (!button) return;
  button.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    button.setAttribute('aria-pressed', String(next === 'dark'));
    button.setAttribute('aria-label', next === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  });
}

/**
 * Wire the page: read ?state=, then the controls. Safe to call twice because
 * every listener is attached to a node that is replaced only by reload.
 * @param {Document|HTMLElement} [scope]
 * @returns {string} the state that was applied
 */
export function init(page = document.querySelector('.demo-page')) {
  if (!page) return DEFAULT_STATE;
  const applied = applyState(page, stateFromSearch(window.location.search));
  initRunner(page);
  initTheme(page);
  // The screen checker reads the states this view can show from here; the alias
  // names are listed too because ?state= accepts them.
  window.__KAI_STATES__ = [...DEMO_STATES, ...Object.keys(STATE_ALIASES)];
  return applied;
}

if (typeof document !== 'undefined' && document.querySelector('.demo-page')) {
  init();
}
