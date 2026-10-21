/**
 * Automation run result / history (design node 0:8574).
 *
 * The node draws the page six times - main, empty, loading, error, blocked and
 * accepted - so all six frames ship in the markup and this module owns only
 * which one is on screen plus the two state changes the node itself draws: the
 * follow-up offer being accepted (accepted frame) and the blocked log being
 * opened (blocked frame). Runs come from the automations run store, which has
 * no bridge channel yet, so nothing here invents live data: the copy is the
 * node's own and the numbers are the node's own.
 */

/** The six frames of node 0:8574, in the order the node lays them out. */
export const RUNS_STATES = ['main', 'empty', 'loading', 'error', 'blocked', 'accepted'];

const DEFAULT_STATE = 'main';

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the main frame rather than leaving the page without a body.
 * @param {string} search
 * @returns {string}
 */
export function stateFromSearch(search) {
  const wanted = new URLSearchParams(search).get('state');
  return RUNS_STATES.includes(wanted) ? wanted : DEFAULT_STATE;
}

/**
 * Show one frame and hide the rest. All six are in the document, so `hidden`
 * rather than innerHTML keeps the copy in one place and the page silent.
 * @param {HTMLElement} page the .runs-page root
 * @param {string} state
 * @returns {string} the state that was applied
 */
export function applyState(page, state) {
  const next = RUNS_STATES.includes(state) ? state : DEFAULT_STATE;
  page.dataset.state = next;
  for (const frame of page.querySelectorAll('.runs-state')) {
    frame.hidden = frame.dataset.state !== next;
  }
  return next;
}

/**
 * The offer's own two outcomes in the node: accepting it swaps the banner for
 * the confirmation banner (accepted frame), and Undo puts the offer back.
 * @param {HTMLElement} page
 * @param {string} state main or accepted
 */
function initOffer(page) {
  const accept = page.querySelector('[data-accept-offer]');
  const undo = page.querySelector('[data-undo-offer]');
  const dismiss = page.querySelector('[data-dismiss-offer]');
  const offer = page.querySelector('[data-offer]');

  accept?.addEventListener('click', () => applyState(page, 'accepted'));
  undo?.addEventListener('click', () => applyState(page, 'main'));
  // The node's "Not now" drops the offer without leaving the run, so the banner
  // goes and the result stays; the frame does not change.
  dismiss?.addEventListener('click', () => {
    if (offer) offer.hidden = true;
  });
}

/**
 * "Why blocked" opens the frame that carries the full blocked log, which is the
 * node's blocked frame. Same for the retry and run-again buttons, which open the
 * loading frame - the page cannot start a run itself yet.
 * @param {HTMLElement} page
 */
function initStateLinks(page) {
  for (const button of page.querySelectorAll('[data-show-blocked]')) {
    button.addEventListener('click', () => applyState(page, 'blocked'));
  }
  for (const button of page.querySelectorAll('[data-run-again]')) {
    button.addEventListener('click', () => applyState(page, 'loading'));
  }
}

/**
 * The node is drawn once, in the light colour collection, so the page keeps the
 * node's palette whichever app theme is active (see tokens.css). The button is
 * shell chrome: it flips the document theme for the rest of the app and reports
 * the theme it switched to.
 */
function initTheme(page) {
  const button = page.querySelector('#runs-theme');
  if (!button) return;
  button.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    button.setAttribute('aria-pressed', String(next === 'dark'));
    button.setAttribute(
      'aria-label',
      next === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
    );
  });
}

function init() {
  const page = document.querySelector('.runs-page');
  if (!page) return;
  const state = applyState(page, stateFromSearch(window.location.search));
  window.__KAI_STATES__ = [...RUNS_STATES];
  initOffer(page);
  initStateLinks(page);
  initTheme(page);
}

if (typeof document !== 'undefined') init();
