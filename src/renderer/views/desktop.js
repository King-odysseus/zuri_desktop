/**
 * Desktop capabilities view (design node 0:13641, route /settings/desktop).
 *
 * The node draws the panel five times: default, saving (the overlay switch is
 * out of reach while the change lands), empty (nothing is allow-listed), error
 * (the entry typed is not something a tool may open) and saved (the toast above
 * the column). All five are one markup tree, and `?state=` picks one, the way
 * account.js and connectors.js do.
 *
 * Two more names are offered for the states a screen check opens: loading, the
 * page while the allow-list is still being read, and disabled, the drawn page
 * with every control out of reach. They reuse the same tree, so a frame is a
 * change of values rather than a second layout.
 *
 * What is real here: the seven frames, the switch flipping, adding and removing
 * allow-list entries, and the two checks that decide whether an entry is usable
 * at all. What is not: writing them to settings.json. The settings store is its
 * own card, so this page holds the drawn values and says "Saved" without
 * pretending to persist; the switch note already tells the reader that a change
 * only lands at the next launch.
 */

// The node's five frames first, then the two states a screen check opens. A
// frame missing from this list is a name the check can open and land on nothing.
const STATES = ['default', 'saving', 'empty', 'error', 'saved', 'loading', 'disabled'];

const SAVE_DELAY_MS = 650; // the saving frame's dwell, from the node's second frame

const SKELETON_ROWS = 2; // the drawn rows the loading frame stands in for, per list

// The rows the node draws when the allow-list already has entries.
const DRAWN_URLS = ['https://mail.google.com', 'https://notion.so/docs'];
const DRAWN_APPS = ['notepad.exe', 'winword.exe'];

// An allow-list app entry is an executable name, not a path or a command line,
// which is the rule src/main/tools/index.js applies when it launches one.
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
 *   overlay: HTMLButtonElement,
 *   overlayState: HTMLElement,
 *   overlayNote: HTMLElement,
 *   urlInput: HTMLInputElement,
 *   urlAdd: HTMLButtonElement,
 *   urlList: HTMLElement,
 *   appInput: HTMLInputElement,
 *   appAdd: HTMLButtonElement,
 *   appList: HTMLElement,
 *   empty: HTMLElement,
 *   error: HTMLElement,
 *   save: HTMLButtonElement,
 *   toast: HTMLElement,
 *   live: HTMLElement,
 * }}
 */
function collectElements() {
  /** @param {string} id */
  const byId = (id) => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`desktop.html is missing #${id}`);
    return found;
  };

  return {
    page: /** @type {HTMLElement} */ (document.body),
    overlay: /** @type {HTMLButtonElement} */ (byId('desktop-overlay-toggle')),
    overlayState: byId('desktop-overlay-state'),
    overlayNote: byId('desktop-overlay-note'),
    urlInput: /** @type {HTMLInputElement} */ (byId('desktop-url-input')),
    urlAdd: /** @type {HTMLButtonElement} */ (byId('desktop-url-add')),
    urlList: byId('desktop-url-list'),
    appInput: /** @type {HTMLInputElement} */ (byId('desktop-app-input')),
    appAdd: /** @type {HTMLButtonElement} */ (byId('desktop-app-add')),
    appList: byId('desktop-app-list'),
    empty: byId('desktop-allowlist-empty'),
    error: byId('desktop-entry-error'),
    save: /** @type {HTMLButtonElement} */ (byId('desktop-save')),
    toast: byId('desktop-toast'),
    live: byId('desktop-live'),
  };
}

const el = collectElements();

/** The allow-list the page holds, drawn values until the store owns them. */
const entries = { urls: [...DRAWN_URLS], apps: [...DRAWN_APPS] };

let overlayOn = true;

/** @type {number | undefined} */
let saveTimer;

/**
 * True when an entry is a URL the openUrl tool would accept: absolute http or
 * https, with no username and no password in it. Mirrors parseAllowListUrl() in
 * src/main/tools/index.js, so the page refuses what the tool would refuse.
 * @param {string} value
 * @returns {boolean}
 */
function isUsableUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.username === '' && parsed.password === '';
}

/**
 * Draw placeholder rows while the allow-list is being read, so the frame says
 * "not read yet" rather than "nothing allow-listed". The bar is decoration; the
 * list itself is the busy region the reader is told about through #desktop-live.
 * @param {HTMLElement} list
 * @param {number} rows
 * @returns {void}
 */
function renderSkeleton(list, rows) {
  list.replaceChildren(
    ...Array.from({ length: rows }, () => {
      const row = document.createElement('li');
      row.className = 'desktop-entry desktop-entry-skeleton';

      const bar = document.createElement('span');
      bar.className = 'desktop-skeleton-bar';
      bar.setAttribute('aria-hidden', 'true');

      row.append(bar);
      return row;
    }),
  );
}

/**
 * Draw both lists from given values, so the rows and the data cannot drift.
 * @param {string[]} urls
 * @param {string[]} apps
 * @returns {void}
 */
