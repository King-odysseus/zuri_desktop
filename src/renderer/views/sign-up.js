/**
 * Sign-up view (design node 0:11637).
 *
 * The node draws this page five times at 1440: empty (the default), a submit
 * in progress, a rejected email, the form out of reach, and the created
 * account. A sixth frame is the same page at 390 px, so it needs no state of
 * its own. The state is chosen by ?state= so every drawn frame can be opened
 * and checked on its own, exactly like the other pages in this folder:
 *
 *   /sign-up                 the empty form (the node's default)
 *   /sign-up?state=loading   a submit in progress
 *   /sign-up?state=error     a rejected email
 *   /sign-up?state=disabled  the form out of reach
 *   /sign-up?state=success   the created account
 */

/** The node's five drawn desktop frames, in the order it lays them out. */
const FRAMES = ['empty', 'loading', 'error', 'disabled', 'success'];

/** Everything a screen check can open: the node draws all five. */
const STATES = ['empty', 'loading', 'error', 'disabled', 'success'];

/** The sign-in link; the out-of-reach state takes it away, so a form that
 * cannot be used offers no way past it. */
const LINKS = ['.signup-signin-link'];

/** The values the loading, error and out-of-reach frames are drawn with. The
 * out-of-reach frame leaves its email box empty, so its placeholder shows. */
const SAMPLE_NAME = 'Ana Ribeiro';
const SAMPLE_EMAIL = 'ana@studio.com';
const DRAWN_VALUES = {
  loading: { name: SAMPLE_NAME, email: SAMPLE_EMAIL, password: 'correct-horse-9' },
  error: { name: SAMPLE_NAME, email: SAMPLE_EMAIL, password: 'zuri2026' },
  disabled: { name: SAMPLE_NAME, password: 'zuri' },
};

/** The three lines the strength row can say, plus the one the out-of-reach
 * frame prints while its fields are filled but not being read. */
const HINTS = {
  empty: 'Use 10+ characters with a number or symbol',
  weak: 'Weak — add a number or symbol',
  strong: 'Strong password',
};
const HINT_OUT_OF_REACH = 'Enter an email and a password of 10+ characters';

/** How long the stand-in request takes before the drawn created frame. */
const SUBMIT_DELAY_MS = 1200;

const form = document.querySelector('#signup-form');
const nameInput = document.querySelector('#signup-name');
const emailInput = document.querySelector('#signup-email');
const passwordInput = document.querySelector('#signup-password');
const revealButton = document.querySelector('.signup-reveal');
const submitButton = document.querySelector('.signup-submit');
const submitLabel = document.querySelector('[data-signup-submit-label]');
const accountLabel = document.querySelector('[data-signup-account]');
const strengthRow = document.querySelector('.signup-strength');
const strengthHint = document.querySelector('[data-signup-strength-hint]');

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
 * The node draws three of its frames with values already in the fields, and draws
 * the out-of-reach frame with an empty email box. They are only filled when the
 * frame is opened from the address; a value the user typed is never overwritten.
 * @param {string} state
 */
function fillDrawnValues(state) {
  const drawn = DRAWN_VALUES[state];
  if (!drawn) return;

  for (const [input, value] of [
    [nameInput, drawn.name],
    [emailInput, drawn.email],
    [passwordInput, drawn.password],
  ]) {
    if (value && !input.value) input.value = value;
  }
}

/**
 * How filled the strength row is. The node draws two filled cases: one bar and
 * the weak line, three bars and the strong line. A value has to be long enough
 * and mixed enough to reach the strong case, which is the same rule the hint
 * prints, so the bars and the sentence never disagree.
 * @param {string} value
 * @returns {'empty' | 'weak' | 'strong'}
 */
function strengthOf(value) {
  const text = value.trim();
  if (!text) return 'empty';
  const longEnough = text.length >= 10;
  const varied = /[^A-Za-z]/.test(text);
  return longEnough && varied ? 'strong' : 'weak';
}

/**
 * Point the strength row at a band. The bars and the hint colour are CSS on the
 * row's data-strength attribute; only the sentence is text.
 * @param {'empty' | 'weak' | 'strong'} band
 * @param {string} [hint] an override for the frame's own instruction line
 */
function showStrength(band, hint) {
  strengthRow.dataset.strength = band;
  strengthHint.textContent = hint ?? HINTS[band];
}

/**
 * Show the drawn frame for a state: the panel, the field message, the card
 * height and the strength colours all follow the body's data-state attribute in
 * sign-up.css, so this only sets the attribute and the parts CSS cannot say
 * (values, disabled controls, labels).
 * @param {string} state
 * @param {{ keepValues?: boolean }} [options]
 */
function applyState(state, options = {}) {
  if (!options.keepValues) fillDrawnValues(state);

  const submitting = state === 'loading';
  const outOfReach = state === 'disabled';
  // Both states take the fields away; only submitting also spins the button.
  const locked = submitting || outOfReach;
  document.body.dataset.state = state;

  nameInput.disabled = locked;
  emailInput.disabled = locked;
  passwordInput.disabled = locked;
  revealButton.disabled = locked;
  submitButton.disabled = locked;
  submitButton.setAttribute('aria-busy', String(submitting));
  submitLabel.textContent = submitting ? 'Creating account…' : 'Create account';
  setLinksDisabled(outOfReach);

  // The out-of-reach frame draws its bars empty and prints the instruction that
  // gets the form back, so the row is not read from the (disabled) value.
  if (outOfReach) showStrength('empty', HINT_OUT_OF_REACH);
  else showStrength(strengthOf(passwordInput.value));

  // The created frame names the address the mail is going to.
  accountLabel.textContent = `A verification email is on its way to ${
    emailInput.value.trim() || SAMPLE_EMAIL
  }`;
}

/**
 * Take the sign-in link out of reach for the out-of-reach state. A link has no
 * `disabled` attribute, so the attributes carry the state (out of the tab
 * order, announced as unavailable) and initDisabledGuards stops the click.
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

/** The row answers the field it describes as the value is typed. */
function initStrength() {
  passwordInput.addEventListener('input', () => {
    if (document.body.dataset.state === 'loading') return;
    showStrength(strengthOf(passwordInput.value));
  });
}

/**
 * Submitting walks the two frames the node draws for it: the button goes into
 * its submitting look, then the page shows the created card. The account
 * service itself is not part of the renderer yet, so the request resolves
 * locally rather than pretending to reach a server.
 */
function initSubmit() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    applyState('loading', { keepValues: true });
    window.setTimeout(() => {
      applyState('success', { keepValues: true });
    }, SUBMIT_DELAY_MS);
  });
}

initReveal();
initStrength();
initSubmit();
initDisabledGuards();
applyState(stateFromSearch(window.location.search));

// KAI reads this to know which screens the page claims to draw.
window.__KAI_STATES__ = [...STATES];
window.__KAI_FRAMES__ = [...FRAMES];
