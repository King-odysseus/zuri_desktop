/**
 * First-run welcome / setup (design node 0:1008).
 *
 * The page asks for the three things setup needs - a name, a theme and a provider
 * key - and hands them to the main process in one call over
 * `zuri:onboarding:complete`, which answers with a boolean for the key and never
 * the key itself. The page then moves to the chat workspace. Nothing here stores
 * the key: the only copy is the characters the person is typing, which the browser
 * clears as the page unloads.
 *
 * Four states, named as the design node names them:
 *   empty    - Save stays disabled until a name and a key are typed (node 0:1009)
 *   loading  - the fields lock, the button reads "Saving..." (node 0:1079)
 *   error    - the field outline and help line turn red with main's reason (node 0:1151)
 *   disabled - there is no preload bridge, so nothing typed here could be saved
 */

import { enhanceSelect } from '../ui/select.js';

/**
 * The states this card can show. KAI's page check reads this list from the page,
 * because only one state can be on screen at a time and the others still exist.
 */
export const ONBOARDING_STATES = ['empty', 'loading', 'error', 'disabled'];

/** Providers the main process can store a key for (`PROVIDERS` in src/main/secrets.js). */
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    fieldLabel: 'Anthropic API key',
    placeholder: 'sk-ant-api03-\u2026',
    docs: 'console.anthropic.com/settings/keys',
    models: ['claude-sonnet-4', 'claude-3-5-haiku-latest'],
  },
  openai: {
    name: 'OpenAI',
    fieldLabel: 'OpenAI API key',
    placeholder: 'sk-\u2026',
    docs: 'platform.openai.com/api-keys',
    models: ['gpt-4o mini', 'gpt-4o'],
  },
};

const DEFAULT_PROVIDER = 'anthropic';

/** Where a saved key sends the person next: the chat workspace shell. */
const NEXT_PAGE = '../index.html';

const ENTRY_HELP = 'Paste a key to continue. Zuri checks it with one test call before saving.';

/**
 * @typedef {{ provider: string, state: 'empty'|'loading'|'error'|'disabled' }} OnboardingState
 */

/**
 * Collect the elements this page owns, so a missing one fails loudly instead of
 * leaving a half-wired form.
 * @param {Document} doc
 */
function collectElements(doc) {
  const elements = {
    card: doc.getElementById('onboarding-card'),
    form: doc.getElementById('onboarding-form'),
    providers: doc.getElementById('onboarding-providers'),
    keyLabel: doc.getElementById('onboarding-key-label'),
    key: doc.getElementById('onboarding-key'),
    help: doc.getElementById('onboarding-key-help'),
    reveal: doc.getElementById('onboarding-reveal'),
    docs: doc.getElementById('onboarding-docs'),
    name: doc.getElementById('onboarding-name'),
    theme: doc.getElementById('onboarding-theme'),
    model: doc.getElementById('onboarding-model'),
    save: doc.getElementById('onboarding-save'),
    saveLabel: doc.getElementById('onboarding-save-label'),
  };

  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`onboarding page markup is missing its ${name} element`);
  }

  return elements;
}

/**
 * Wire the setup card.
 * @param {Document} [doc]
 * @param {{ onboarding?: { complete?: Function } }} [api] The preload bridge.
 * @returns {{ getState: () => OnboardingState }}
 */