function renderEntries(urls, apps) {
  for (const [kind, list, values] of [
    ['url', el.urlList, urls],
    ['app', el.appList, apps],
  ]) {
    list.replaceChildren(
      ...values.map((value) => {
        const row = document.createElement('li');
        row.className = 'desktop-entry';

        const text = document.createElement('span');
        text.className = 'desktop-entry-value';
        text.textContent = value;

        const remove = document.createElement('button');
        remove.className = 'desktop-entry-remove';
        remove.type = 'button';
        remove.dataset.remove = kind;
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${value}`);

        row.append(text, remove);
        return row;
      }),
    );
  }
}

/**
 * Put the view into one state. Every state is a change of values, never a second
 * layout, so all seven frames stay comparable in a screenshot.
 * @param {string} state
 * @returns {void}
 */
function applyState(state) {
  const next = STATES.includes(state) ? state : 'default';
  el.page.dataset.state = next;
  window.clearTimeout(saveTimer);

  const saving = next === 'saving';
  const loading = next === 'loading';
  const locked = next === 'disabled';
  const empty = next === 'empty';
  const failed = next === 'error';
  const busy = saving || loading;

  // The loading frame has not read the allow-list yet, so it draws a placeholder
  // row per list rather than the drawn entries or an empty list with a warning.
  if (loading) {
    renderSkeleton(el.urlList, SKELETON_ROWS);
    renderSkeleton(el.appList, SKELETON_ROWS);
  } else {
    // The empty frame is about the allow-list having nothing in it, so it draws
    // both lists empty over the values the page still holds.
    renderEntries(empty ? [] : entries.urls, empty ? [] : entries.apps);
    // The disabled frame is read-only all the way down, Remove buttons included.
    for (const button of document.querySelectorAll('.desktop-entry-remove')) {
      /** @type {HTMLButtonElement} */ (button).disabled = locked;
    }
  }

  el.empty.hidden = !empty;
  el.error.hidden = !failed;
  el.toast.hidden = next !== 'saved';
  el.page.setAttribute('aria-busy', busy ? 'true' : 'false');

  el.overlay.disabled = saving || failed;
  // Loading and disabled put the whole panel out of reach, switch included.
  if (loading || locked) el.overlay.disabled = true;
  el.overlay.setAttribute('aria-checked', overlayOn ? 'true' : 'false');
  el.overlayState.textContent = saving ? 'Saving' : loading ? 'Loading' : overlayOn ? 'On' : 'Off';
  el.overlayNote.textContent = saving ? 'Saving the change.' : 'Takes effect next launch.';
  // Loading and disabled have no drawn note of their own, so the switch's note
  // line carries the one sentence about why the controls cannot be used yet.
  if (loading) el.overlayNote.textContent = 'Reading the allow-list...';
  if (locked) el.overlayNote.textContent = 'Every control is off while the settings are read-only.';

  // A refused entry keeps the fields live: the error frame is about the entry,
  // not about the page. Loading and disabled put the whole page out of reach.
  el.urlInput.disabled = busy || locked;
  el.urlAdd.disabled = busy || locked;
  el.appInput.disabled = busy || locked;
  el.appAdd.disabled = busy || locked;
  el.save.disabled = busy || locked;
  el.save.setAttribute('aria-busy', busy ? 'true' : 'false');

  el.live.textContent = loading
    ? 'Reading the allow-list.'
    : saving
      ? 'Saving the overlay setting.'
      : locked
        ? 'Every control is off while the settings are read-only.'
        : empty
          ? 'Nothing is allow-listed.'
          : failed
            ? 'That entry cannot be opened. Fix it and add it again.'
            : next === 'saved'
              ? 'Allow-list saved.'
              : '';
}

/**
 * Show the saved frame for a moment, then settle back on the default frame.
 * @returns {void}
 */
function flashSaved() {
  applyState('saved');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => applyState('default'), SAVE_DELAY_MS + 400);
}

/**
 * Add one entry to the list it belongs to, or show why it cannot be opened.
 * @param {'url' | 'app'} kind
 * @param {string} value
 * @returns {void}
 */
function addEntry(kind, value) {
  const trimmed = value.trim();
  if (trimmed === '') return;

  const usable = kind === 'url' ? isUsableUrl(trimmed) : APP_NAME.test(trimmed);
  if (!usable) {
    applyState('error');
    (kind === 'url' ? el.urlInput : el.appInput).focus();
    return;
  }

  const values = kind === 'url' ? entries.urls : entries.apps;
  if (!values.includes(trimmed)) values.push(trimmed);
  (kind === 'url' ? el.urlInput : el.appInput).value = '';
  applyState('saved');
}

el.overlay.addEventListener('click', () => {
  overlayOn = !overlayOn;
  applyState('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => applyState('saved'), SAVE_DELAY_MS);
});

el.urlAdd.addEventListener('click', () => addEntry('url', el.urlInput.value));
el.appAdd.addEventListener('click', () => addEntry('app', el.appInput.value));

for (const input of [el.urlInput, el.appInput]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addEntry(input === el.urlInput ? 'url' : 'app', input.value);
  });
}

for (const list of [el.urlList, el.appList]) {
  list.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('[data-remove]');
    if (!(button instanceof HTMLElement)) return;

    const isApp = button.dataset.remove === 'app';
    const value = button.closest('.desktop-entry')?.querySelector('.desktop-entry-value')?.textContent ?? '';
    const values = isApp ? entries.apps : entries.urls;
    const kept = values.filter((entry) => entry !== value);
    if (isApp) entries.apps = kept;
    else entries.urls = kept;

    applyState(entries.urls.length === 0 && entries.apps.length === 0 ? 'empty' : 'default');
  });
}

el.save.addEventListener('click', () => {
  applyState('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => flashSaved(), SAVE_DELAY_MS);
});

applyState(stateFromSearch('state'));
