/**
 * Quick assistant overlay (design node 0:9961).
 *
 * The node draws the floating window four times - empty, loading, error and
 * closed - so all four frames ship in the markup and this module owns only
 * which one is on screen. The copy is the node's own: the quick window has no
 * bridge channel yet (the desktop and the taskbar in the page are scenery, not
 * live state), so nothing here invents live data. Wiring the prompt to the chat
 * stream is the quick-ask backend card.
 *
 * One state has no frame of its own: `disabled`, the quick window opened before
 * a provider key exists, where the prompt cannot send. It draws the empty frame
 * and dims the prompt field (the style guide's disabled control state), so the
 * node stays the only source of the drawing.
 */

/** The four frames of node 0:9961, in the order the node lays them out. */
export const OVERLAY_FRAMES = ['empty', 'loading', 'error', 'closed'];

/** Everything a screen check can open: the drawn frames plus `disabled`. */
export const OVERLAY_STATES = ['empty', 'loading', 'error', 'disabled', 'closed'];

const DEFAULT_STATE = 'empty';

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the empty frame rather than leaving the page without a window.
 * @param {string} search
 * @returns {string}
 */
export function stateFromSearch(search) {
  const wanted = new URLSearchParams(search).get('state');
  return OVERLAY_STATES.includes(wanted) ? wanted : DEFAULT_STATE;
}

/**
 * Turn the empty frame's prompt into the disabled state of the same drawing. A
 * disabled input also leaves the tab order, so the attributes - not only the
 * styles - carry the state, and a reader hears the field is unavailable.
 * @param {HTMLElement} page the .overlay-page root
 * @param {boolean} disabled
 */
function setPromptDisabled(page, disabled) {
  const frame = page.querySelector('.overlay-state[data-state="empty"]');
  const field = frame?.querySelector('.overlay-field');
  if (!frame || !field) return;
  for (const control of frame.querySelectorAll('.overlay-input, .overlay-send')) {
    control.disabled = disabled;
  }
  if (disabled) {
    field.dataset.state = 'disabled';
    field.setAttribute('aria-disabled', 'true');
  } else {
    delete field.dataset.state;
    field.removeAttribute('aria-disabled');
  }
}

/**
 * Show one frame and hide the rest. Every frame is in the document, so `hidden`
 * rather than innerHTML keeps the copy in one place and the page silent.
 * @param {HTMLElement} page the .overlay-page root
 * @param {string} state
 * @returns {string} the state that was applied
 */
export function applyState(page, state) {
  const next = OVERLAY_STATES.includes(state) ? state : DEFAULT_STATE;
  // A state that has no frame of its own (disabled) draws the empty frame.
  const drawn = OVERLAY_FRAMES.includes(next) ? next : DEFAULT_STATE;
  page.dataset.state = next;
  for (const frame of page.querySelectorAll('.overlay-state')) {
    frame.hidden = frame.dataset.state !== drawn;
  }
  setPromptDisabled(page, next === 'disabled');
  return next;
}

/**
 * The window closes on Esc and hands focus back to whatever was in front, which
 * is what the closed frame shows. Pressing it again reopens the empty frame, so
 * the drawing can be stepped through from the keyboard.
 */
function initEscape(page) {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    applyState(page, page.dataset.state === 'closed' ? DEFAULT_STATE : 'closed');
  });
}

/**
 * The close control is the pointer route to the same transition. It closes the
 * drawn window only: there is no overlay window to hide from the renderer, and
 * the closed frame is what this page draws.
 */
function initClose(page) {
  for (const button of page.querySelectorAll('.overlay-close')) {
    button.addEventListener('click', () => applyState(page, 'closed'));
  }
}

function init() {
  const page = document.querySelector('.overlay-page');
  if (!page) return;
  applyState(page, stateFromSearch(window.location.search));
  // The design node names the frames "empty", "loading", "error" and "closed",
  // so those are the state names a screen check can open, plus `disabled`.
  window.__KAI_STATES__ = [...OVERLAY_STATES];
  initClose(page);
  initEscape(page);
}

if (typeof document !== 'undefined') init();
