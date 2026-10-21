/**
 * Reset-password view (design node 0:12246).
 *
 * The node draws this page five times at 1440: the empty form (the default), a
 * save in progress, an expired link, a mismatched pair of passwords, and the
 * saved password. A sixth frame is the same page at 390 px, so the phone layout
 * needs no state of its own. The state is chosen by ?state= so every drawn
 * frame can be opened and checked on its own, exactly like the other pages in
 * this folder:
 *
 *   /reset-password                  the empty form (the node's default)
 *   /reset-password?state=loading    a save in progress
 *   /reset-password?state=error      a link that is past its 30 minutes
 *   /reset-password?state=mismatch   two passwords that differ
 *   /reset-password?state=disabled   the form before the link is confirmed
 *   /reset-password?state=success    the saved password
 *
 * The expired link is this page's error frame, so it opens as ?state=error;
 * ?state=expired still resolves to it for links written before the rename.
 * The disabled frame is the saving frame's control treatment without a save
 * behind it: the node draws a sunken field for input it will not take and a
 * muted label for a button it will not press, and the page reuses both while
 * the reset link has not been confirmed.
 *
 * The two result frames replace the form rather than sitting beside it, so
 * their buttons are links to the pages they name; only the form has behaviour.
 */

/** The node's drawn desktop frames, in the order it lays them out. */
const FRAMES = ['empty', 'loading', 'error', 'mismatch', 'success'];

/** Everything a screen check can open: the drawn frames plus the disabled one,
 * which is the saving frame's inert control treatment with no save running.
 * Both lists are written out because the self-test reads them. */
const STATES = ['empty', 'loading', 'error', 'mismatch', 'disabled', 'success'];

/** Older names a link may still carry, mapped to the state they now open. */
const ALIASES = { expired: 'error' };

/** The passwords the saving and mismatched frames are drawn with. The saving
 * frame shows the same value twice; the mismatched one differs by one digit. */
const SAMPLE_PASSWORD = 'correct-horse-9';
const WRONG_PASSWORD = 'correct-horse-8';

/** How long the stand-in save takes before the drawn success frame. */
const SAVE_DELAY_MS = 1200;

const form = document.querySelector('#reset-form');
const newInput = document.querySelector('#reset-new');
const confirmInput = document.querySelector('#reset-confirm');
const submitButton = document.querySelector('.reset-submit');
const submitLabel = document.querySelector('[data-reset-submit-label]');
const revealButtons = document.querySelectorAll('.reset-reveal');

/**
 * Pick a state from a location search string. A missing or unknown ?state=
 * falls back to the frame the node marks default, so the page is never blank.
 * @param {string} search
 * @returns {string}
 */
function stateFromSearch(search) {
  const asked = new URLSearchParams(search).get('state');
  const state = ALIASES[asked] ?? asked;
  return STATES.includes(state) ? state : 'empty';
}

/**
 * The node draws the saving and mismatched frames with passwords already in the
 * fields. They are only filled when the frame is opened from the URL; a value
 * the user has typed is never overwritten.
 * @param {string} state
 */
function fillDrawnValues(state) {
  if (state !== 'loading' && state !== 'mismatch') return;
  if (newInput.value || confirmInput.value) return;
  newInput.value = SAMPLE_PASSWORD;
  confirmInput.value = state === 'mismatch' ? WRONG_PASSWORD : SAMPLE_PASSWORD;
}

/**
 * Show the drawn frame for a state. The card's height, its distance from the
 * header, the panel and the field message all follow the data-state attribute
 * in reset-password.css, so this only sets that attribute and the parts CSS
 * cannot say (field values, disabled controls and the button's label).
 * @param {string} state
 * @param {{ keepValues?: boolean }} [options]
 */
function applyState(state, options = {}) {
  if (!options.keepValues) fillDrawnValues(state);

  // The saving frame draws its fields filled and the button mid-request; the
  // disabled frame is the same inert treatment with nothing running behind it.
  // The mismatched frame keeps both fields live so the pair can be corrected.
  const saving = state === 'loading';
  const unavailable = state === 'disabled';
  const locked = saving || unavailable;

  document.body.dataset.state = state;
  newInput.disabled = locked;
  confirmInput.disabled = locked;
  submitButton.disabled = locked;
  submitButton.setAttribute('aria-busy', String(saving));
  submitLabel.textContent = saving ? 'Saving…' : 'Set password';
  revealButtons.forEach((button) => {
    button.disabled = locked;
  });
}

/**
 * Once the user has typed, the button follows the pair of fields the way the
 * node's inert control looks: an unusable pair leaves it unpressed. Before the
 * first keystroke it keeps the hand the empty frame draws, so opening the page
 * shows the node's blue button rather than its inert one.
 */
function initPairGuard() {
  const followPair = () => {
    if (document.body.dataset.state !== 'empty' && document.body.dataset.state !== 'mismatch') return;
    const usable =
      newInput.checkValidity() &&
      confirmInput.checkValidity() &&
      newInput.value === confirmInput.value;
    submitButton.disabled = !usable;
  };

  [newInput, confirmInput].forEach((field) => field.addEventListener('input', followPair));
}

/**
 * Submitting walks the two frames the node draws for it: a mismatch is caught
 * in place, otherwise the button goes into its saving look and the card hands
 * off to the success frame. The account service is not part of the renderer
 * yet, so the save resolves locally rather than pretending to reach a server.
 */
function initSubmit() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();

    // The form is novalidate so the page, not the browser bubble, can show the
    // mismatch; the length rules still decide a field the user left too short.
    if (!newInput.checkValidity()) {
      newInput.reportValidity();
      return;
    }
    if (!confirmInput.checkValidity()) {
      confirmInput.reportValidity();
      return;
    }
    if (newInput.value !== confirmInput.value) {
      applyState('mismatch', { keepValues: true });
      confirmInput.focus();
      return;
    }

    applyState('loading', { keepValues: true });
    window.setTimeout(() => {
      applyState('success', { keepValues: true });
    }, SAVE_DELAY_MS);
  });
}

/**
 * The eye in each field shows what was typed. It is a button rather than the
 * node's picture because a control that does nothing is worse than no control;
 * the icon stays the node's eye either way.
 */
function initReveal() {
  revealButtons.forEach((button) => {
    const field = button.closest('.reset-input')?.querySelector('input');
    if (!field) return;

    button.addEventListener('click', () => {
      const revealed = field.type === 'text';
      field.type = revealed ? 'password' : 'text';
      button.setAttribute('aria-pressed', String(!revealed));
      button.setAttribute('aria-label', revealed ? 'Show password' : 'Hide password');
      // Keep the caret where the user left it when the input's type changes.
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    });
  });
}

initReveal();
initPairGuard();
initSubmit();
applyState(stateFromSearch(window.location.search));

// KAI reads this to know which screens the page claims to draw.
window.__KAI_STATES__ = [...STATES];
window.__KAI_FRAMES__ = [...FRAMES];
