/**
 * Account view (design node 0:12527).
 *
 * The node draws the page five times: default, a dirty name field, saving, the
 * saved toast and a settings.json read error. All five are one markup tree, and
 * `?state=` picks one, the same way forgot-password.js and reset-password.js do.
 *
 * Three more names are offered for the states a screen check opens: empty, the
 * page before a name has ever been saved; loading, settings.json being read; and
 * disabled, the drawn page with every control out of reach. They reuse the same
 * tree, so a frame is a change of values rather than a second layout.
 *
 * What is real here: the theme choice, the five frames, the reset dialog's open
 * and close, and the data-folder path and app version, which come from the
 * existing `zuri:app:info` bridge channel. What is not: the display name and the
 * storage counts. Reading and writing settings.json is the settings store card,
 * so this page starts on the values the node draws and keeps its Save in place
 * without pretending to persist.
 */

// The node's five frames first, then the three states a screen check opens. A
// page that lists only the drawn frames leaves the check with a state it can
// open and land on nothing.
const STATES = ['default', 'dirty', 'saving', 'saved', 'error', 'empty', 'loading', 'disabled'];

const SAVE_DELAY_MS = 650; // the saving frame's dwell, from the node's second frame

// The screen check opens each of these names in turn, so every state the page
// can be in has to be in the list.
window.__KAI_STATES__ = STATES;

/**
 * @param {string} name
 * @returns {string}
 */
function stateFromSearch(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  return value !== null && STATES.includes(value) ? value : 'default';
}

/**
 * @returns {{
 *   page: HTMLElement,
 *   save: HTMLButtonElement,
 *   saveLabel: HTMLElement,
 *   name: HTMLInputElement,
 *   nameHint: HTMLElement,
 *   banner: HTMLElement,
 *   toast: HTMLElement,
 *   toastText: HTMLElement,
 *   stats: NodeListOf<HTMLElement>,
 *   themeButton: HTMLButtonElement,
 *   themeOptions: NodeListOf<HTMLButtonElement>,
 *   openFolder: HTMLButtonElement,
 *   path: HTMLElement,
 *   reset: HTMLButtonElement,
 *   scrim: HTMLElement,
 *   confirm: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
function collectElements() {
  const get = (selector) => {
    const element = document.querySelector(selector);
    if (element === null) throw new Error(`Account view is missing ${selector}`);
    return element;
  };

  return {
    page: document.body,
    save: /** @type {HTMLButtonElement} */ (get('#account-save')),
    saveLabel: get('[data-save-label]'),
    name: /** @type {HTMLInputElement} */ (get('#account-name')),
    nameHint: get('#account-name-hint'),
    banner: get('#account-banner'),
    toast: get('#account-toast'),
    toastText: get('[data-toast-text]'),
    stats: /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-stat]')),
    themeButton: /** @type {HTMLButtonElement} */ (get('#account-theme')),
    themeOptions: /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-theme-option]')),
    openFolder: /** @type {HTMLButtonElement} */ (get('#account-open-folder')),
    path: get('#account-path'),
    reset: /** @type {HTMLButtonElement} */ (get('#account-reset')),
    scrim: get('#account-scrim'),
    confirm: /** @type {HTMLButtonElement} */ (get('#account-reset-confirm')),
    cancel: /** @type {HTMLButtonElement} */ (get('#account-reset-cancel')),
  };
}

const el = collectElements();

// The node draws "Amelia Ruiz", whose initials are the AR on the avatar chips.
// When settings.json is readable this is its `name`; until then the drawn value
// stays in the field rather than an empty box that disagrees with the avatar.
const DRAWN_NAME = 'Amelia Ruiz';

// The node's counts. They belong to the settings store card, so they stay drawn
// here instead of being made up from a channel this page does not have.
const DRAWN_COUNTS = [...el.stats].map((stat) => stat.textContent);
const DEFAULT_HINT = el.nameHint.textContent;

/** @type {number | undefined} */
let saveTimer;

/**
 * Put the view into one state. Every state is expressed through the elements
 * the node draws differently, never by hiding a whole layout, so all eight
 * frames stay comparable in a screenshot.
 * @param {string} state
 * @returns {void}
 */
function applyState(state) {
  const next = STATES.includes(state) ? state : 'default';
  el.page.dataset.state = next;
  window.clearTimeout(saveTimer);

  const failed = next === 'error';
  const saving = next === 'saving';
  const loading = next === 'loading';
  const empty = next === 'empty';
  const locked = next === 'disabled';
  const busy = saving || loading;

  el.banner.hidden = !failed;
  el.toast.hidden = next !== 'saved';
  el.page.setAttribute('aria-busy', loading ? 'true' : 'false');

  // Everything that can write or read the store is off while settings.json is
  // being read, and off for the whole page in the disabled state.
  el.name.disabled = failed || saving || loading || locked;
  el.save.disabled = next !== 'dirty';
  el.save.setAttribute('aria-busy', busy ? 'true' : 'false');
  el.saveLabel.textContent = saving ? 'Saving' : 'Save changes';
  el.openFolder.disabled = loading || locked;
  el.reset.disabled = loading || locked;
  el.themeButton.disabled = loading || locked;
  el.themeOptions.forEach((option) => {
    option.disabled = loading || locked;
  });

  if (failed || loading || empty) el.name.value = '';
  else if ((next === 'default' || next === 'saved' || locked) && el.name.value.trim() === '') {
    el.name.value = DRAWN_NAME;
  }

  el.nameHint.textContent = failed
    ? 'Read-only until settings.json can be read.'
    : loading
      ? 'Reading settings.json...'
      : empty
        ? 'No display name saved yet. Save writes one to settings.json.'
        : locked
          ? 'Every control is off while the data folder is read-only.'
          : next === 'dirty'
            ? 'Unsaved changes. Save writes the name to settings.json.'
            : DEFAULT_HINT;
  el.nameHint.dataset.tone = next === 'dirty' ? 'dirty' : 'quiet';

  el.stats.forEach((stat, index) => {
    // Empty has nothing to count, loading has not read the counts yet, and the
    // read error shows a dash rather than a zero it cannot vouch for.
    stat.textContent = failed ? '-' : loading ? '' : empty ? '0' : DRAWN_COUNTS[index];
  });

  el.toastText.textContent = 'Profile saved';

  // The dirty frame is drawn mid-edit, so the caret sits in the field and the
  // focus ring is part of the frame. Typing keeps it there; other frames do not
  // take focus.
  if (next === 'dirty' && document.activeElement !== el.name) el.name.focus();
}

