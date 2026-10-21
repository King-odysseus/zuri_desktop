/**
 * Error / not-found view (design node 0:11074).
 *
 * The node draws three desktop frames and one phone frame of the same panel.
 * The state is chosen by ?state= so every drawn frame can be opened and
 * checked on its own, exactly like the other pages in this folder:
 *
 *   /404                  the view failed to load (the node's default)
 *   /404?state=not-found  an unknown route
 *   /404?state=recovering a reload in progress
 *
 * The phone frame is the same document at 390 px, so it needs no state of its own.
 *
 * A screen check also opens the standard `empty` and `disabled` states. The node
 * draws no frame for either, so neither adds a drawing: `empty` is the
 * unknown-route frame (nothing lives at the address the user asked for), and
 * `disabled` is the failed frame with its two actions in the disabled look the
 * node already draws on the reload-in-progress frame. Same idea as the quick
 * overlay's `disabled`, which reuses its empty frame and dims the field.
 */

/** The node's three drawn frames, in the order it lays them out. */
const FRAMES = ['error', 'not-found', 'recovering'];

/** Everything a screen check can open: the drawn frames plus the two standard states. */
const STATES = ['error', 'not-found', 'recovering', 'empty', 'loading', 'disabled'];

/**
 * Pick a state from a location search string. A missing or unknown ?state= falls
 * back to the frame the node marks default, so the page is never left blank.
 * @param {string} search
 * @returns {string}
 */
function stateFromSearch(search) {
  const asked = new URLSearchParams(search).get('state');
  return STATES.includes(asked) ? asked : 'error';
}

/**
 * Put the failed frame's two actions out of reach for the disabled state. The
 * stylesheet carries the look; the attributes carry the behaviour, so the link
 * leaves the tab order and the button cannot fire while the view is down.
 * @param {boolean} disabled
 */
function setActionsDisabled(disabled) {
  const frame = document.querySelector('.error-state[data-state="error"]');
  if (!frame) return;
  for (const control of frame.querySelectorAll('.error-action')) {
    if (control.tagName === 'BUTTON') {
      control.disabled = disabled;
      continue;
    }
    if (disabled) {
      control.setAttribute('aria-disabled', 'true');
      control.setAttribute('tabindex', '-1');
    } else {
      control.removeAttribute('aria-disabled');
      control.removeAttribute('tabindex');
    }
  }
}

/**
 * Show the drawn frame the state belongs to. The stylesheet owns the visibility
 * (a state the node has no frame for borrows one), so this only names the state
 * on the body and adjusts the actions the disabled state takes away.
 * @param {string} state
 */
function applyState(state) {
  document.body.dataset.state = state;
  setActionsDisabled(state === 'disabled');
}

/**
 * The quiet button reloads the page. In the reload frame it is the drawn
 * disabled button, so only the enabled ones are wired.
 */
function initReloadButtons() {
  for (const button of document.querySelectorAll('[data-action="reload"]')) {
    button.addEventListener('click', () => window.location.reload());
  }
}

initReloadButtons();
applyState(stateFromSearch(window.location.search));

// KAI reads this to know which screens the page claims to draw.
window.__KAI_STATES__ = [...STATES];
window.__KAI_FRAMES__ = [...FRAMES];
