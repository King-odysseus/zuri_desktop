/**
 * Settings view: the provider key form.
 *
 * A key is typed once, handed to main over `zuri:settings:setKey`, and the field is
 * cleared immediately. This module's state holds the provider name and `hasKey`
 * only: nothing assigns the key to a value that outlives the save, and nothing
 * writes it into the DOM or a log. Main never sends it back either, so a saved key
 * exists in exactly one place, `secrets.json`.
 */

import { button, card, container, element, pageView, row } from '../ui/dom.js';
import { setTheme } from '../ui/topbar.js';

const DEFAULT_PROVIDER = 'openai';

/**
 * @typedef {{ provider: string, hasKey: boolean }} KeyState
 */

/**
 * Wire the key form: read the stored status, then save what is typed.
 * @param {Document} [doc]
 * @param {{ settings?: { keyStatus?: Function, setKey?: Function } }} [api] The preload bridge.
 * @returns {{ refresh: () => Promise<void>, getState: () => KeyState }}
 */
export function initSettingsKeyView(doc = document, api = window.zuri) {
  const elements = {
    form: doc.getElementById('provider-key-form'),
    provider: doc.getElementById('provider-key-provider'),
    input: doc.getElementById('provider-key'),
    save: doc.getElementById('provider-key-save'),
    remove: doc.getElementById('provider-key-remove'),
    status: doc.getElementById('provider-key-status'),
    error: doc.getElementById('provider-key-error'),
  };

  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`settings view markup is missing its ${name} element`);
  }

  /** @type {KeyState} */
  const state = {
    provider: elements.provider.value || DEFAULT_PROVIDER,
    hasKey: false,
  };

  /** @param {string} message */
  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = message === '';
  }

  /** @param {boolean} busy */
  function setBusy(busy) {
    elements.input.disabled = busy;
    elements.provider.disabled = busy;
    elements.save.disabled = busy;
    elements.remove.disabled = busy || !state.hasKey;
    elements.form.dataset.busy = String(busy);
  }

  function render() {
    elements.status.textContent = state.hasKey ? 'Key saved' : 'No key saved';
    elements.status.dataset.hasKey = String(state.hasKey);
    // Nothing to remove when no key is stored.
    elements.remove.disabled = !state.hasKey;
  }

  /**
   * Ask main whether a key is stored. Only the boolean is kept.
   * @returns {Promise<void>}
   */
  async function refresh() {
    if (typeof api?.settings?.keyStatus !== 'function') {
      // Outside Zuri (for example the browser preview) there is no main process.
      showError('Keys can only be saved inside Zuri.');
      elements.save.disabled = true;
      render();
      return;
    }

    try {
      const result = await api.settings.keyStatus({ provider: state.provider });
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'no status was returned');
      state.hasKey = result.data.hasKey === true;
      showError('');
    } catch (error) {
      state.hasKey = false;
      showError(`Could not read the key status: ${error.message}`);
    }
    render();
  }

  /**
   * Save the key in the field. The field is cleared before the call is awaited, so
   * a slow or failed save cannot leave the key sitting in the page.
   * @param {Event} event
   * @returns {Promise<void>}
   */
  async function save(event) {
    event.preventDefault();
    showError('');

    const typed = elements.input.value.trim();
    elements.input.value = '';
    if (typed === '') {
      showError('Paste a key first.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.settings.setKey({ provider: state.provider, key: typed });
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'the key was not saved');
      state.hasKey = result.data.hasKey === true;
      render();
    } catch (error) {
      showError(`Could not save the key: ${error.message}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  elements.form.dataset.busy = 'false';
  elements.provider.addEventListener('change', () => {
    state.provider = elements.provider.value || DEFAULT_PROVIDER;
    refresh();
  });
  elements.form.addEventListener('submit', save);

  /**
   * Forget the stored key. What comes back is the same boolean the status line
   * shows, so the page still never sees a key.
   * @returns {Promise<void>}
   */
  async function remove() {
    showError('');
    setBusy(true);
    try {
      const result = await api.settings.clearKey({ provider: state.provider });
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'the key was not removed');
      state.hasKey = result.data.hasKey === true;
      render();
    } catch (error) {
      showError(`Could not remove the key: ${error.message}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  elements.remove.addEventListener('click', remove);

  refresh();
  return { refresh, getState: () => ({ provider: state.provider, hasKey: state.hasKey }) };
}

/** @type {{ refresh: () => Promise<void>, getState: () => KeyState } | null} */
let currentView = null;

/**
 * The live state of the key form, for diagnostics: the provider and the boolean.
 * Never the key, because the view never keeps it.
 * @returns {KeyState|null}
 */
export function getKeyState() {
  return currentView === null ? null : currentView.getState();
}

// Only the settings document has this form; importing the module elsewhere is a no-op.
if (typeof document !== 'undefined' && document.getElementById('provider-key-form')) {
  currentView = initSettingsKeyView(document, window.zuri);
}

/* ---------------------------------------------------------------------------
   Shell view (route "settings")

   The sidebar's Settings destination, mounted inside #chat by ui/router.js. The
   full page above owns the key form; this page carries what a destination needs
   at a glance - the theme, whether a key is stored, and the data folder - and
   changes the theme through the top bar's own control (setTheme), so the window
   and the button that announces the theme can never disagree.
   --------------------------------------------------------------------------- */

/** The two choices the theme row offers, in the order the tokens define them. */
const THEMES = ['light', 'dark'];

/**
 * Build the Settings destination.
 * @param {Document} [doc]
 * @param {any} [api] The `window.zuri` bridge.
 * @returns {HTMLElement}
 */
export function createView(doc = document, api = window.zuri) {
  const current = () => doc.documentElement.dataset.theme ?? 'dark';

  const choices = THEMES.map((theme) => {
    const control = button(theme === 'light' ? 'Light' : 'Dark', async () => {
      const result = await setTheme(theme);
      setStatus(result.ok ? '' : (result.message ?? 'The theme was not saved.'));
      syncChoices();
    });
    control.dataset.theme = theme;
    return control;
  });

  function syncChoices() {
    for (const control of choices) {
      control.setAttribute('aria-pressed', String(control.dataset.theme === current()));
    }
  }

  const saveNote = element('p', 'view-row-note');
  /** @param {string} message Empty string hides the line. */
  function setStatus(message) {
    saveNote.textContent = message;
    saveNote.hidden = message === '';
  }
  setStatus('');

  const keyValue = element('span', 'view-row-value', 'Checking...');
  const openFolder = button('Open folder', async () => {
    const result = await api?.settings?.openDataFolder?.();
    if (result?.ok !== true) setStatus(result?.error?.message ?? 'The data folder could not be opened.');
  });

  const page = pageView({
    title: 'Settings',
    lead: 'How Zuri looks, which provider key it holds and where your data lives.',
    sections: [
      card({
        title: 'Appearance',
        children: [
          row({
            label: 'Theme',
            note: 'Light or dark. The choice is saved and comes back after a restart.',
            control: container('div', 'view-row-choices', choices),
          }),
          saveNote,
        ],
      }),
      card({
        title: 'AI provider',
        children: [
          row({
            label: 'API key',
            note: 'Stored by the main process only. The key is never sent to this window.',
            control: keyValue,
          }),
        ],
      }),
      card({
        title: 'Your data',
        text: 'Chats, tasks and settings are JSON files in your user data folder. Nothing is uploaded anywhere, and no account is needed.',
        children: [row({ label: 'Data folder', control: openFolder })],
      }),
    ],
  });

  syncChoices();

  if (typeof api?.settings?.keyStatus !== 'function') {
    keyValue.textContent = 'Only available inside Zuri';
  } else {
    api.settings
      .keyStatus({})
      .then((result) => {
        keyValue.textContent =
          result?.ok === true
            ? result.data?.hasKey === true
              ? 'Key saved'
              : 'No key saved'
            : (result?.error?.message ?? 'Unknown');
      })
      .catch((error) => {
        keyValue.textContent = String(error?.message ?? error);
      });
  }

  return page;
}
