/**
 * Automations list (design node 0:7686).
 *
 * The node draws the list six times - main, empty, loading, error, disabled and
 * caught-up - so all six frames ship in the markup and this module owns only
 * which one is on screen, the filter pill state and the theme button. The rows
 * are the node's own copy: automations have no bridge channel yet, so nothing
 * here invents live data. Wiring them is the automations backend card, and the
 * New automation button opens the create dialog card.
 */

import { card, pageView } from '../ui/dom.js';

/** The six frames of node 0:7686, in the order the node lays them out. */
export const AUTOMATIONS_STATES = ['main', 'empty', 'loading', 'error', 'disabled', 'caught-up'];

/**
 * The filter counts each frame's toolbar draws. Every frame shows the same six
 * automations except the empty one, which is drawn with three zeroes.
 */
const COUNTS = {
  main: { total: 6, enabled: 4, paused: 2 },
  empty: { total: 0, enabled: 0, paused: 0 },
  loading: { total: 6, enabled: 4, paused: 2 },
  error: { total: 6, enabled: 4, paused: 2 },
  disabled: { total: 6, enabled: 4, paused: 2 },
  'caught-up': { total: 6, enabled: 4, paused: 2 },
};

const DEFAULT_STATE = 'main';

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the main frame rather than leaving the page without a body.
 * @param {string} search
 * @returns {string}
 */
export function stateFromSearch(search) {
  const wanted = new URLSearchParams(search).get('state');
  return AUTOMATIONS_STATES.includes(wanted) ? wanted : DEFAULT_STATE;
}

/**
 * Show one frame and hide the rest. All six are in the document, so `hidden`
 * rather than innerHTML keeps the copy in one place and the page silent.
 * @param {HTMLElement} page the .automations-page root
 * @param {string} state
 * @returns {string} the state that was applied
 */
export function applyState(page, state) {
  const next = AUTOMATIONS_STATES.includes(state) ? state : DEFAULT_STATE;
  page.dataset.state = next;
  for (const frame of page.querySelectorAll('.automations-state')) {
    frame.hidden = frame.dataset.state !== next;
  }
  for (const count of page.querySelectorAll('[data-count]')) {
    count.textContent = String(COUNTS[next][count.dataset.count] ?? 0);
  }
  return next;
}

/**
 * Narrow the drawn rows to one filter. The rows are marked enabled or paused in
 * the markup; the pill that is pressed is the one whose aria-pressed is true.
 * @param {HTMLElement} page
 * @param {string} filter all, enabled or paused
 */
export function applyFilter(page, filter) {
  const frame = page.querySelector('.automations-state[data-state="main"]');
  if (!frame) return;
  for (const row of frame.querySelectorAll('.automations-row')) {
    row.hidden = filter !== 'all' && row.dataset.enabled !== filter;
  }
  for (const button of page.querySelectorAll('.automations-filter')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
}

function initFilters(page) {
  for (const button of page.querySelectorAll('.automations-filter')) {
    button.addEventListener('click', () => {
      applyFilter(page, button.dataset.filter ?? 'all');
    });
  }
}

/**
 * The node is drawn once, in the light colour collection, so the page keeps the
 * node's palette whichever app theme is active (see tokens.css). The button is
 * shell chrome: it flips the document theme for the rest of the app and reports
 * the theme it switched to.
 */
function initTheme(page) {
  const button = page.querySelector('#automations-theme');
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
  const page = document.querySelector('.automations-page');
  if (!page) return;
  applyState(page, stateFromSearch(window.location.search));
  // The design node names the locked frame "disabled (run in flight)", so that is
  // the state name a screen check can open; it is exported here for diagnostics.
  window.__KAI_STATES__ = [...AUTOMATIONS_STATES];
  initFilters(page);
  initTheme(page);
}

if (typeof document !== 'undefined') init();

/* ---------------------------------------------------------------------------
   Shell view (route "automations")

   The sidebar's Automations destination, mounted inside #chat by ui/router.js.
   The list above is the design page's own frame; this is the destination's page,
   and it keeps the same promise the list's own comment makes - no invented rows
   until the automations channel exists.
   --------------------------------------------------------------------------- */

/**
 * @returns {HTMLElement}
 */
export function createView() {
  return pageView({
    title: 'Automations',
    lead: 'Schedules that run a job on a clock, and when each one last and next ran.',
    sections: [
      card({
        title: 'No automations yet',
        text: 'Each automation will show its schedule, its last run and its next run. Schedules are saved by the automations backend card; a run missed while Zuri was closed is caught up on the next launch rather than skipped.',
      }),
    ],
  });
}
