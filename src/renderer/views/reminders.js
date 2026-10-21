/**
 * Autopilot right rail (design node 0:6978).
 *
 * The node draws the rail five times - live, empty, loading, error, collapsed -
 * so all five frames ship in the markup and this module owns only which one is
 * on screen. Rows are the node's own content: reminders, tasks and automations
 * have no bridge channel yet, so nothing here invents data. Wiring them is the
 * reminders, tasks and automations backend cards.
 */

import { card, pageView } from '../ui/dom.js';

/** The five frames of node 0:6978, in the order the node lays them out. */
export const RAIL_STATES = ['live', 'empty', 'loading', 'error', 'collapsed'];

const DEFAULT_STATE = 'live';

/**
 * Pick a state from a location search string. A missing or unknown ?state= falls
 * back to the live frame rather than leaving the rail without a body.
 * @param {string} search
 * @returns {string}
 */
export function stateFromSearch(search) {
  const wanted = new URLSearchParams(search).get('state');
  return RAIL_STATES.includes(wanted) ? wanted : DEFAULT_STATE;
}

/**
 * Show one state and keep the collapse button's label and aria-expanded true to
 * it, so the strip announces what pressing it will do next.
 * @param {HTMLElement} page the .reminders-page root
 * @param {string} state
 * @returns {string} the state that was applied
 */
export function applyState(page, state) {
  const next = RAIL_STATES.includes(state) ? state : DEFAULT_STATE;
  page.dataset.state = next;
  const collapsed = next === 'collapsed';
  const toggle = page.querySelector('#rail-collapse');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute(
      'aria-label',
      collapsed ? 'Expand the Autopilot rail' : 'Collapse the Autopilot rail',
    );
  }
  return next;
}

function init() {
  const page = document.querySelector('.reminders-page');
  if (!page) return;

  // The state the rail opens in, so collapsing and expanding returns to the frame
  // the page was opened at rather than always to live.
  let opened = stateFromSearch(window.location.search);
  applyState(page, opened);

  page.querySelector('#rail-collapse')?.addEventListener('click', () => {
    if (page.dataset.state === 'collapsed') {
      applyState(page, opened === 'collapsed' ? DEFAULT_STATE : opened);
      return;
    }
    opened = page.dataset.state ?? DEFAULT_STATE;
    applyState(page, 'collapsed');
  });
}

if (typeof document !== 'undefined') init();

/* ---------------------------------------------------------------------------
   Shell view (route "reminders")

   The sidebar's Reminders destination, mounted inside #chat by ui/router.js. The
   rail above is the design page's own panel and stays as it is; this is the page a
   full destination needs. It says the same thing the rail does: nothing stores
   reminders yet, so there are none to draw and no control that pretends to save
   one.
   --------------------------------------------------------------------------- */

/**
 * @returns {HTMLElement}
 */
export function createView() {
  return pageView({
    title: 'Reminders',
    lead: 'One-off and repeating nudges that reach you while Zuri is open.',
    sections: [
      card({
        title: 'No reminders yet',
        text: 'A reminder will show its time, whether it repeats and what it is for. Windows notifications carry them while Zuri runs, and a reminder missed while it was closed is caught up on the next launch.',
      }),
    ],
  });
}
