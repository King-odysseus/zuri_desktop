/**
 * Forgot-password view (design node 0:11991).
 *
 * The node draws this page five times at 1440: empty (the default), a send in
 * progress, the sent hand-off, an unknown address, and the same empty card with
 * its button inert. A sixth frame is the same page at 390 px, so it needs no
 * state of its own. The state is chosen by ?state= so every drawn frame can be
 * opened and checked on its own, exactly like the other pages in this folder:
 *
 *   /forgot-password               the empty form (the node's default)
 *   /forgot-password?state=loading a send in progress
 *   /forgot-password?state=sent    the sent hand-off
 *   /forgot-password?state=error   an address with no account
 *   /forgot-password?state=disabled  the card with its button inert
 *
 * The node draws that last frame as the empty card with a grey button, so the
 * page shows the same look while an address the user has typed is unusable.
 */

/** The node's drawn desktop frames, in the order it lays them out. */
const FRAMES = ['empty', 'loading', 'sent', 'error', 'disabled'];

/** Everything a screen check can open. This page draws every state it offers, so
 * the list is the frames themselves; both are written out because the self-test
 * reads them. */
const STATES = ['empty', 'loading', 'sent', 'error', 'disabled'];

/** The addresses the sending and unknown-address frames are drawn with. The
 * sending frame shows the address it is working on; the other one an address
 * with no account behind it. */
const SAMPLE_EMAIL = 'ana@studio.com';
const REJECTED_EMAIL = 'nobody@studio.com';

/** How long the stand-in request takes before the drawn hand-off frame. */
const SEND_DELAY_MS = 1200;

const form = document.querySelector('#forgot-form');
const emailInput = document.querySelector('#forgot-email');
const submitButton = document.querySelector('.forgot-submit');
const submitLabel = document.querySelector('[data-forgot-submit-label]');
const resendButton = document.querySelector('.forgot-resend');

/** Set once the user has typed in the field: from then on the button follows
 * the address in it. Before that it keeps the hand the node draws, so the
 * empty frame is the node's blue button rather than its inert one. */
let fieldTouched = false;

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
 * The node draws the sending and unknown-address frames with an address already
 * in the field. They are only filled when the frame is opened from the address;
 * a value the user typed is never overwritten.
 * @param {string} state
 */
function fillDrawnValues(state) {
  if (state !== 'loading' && state !== 'error') return;
  if (emailInput.value) return;
  emailInput.value = state === 'error' ? REJECTED_EMAIL : SAMPLE_EMAIL;
}

/**
 * Whether the field holds something the page would send a link to. The field is
 * a real email input with `required`, so this only decides how the button looks
 * once the user has typed; the browser still blocks a submit it cannot accept.
 * @returns {boolean}
 */
function isUsableAddress() {
  return emailInput.checkValidity() && emailInput.value.trim() !== '';
}

/**
 * Show the drawn frame for a state: the card height, the panel, the field look
 * and the button all follow the data-state attribute in forgot-password.css, so
 * this only sets the attribute and the parts CSS cannot say (values, disabled
 * controls, labels).
 * @param {string} state
 * @param {{ keepValues?: boolean }} [options]
 */
function applyState(state, options = {}) {
  if (!options.keepValues) fillDrawnValues(state);

  const sending = state === 'loading';
  const unavailable = state === 'disabled';
  // Both states take the field and the button away; only sending says so.
  const locked = sending || unavailable;
  document.body.dataset.state = state;

  emailInput.disabled = locked;
  submitButton.disabled = locked || (fieldTouched && !isUsableAddress());
  submitButton.setAttribute('aria-busy', String(sending));
  submitLabel.textContent = sending ? 'Sending...' : 'Send reset link';

  // The sent frame replaces the form with the hand-off card.
  if (state === 'sent') submitButton.disabled = false;
}

/**
 * Keep the button's look in step with the field once the user starts typing:
 * an address the page cannot send to puts it in the inert look the node draws
 * for a blank field.
 */
function initFieldGuard() {
  emailInput.addEventListener('input', () => {
    fieldTouched = true;
    if (document.body.dataset.state === 'sent') return;
    submitButton.disabled = !isUsableAddress();
  });
}

/**
 * Submitting walks the two frames the node draws for it: the button goes into
 * its sending look, then the card hands off to the sent frame. The account
 * service is not part of the renderer yet, so the request resolves locally
 * rather than pretending to reach a server.
 */
function initSubmit() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyState('loading', { keepValues: true });
    window.setTimeout(() => {
      applyState('sent', { keepValues: true });
    }, SEND_DELAY_MS);
  });
}

/** The sent frame's quiet button runs the same two frames again. */
function initResend() {
  resendButton.addEventListener('click', () => {
    applyState('loading', { keepValues: true });
    window.setTimeout(() => {
      applyState('sent', { keepValues: true });
    }, SEND_DELAY_MS);
  });
}

initFieldGuard();
initSubmit();
initResend();
applyState(stateFromSearch(window.location.search));

// KAI reads this to know which screens the page claims to draw.
window.__KAI_STATES__ = [...STATES];
window.__KAI_FRAMES__ = [...FRAMES];