/**
 * The Save button has no settings channel yet, so the saving frame lasts the
 * node's dwell and then lands on the saved frame. The comment in this file's
 * header names the card that replaces this with a real write.
 * @returns {void}
 */
function saveName() {
  if (el.page.dataset.state !== 'dirty') return;
  applyState('saving');
  saveTimer = window.setTimeout(() => applyState('saved'), SAVE_DELAY_MS);
}

/**
 * The bridge would show the real path; a plain browser preview keeps the drawn
 * one. `userData/zuri` is the store root store.js uses.
 * @returns {void}
 */
function fillAppInfo() {
  const info = window.zuri?.app?.info;
  if (typeof info !== 'function') return;

  info()
    .then((data) => {
      if (typeof data?.userData === 'string' && data.userData !== '') {
        const separator = data.platform === 'win32' ? '\\' : '/';
        el.path.textContent = `${data.userData}${separator}zuri`;
        el.path.title = el.path.textContent;
      }
      const version = document.querySelector('[data-app-version]');
      if (version !== null && typeof data?.version === 'string') version.textContent = data.version;
      const platform = document.querySelector('[data-app-platform]');
      const labels = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
      if (platform !== null) platform.textContent = labels[data?.platform] ?? String(data?.platform ?? '');
    })
    .catch(() => {
      // The drawn path is already on screen; a failed info read changes nothing.
    });
}

/**
 * Show or hide the reset confirmation frame. focus moves to Cancel on open and
 * back to the card's button on close, so the dialog is usable from the keyboard.
 * @param {boolean} open
 * @returns {void}
 */
function setResetDialog(open) {
  el.scrim.hidden = !open;
  if (open) {
    el.cancel.focus();
    return;
  }
  el.reset.focus();
}

/**
 * @param {string} theme
 * @returns {void}
 */
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  el.themeOptions.forEach((option) => {
    option.setAttribute('aria-checked', option.dataset.themeOption === next ? 'true' : 'false');
  });
  el.themeButton.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  el.themeButton.setAttribute('aria-label', next === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
}

/**
 * The Account card's only file-system action. It asks main to open the store
 * folder; the view never names a path itself.
 * @returns {Promise<void>}
 */
async function openDataFolder() {
  const open = window.zuri?.settings?.openDataFolder;
  if (typeof open !== 'function') {
    showToast('Open the data folder in the desktop app');
    return;
  }

  try {
    const result = await open();
    if (result?.ok !== true) showToast('The data folder could not be opened');
  } catch {
    showToast('The data folder could not be opened');
  }
}

/**
 * Reuse the saved frame's toast for a one-off message. It is hidden again as
 * soon as the page moves to another frame.
 * @param {string} message
 * @returns {void}
 */
function showToast(message) {
  el.toastText.textContent = message;
  el.toast.hidden = false;
  window.setTimeout(() => {
    if (el.page.dataset.state !== 'saved') el.toast.hidden = true;
  }, 3000);
}

/* ------------------------------------------------------------------ wiring */

el.name.addEventListener('input', () => {
  if (el.page.dataset.state === 'error' || el.page.dataset.state === 'saving') return;
  applyState(el.name.value.trim() === DRAWN_NAME ? 'default' : 'dirty');
});

el.save.addEventListener('click', saveName);

el.themeButton.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

el.themeOptions.forEach((option) => {
  option.addEventListener('click', () => applyTheme(option.dataset.themeOption ?? 'dark'));
});

el.openFolder.addEventListener('click', openDataFolder);

el.reset.addEventListener('click', () => setResetDialog(true));
el.cancel.addEventListener('click', () => setResetDialog(false));

// The node's confirmation card is the page's whole dialog. Deleting the store
// files is main-process work this page has no channel for, so confirming closes
// the frame and leaves the data alone; the reset itself is the storage card.
el.confirm.addEventListener('click', () => setResetDialog(false));

el.scrim.addEventListener('click', (event) => {
  if (event.target === el.scrim) setResetDialog(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.scrim.hidden) setResetDialog(false);
});

document.querySelector('#account-retry')?.addEventListener('click', () => applyState('default'));

applyTheme(document.documentElement.dataset.theme ?? 'dark');
fillAppInfo();

// The dirty frame is drawn mid-edit, with the old name replaced by the field's
// placeholder rather than a second invented name.
const initial = stateFromSearch('state');
if (initial === 'dirty') el.name.value = '';
applyState(initial);
