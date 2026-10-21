/**
 * Sign-in view (design node 0:11371).
 *
 * The node draws this page four times at 1440: empty (the default), a submit
 * in progress, rejected credentials, and the signed-in hand-off. A fifth frame
 * is the same page at 390 px, so it needs no state of its own. The state is
 * chosen by ?state= so every drawn frame can be opened and checked on its own,
 * exactly like the other pages in this folder:
 *
 *   /sign-in               the empty form (the node's default)
 *   /sign-in?state=loading a submit in progress
 *   /sign-in?state=error   rejected credentials
 *   /sign-in?state=disabled  the form out of reach (see below)
 *   /sign-in?state=signed-in  the hand-off back to the app
 *
 * A screen check also opens the standard `disabled` state. The node draws no
 * frame for it, so it adds no drawing: it is the empty frame with the form's
 * controls in the style guide's disabled control look (40% opacity, no
 * pointer), which is what the page shows before the account service can be
 * reached. Same idea as the quick overlay's `disabled`, which reuses its empty
 * frame and dims the field.
 */

/** The node's four drawn desktop frames, in the order it lays them out. */
const FRAMES = ['empty', 'loading', 'error', 'signed-in'];

/** Everything a screen check can open: the drawn frames plus `disabled`, which
 * borrows the empty frame. */
const STATES = ['empty', 'loading', 'error', 'disabled', 'signed-in'];

/** The two links beside the fields; the disabled state takes them out of reach
 * as well, so a page that cannot sign in offers no way past it. */
const LINKS = ['.signin-forgot', '.signin-secondary'];

/** The values the loading and error frames are drawn with. The loading frame
 * shows a 12 character password (twelve dots), the error frame the password
 * that was rejected. */
const SAMPLE_EMAIL = 'ana@studio.com';
const SAMPLE_PASSWORD = 'wrong-password';
const SAMPLE_PASSWORD_SUBMITTING = 'zuri-desktop';

/** How long the stand-in request takes before the drawn hand-off frame. */
const SUBMIT_DELAY_MS = 1200;

const form = document.querySelector('#signin-form');
const emailInput = document.querySelector('#signin-email');
const passwordInput = document.querySelector('#signin-password');
const revealButton = document.querySelector('.signin-reveal');
const rememberInput = document.querySelector('.signin-check');
const submitButton = document.querySelector('.signin-submit');
const submitLabel = document.querySelector('[data-signin-submit-label]');
const accountLabel = document.querySelector('[data-signin-account]');

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the frame the node marks default, so the page is never blank.
 * @param {string} search
 * @returns {string}
 */
function stateFromSearch(search) {
  const asked = new URLSearchParams(search).get('state');
  return STATES.includes(asked) ? asked : 'empty';
}

/**
 * The node draws the loading and error frames with credentials already in the
 * fields. They are only filled when the frame is opened from the address; a
 * value the user typed is never overwritten.
 * @param {string} state
 */
function fillDrawnValues(state) {
  if (state !== 'loading' && state !== 'error') return;
  if (!emailInput.value) emailInput.value = SAMPLE_EMAIL;
  if (!passwordInput.value) {
    passwordInput.value = state === 'error' ? SAMPLE_PASSWORD : SAMPLE_PASSWORD_SUBMITTING;
  }
}

/**
 * Show the drawn frame for a state: the panel, the banner, the card height and
 * the field look all follow the data-state attribute in sign-in.css, so this
 * only sets the attribute and the parts CSS cannot say (values, disabled
 * controls, labels).
 * @param {string} state
 * @param {{ keepValues?: boolean }} [options]
 */
function applyState(state, options = {}) {
  if (!options.keepValues) fillDrawnValues(state);

  const submitting = state === 'loading';
  const unavailable = state === 'disabled';
  // Both states take the fields away; only submitting also spins the button.
  const locked = submitting || unavailable;
  document.body.dataset.state = state;

  emailInput.disabled = locked;
  passwordInput.disabled = locked;
  revealButton.disabled = locked;
  submitButton.disabled = locked;
  submitButton.setAttribute('aria-busy', String(submitting));
  submitLabel.textContent = submitting ? 'Signing in…' : 'Sign in';
  // The submitting frame still draws the remember box as a live control.
  rememberInput.disabled = unavailable;
  setLinksDisabled(unavailable);

  // The hand-off frame names the account the page is signing in.
  accountLabel.textContent = emailInput.value.trim() || SAMPLE_EMAIL;
}

/**
 * Take the fields' two links out of reach for the disabled state. A link has no
 * `disabled` attribute, so the attributes carry the state (out of the tab order,
 * announced as unavailable) and initDisabledGuards stops the click.
 * @param {boolean} disabled
 */
function setLinksDisabled(disabled) {
  for (const link of document.querySelectorAll(LINKS.join(', '))) {
    if (disabled) {
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
      continue;
    }
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
  }
}

/** A disabled link still navigates on click, so the state is enforced here. */
function initDisabledGuards() {
  // Each selector is scoped to its own link, so an enabled link still navigates.
  const blocked = LINKS.map((link) => `${link}[aria-disabled="true"]`).join(', ');
  form.addEventListener('click', (event) => {
    if (event.target.closest(blocked)) event.preventDefault();
  });
}

/** The eye glyph in the node's field is a working control here: it reveals
 * what was typed, and its label says which way it will go. */
function initReveal() {
  revealButton.addEventListener('click', () => {
    const hidden = passwordInput.type === 'password';
    passwordInput.type = hidden ? 'text' : 'password';
    revealButton.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    revealButton.setAttribute('aria-pressed', String(hidden));
  });
}

/**
 * Submitting walks the two frames the node draws for it: the button goes into
 * its submitting look, then the page shows the hand-off. The account service
 * itself is not part of the renderer yet, so the request resolves locally
 * rather than pretending to reach a server.
 */
function initSubmit() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyState('loading', { keepValues: true });
    window.setTimeout(() => {
      applyState('signed-in', { keepValues: true });
    }, SUBMIT_DELAY_MS);
  });
}

initReveal();
initSubmit();
initDisabledGuards();
applyState(stateFromSearch(window.location.search));

// KAI reads this to know which screens the page claims to draw.
window.__KAI_STATES__ = [...STATES];
window.__KAI_FRAMES__ = [...FRAMES];
