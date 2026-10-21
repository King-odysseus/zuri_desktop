/**
 * Connectors view (design node 0:12996).
 *
 * The node draws the page eight times: connected (the default), empty, loading,
 * connecting, the rejected-key error, disabled while a run is in flight, a
 * restart where the status was re-read from the backend, and a 390 px phone
 * frame that turns the cards into a settings list. All eight are one markup
 * tree, and `?state=` picks one, the same way account.js and automations.js do.
 *
 * What is real here: the state switch, the disabled-while-busy rules, the
 * Disconnect and Connect a tool moves between the list and the empty frame, and
 * the phone layout, which also follows the window width without a query string.
 * What is not: the connector status itself. Reading it belongs to a backend
 * channel this page has no bridge for, so the card starts on the status the
 * node draws and no request is pretended.
 */

// The node's eight frames. A page that lists fewer leaves a screen check with a
// state it can open and land on nothing.
const STATES = ['default', 'empty', 'loading', 'connecting', 'error', 'disabled', 'restart', 'phone'];

// The node draws the phone frame at 390 px; below 760 the two-column desktop
// layout stops fitting (nav 208 + gaps + a 640 column), so the drawn compact
// list takes over before the columns start squeezing.
const PHONE_WIDTH = 760;

// The connecting frame's dwell before the page settles back on a status.
const CONNECTING_MS = 1200;

const CONNECTED_NOTE = 'Key stored server-side · last used 2 hours ago · never shown again';
const SHORT_NOTE = 'Key stored server-side';
const RESTART_NOTE = 'Re-read from the backend on reload · 2 hours ago';

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
 *   list: HTMLElement,
 *   empty: HTMLElement,
 *   skeleton: HTMLElement,
 *   live: HTMLElement,
 *   statusLabel: HTMLElement,
 *   railwayStatus: HTMLElement,
 *   noteText: HTMLElement,
 *   noteShort: HTMLElement,
 *   error: HTMLElement,
 *   url: HTMLInputElement,
 *   disconnect: HTMLButtonElement,
 *   connectTool: HTMLButtonElement,
 *   authenticate: HTMLButtonElement,
 *   test: HTMLButtonElement,
 * }}
 */
function collectElements() {
  const get = (selector) => {
    const element = document.querySelector(selector);
    if (element === null) throw new Error(`Connectors view is missing ${selector}`);
    return element;
  };

  return {
    page: document.body,
    list: get('#connectors-list'),
    empty: get('#connectors-empty'),
    skeleton: get('#connectors-skeleton'),
    live: get('#connectors-live'),
    statusLabel: get('#composio-status-label'),
    railwayStatus: get('#railway-status'),
    noteText: get('#composio-note [data-note-text]'),
    noteShort: get('#composio-note [data-note-short]'),
    error: get('#railway-error'),
    url: get('#railway-url'),
    disconnect: get('#composio-disconnect'),
    connectTool: get('#connectors-connect-tool'),
    authenticate: get('#railway-auth'),
    test: get('#railway-test'),
  };
}

/**
 * Put the page in one of the node's frames. Everything a frame changes is set
 * here, so a state is a change of values rather than a second layout.
 * @param {ReturnType<typeof collectElements>} elements
 * @param {string} state
 */
function applyState(elements, state) {
  const isList = state !== 'empty' && state !== 'loading';

  elements.page.dataset.state = state;
  elements.list.hidden = !isList;
  elements.empty.hidden = state !== 'empty';
  elements.skeleton.hidden = state !== 'loading';

  // The Composio badge is the only one that changes word: the connecting frame
  // holds a spinner until the status settles. The Railway card keeps "Needs
  // auth" through the error frame, where the rejected-key block speaks instead.
  elements.statusLabel.textContent = state === 'connecting' ? 'Connecting' : 'Connected';
  elements.railwayStatus.hidden = !isList;

  // The phone frame prints the short note, so it needs the restart wording too.
  const note = state === 'restart' ? RESTART_NOTE : CONNECTED_NOTE;
  elements.noteText.textContent = note;
  elements.noteShort.textContent = state === 'restart' ? RESTART_NOTE : SHORT_NOTE;
  elements.error.hidden = state !== 'error';

  // A run in flight locks everything that would write; the loading and empty
  // frames have no live controls either, so they share the same rule.
  const locked =
    state === 'disabled' || state === 'connecting' || state === 'loading' || state === 'empty';
  elements.disconnect.disabled = locked;
  elements.url.disabled = locked;
  elements.authenticate.disabled = locked;
  elements.test.disabled = locked;
  elements.disconnect.setAttribute('aria-disabled', String(elements.disconnect.disabled));

  elements.live.textContent =
    state === 'disabled'
      ? 'A run is in flight. Connector keys stay locked until it finishes.'
      : state === 'connecting'
        ? 'Connecting to the connector.'
        : state === 'error'
          ? 'That key did not work. Nothing was saved.'
          : '';
}

/**
 * The phone frame is a width, not only a query string: the drawn 390 px column
 * is what the page becomes when the window is narrow. Both paths end on the
 * same class so the compact rules are written once.
 * @param {HTMLElement} page
 * @param {string} state
 */
function syncPhoneFrame(page, state) {
  const narrow = window.matchMedia(`(max-width: ${PHONE_WIDTH}px)`).matches;
  page.classList.toggle('is-phone', state === 'phone' || narrow);
}

/**
 * @returns {boolean} whether the base URL looks like an address at all
 * @param {string} value
 */
function isUsableUrl(value) {
  if (value.trim() === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function init() {
  const elements = collectElements();
  const initial = stateFromSearch('state');

  applyState(elements, initial);
  syncPhoneFrame(elements.page, initial);

  window.addEventListener('resize', () => syncPhoneFrame(elements.page, elements.page.dataset.state));

  // Moving to another frame by hand (Disconnect, Connect a tool, a retry) keeps
  // the same tree and the same rules.
  /**
   * @param {string} next
   * @param {string} [announcement]
   */
  const go = (next, announcement) => {
    applyState(elements, next);
    syncPhoneFrame(elements.page, next);
    if (announcement !== undefined && announcement !== '') elements.live.textContent = announcement;
  };

  elements.disconnect.addEventListener('click', () => {
    go('empty', 'Composio disconnected. Nothing else was enabled.');
  });

  elements.connectTool.addEventListener('click', () => {
    go('default', 'Composio is connected again.');
  });

  elements.authenticate.addEventListener('click', () => {
    go('connecting', 'Checking the Railway key.');
    window.setTimeout(() => {
      // A key that cannot be checked without the backend stays "Needs auth".
      if (elements.page.dataset.state !== 'connecting') return;
      go('default', 'Still waiting for Railway to confirm the key.');
    }, CONNECTING_MS);
  });

  elements.test.addEventListener('click', () => {
    if (!isUsableUrl(elements.url.value)) {
      go('error');
      return;
    }
    go('connecting', 'Testing the Railway connection.');
    window.setTimeout(() => {
      if (elements.page.dataset.state !== 'connecting') return;
      go('default', 'Railway did not answer. The key was not saved.');
    }, CONNECTING_MS);
  });

  elements.url.addEventListener('input', () => {
    if (elements.page.dataset.state === 'error') go('default');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