export function initOnboardingView(doc = document, api = window.zuri) {
  const elements = collectElements(doc);

  // Both dropdowns are the drawn control from ui/select.js. The native selects keep
  // the values this page saves and the options it rebuilds whenever the provider
  // changes, so setup reads and writes them exactly as it did before.
  enhanceSelect(elements.theme, { doc });
  enhanceSelect(elements.model, { doc });

  /** @type {OnboardingState} */
  const state = { provider: DEFAULT_PROVIDER, state: 'empty' };

  const providerNames = Object.keys(PROVIDERS);

  /** @param {string} provider */
  function providerConfig(provider) {
    return PROVIDERS[provider] ?? PROVIDERS[DEFAULT_PROVIDER];
  }

  /**
   * Paint the state the card shows. The markup carries one data-state attribute and
   * the CSS decides what each state looks like, so no colour is chosen here.
   */
  function render() {
    const loading = state.state === 'loading';
    const inert = state.state === 'disabled';
    elements.card.dataset.state = state.state;

    elements.key.disabled = loading || inert;
    elements.name.disabled = loading || inert;
    elements.theme.disabled = loading || inert;
    elements.model.disabled = loading || inert;
    for (const input of elements.providers.querySelectorAll('input[name="provider"]')) {
      // Disabled rows stay disabled: main cannot store those providers yet.
      input.disabled = loading || inert || !providerNames.includes(input.value);
    }

    elements.saveLabel.textContent = loading ? 'Saving\u2026' : 'Save key';
    // Save is live again on error, because the field still holds the rejected key.
    const typed = elements.key.value.trim();
    const named = elements.name.value.trim();
    elements.save.disabled = loading || inert || typed === '' || named === '';

    if (state.state === 'empty') {
      elements.help.textContent = ENTRY_HELP;
      return;
    }
    if (loading) {
      elements.help.textContent = `Verifying the key with one test call to ${providerConfig(state.provider).name}\u2026`;
    }
  }

  /** @param {string} message */
  function fail(message) {
    state.state = 'error';
    render();
    elements.help.textContent = message;
  }

  /**
   * Point the API-key field at the chosen provider: its label, its placeholder and
   * the models that provider offers.
   * @param {string} provider
   */
  function applyProvider(provider) {
    const config = providerConfig(provider);
    elements.keyLabel.textContent = config.fieldLabel;
    elements.key.placeholder = config.placeholder;

    elements.model.replaceChildren(
      ...config.models.map((model) => {
        const option = doc.createElement('option');
        option.value = model;
        option.textContent = model;
        return option;
      }),
    );
  }

  elements.key.addEventListener('input', () => {
    if (state.state === 'error') state.state = 'empty';
    render();
  });

  elements.name.addEventListener('input', () => {
    if (state.state === 'error') state.state = 'empty';
    render();
  });

  elements.providers.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof doc.defaultView.HTMLInputElement)) return;
    if (!providerNames.includes(input.value)) return;
    state.provider = input.value;
    if (state.state === 'error') state.state = 'empty';
    applyProvider(state.provider);
    render();
  });

  elements.reveal.addEventListener('click', () => {
    const visible = elements.key.type === 'text';
    elements.key.type = visible ? 'password' : 'text';
    elements.reveal.setAttribute('aria-pressed', String(!visible));
    elements.reveal.setAttribute('aria-label', visible ? 'Show key' : 'Hide key');
    elements.key.focus();
  });

  /**
   * The node draws "Where do I find it?" as a link. There is no channel that opens
   * an external page, so the address is put in the help line (and the clipboard when
   * the window allows it) instead of navigating this window away from Zuri.
   * @param {string} provider
   */
  async function showDocsAddress(provider) {
    const config = providerConfig(provider);
    const message = `Create a key at ${config.docs} in your browser, then paste it here.`;
    elements.help.textContent = message;
    try {
      await navigator.clipboard.writeText(`https://${config.docs}`);
    } catch {
      // A refused clipboard leaves the address on screen, which is the part that matters.
    }
  }

  /**
   * Hand the three answers to main. The field is not cleared on failure: the drawn
   * error state keeps the key so a typo can be corrected, and it was never stored
   * anywhere. The name and theme are written before the key, so a rejected key
   * leaves the person's other two answers saved.
   * @param {Event} event
   * @returns {Promise<void>}
   */
  async function save(event) {
    event.preventDefault();
    if (state.state === 'loading' || state.state === 'disabled') return;

    const name = elements.name.value.trim();
    if (name === '') {
      fail('Add your name so Zuri knows what to call you.');
      return;
    }

    const typed = elements.key.value.trim();
    if (typed === '') {
      fail('Paste a key to continue.');
      return;
    }

    if (typeof api?.onboarding?.complete !== 'function') {
      // A window without the preload bridge cannot reach main at all, so the form is
      // made inert rather than told to retry: nothing typed here could ever be saved.
      state.state = 'disabled';
      render();
      elements.help.textContent = 'Setup can only be finished inside Zuri. Open the app to continue.';
      return;
    }

    state.state = 'loading';
    render();

    try {
      const result = await api.onboarding.complete({
        name,
        theme: elements.theme.value,
        provider: state.provider,
        model: elements.model.value,
        key: typed,
      });
      if (result?.ok !== true) throw new Error(result?.error?.message ?? 'setup was not saved');
      // Main answered with booleans only; the page is done with the key.
      elements.key.value = '';
      doc.defaultView.location.assign(NEXT_PAGE);
    } catch (error) {
      fail(`Could not finish setup: ${error.message}`);
    }
  }

  elements.form.addEventListener('submit', save);

  elements.docs.addEventListener('click', () => {
    // The help line carries the rejection reason in the error state; leave it alone then.
    if (state.state === 'error') return;
    showDocsAddress(state.provider);
  });

  applyProvider(state.provider);
  render();

  return { getState: () => ({ ...state }) };
}

/** @type {{ getState: () => OnboardingState } | null} */
let currentView = null;

/**
 * The live state of the setup card, for diagnostics: the provider and the state
 * name. Never the key, because the page does not keep one.
 * @returns {OnboardingState|null}
 */
export function getOnboardingState() {
  return currentView === null ? null : currentView.getState();
}

// Only the onboarding document has this card; importing the module elsewhere is a no-op.
if (typeof document !== 'undefined' && document.getElementById('onboarding-card')) {
  window.__KAI_STATES__ = [...ONBOARDING_STATES];
  currentView = initOnboardingView(document, window.zuri);
}
