/**
 * Settings view: the provider key form.
 *
 * A key is typed once, handed to main over `zuri:settings:setKey`, and the field is
 * cleared immediately. This module's state holds the provider name and `hasKey`
 * only: nothing assigns the key to a value that outlives the save, and nothing
 * writes it into the DOM or a log. Main never sends it back either, so a saved key
 * exists in exactly one place, `secrets.json`.
 */

import { container, element } from '../ui/dom.js';
import { enhanceSelect } from '../ui/select.js';
import { fillSidebarUser } from '../ui/shell.js';
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

  // The dropdown is the drawn control from ui/select.js: the native select keeps the
  // value and the change event this view reads, so nothing below has to change. It
  // covers the standalone page and the shell's own overview panel, which builds the
  // same form and binds here.
  enhanceSelect(elements.provider, { doc });

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

   The Settings overview, drawn from node 0:6194: a 940-wide page on the canvas tone,
   a title over a two-column body. The left column is six 72 px section rows 12 apart
   (Appearance, Providers and keys, Connectors, Desktop, Audit, Account), the right
   column two 332 px cards (the model and theme card, then the Act allow-list).

   Two honest adaptations of that frame:
   - Each row is a disclosure, not a link. The design's chevron implies a sub-page,
     and this build has none, so the row opens in place (aria-expanded) instead of
     going nowhere. Where a section has a real control, the panel holds it.
   - The right card is titled "Model and appearance" rather than "Model and overlay":
     there is no overlay setting to switch yet, and a toggle that saves nothing would
     be a lie. Its two rows are the model (read-only, chosen by the provider adapter)
     and the theme, which is real and persists.
   --------------------------------------------------------------------------- */

/** The two choices the theme row offers, in the order the tokens define them. */
const THEMES = ['light', 'dark'];

/** Line-art icons for the six section rows (24 grid, 1.5 stroke, currentColor). */
const SECTION_ICONS = Object.freeze({
  appearance: [
    'M12 8a4 4 0 100 8 4 4 0 000-8z',
    'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4',
  ],
  providers: ['M14.5 9.5a4 4 0 11-2.8 6.8L9 19H6v-3l2.7-2.7', 'M15.5 8.5h.01'],
  connectors: [
    'M10.5 13.5a4 4 0 005.7 0l2.3-2.3a4 4 0 10-5.7-5.7L11.5 6.7',
    'M13.5 10.5a4 4 0 00-5.7 0L5.5 12.8a4 4 0 105.7 5.7l1.3-1.2',
  ],
  desktop: ['M3 5.5h18v10H3z', 'M9 20h6M12 15.5V20'],
  audit: ['M4 7h16M4 12h16M4 17h10'],
  account: ['M12 12a4 4 0 100-8 4 4 0 000 8z', 'M5 21c1.4-3.4 3.9-5 7-5s5.6 1.6 7 5'],
});

/**
 * An SVG in the document's namespace. Built node by node rather than from a string
 * so nothing here can become markup.
 * @param {readonly string[]} paths
 * @param {number} size
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
function svgIcon(paths, size, className = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  for (const data of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

/**
 * Build the Settings destination.
 * @param {Document} [doc]
 * @param {{ navigate?: Function }} [shell] The router passes its own navigation, not
 *   the bridge; the bridge is read from `window.zuri` below.
 * @returns {HTMLElement}
 */
export function createView(doc = document, shell = {}) {
  void shell;
  const api = typeof window === 'undefined' ? null : (window.zuri ?? null);
  const bridge = Boolean(api?.settings?.get);
  const current = () => doc.documentElement.dataset.theme ?? 'dark';

  /* ---------------------------------------------------------------- page shell */

  const page = element('div', 'settings-ov-page');
  const inner = element('div', 'settings-ov-inner');
  const head = element('header', 'settings-ov-head');
  const heading = element('h2', 'settings-ov-title', 'Settings');
  const lead = element(
    'p',
    'settings-ov-lead',
    'Appearance, keys, connectors, desktop control and the audit trail.',
  );
  head.append(heading, lead);

  const columns = element('div', 'settings-ov-columns');
  const sectionsColumn = element('div', 'settings-ov-sections');
  const aside = element('aside', 'settings-ov-aside');
  columns.append(sectionsColumn, aside);
  inner.append(head, columns);
  page.append(inner);

  /* ------------------------------------------------------------ status + store */

  const statusLine = element('p', 'settings-ov-status');
  statusLine.setAttribute('role', 'status');
  statusLine.setAttribute('aria-live', 'polite');
  statusLine.hidden = true;
  /** @param {string} message @param {'ok'|'error'} [tone] */
  function say(message, tone = 'ok') {
    statusLine.textContent = message;
    statusLine.dataset.tone = tone;
    statusLine.hidden = message === '';
  }

  /** Settings the page has read, or null before the bridge answers. */
  let settings = null;
  /** @type {Array<() => void>} Repaint callbacks, one per widget that reads `settings`. */
  const painters = [];
  const repaint = () => {
    for (const paint of painters) paint();
  };

  /**
   * Merge a patch into settings.json and repaint on success.
   * @param {object} patch
   * @param {string} [done] Message to show when the write lands.
   * @returns {Promise<boolean>}
   */
  async function persist(patch, done = 'Saved.') {
    if (!bridge) {
      say('Settings can only be saved inside Zuri.', 'error');
      return false;
    }
    try {
      const result = await api.settings.save(patch);
      if (result?.ok !== true) {
        say(result?.error?.message ?? 'The change was not saved.', 'error');
        return false;
      }
      settings = { ...(settings ?? {}), ...(result.data ?? patch) };
      repaint();
      say(done);
      return true;
    } catch (error) {
      say(String(error?.message ?? error), 'error');
      return false;
    }
  }

  /* --------------------------------------------------------------- theme choice */

  const themeChoices = THEMES.map((theme) => {
    const control = element('button', 'settings-ov-choice', theme === 'light' ? 'Light' : 'Dark');
    control.type = 'button';
    control.dataset.theme = theme;
    control.addEventListener('click', async () => {
      const result = await setTheme(theme);
      if (result.ok) say(`Theme is ${theme}.`);
      else say(result.message ?? 'The theme was not saved.', 'error');
      repaint();
    });
    return control;
  });
  painters.push(() => {
    for (const control of themeChoices) {
      control.setAttribute('aria-pressed', String(control.dataset.theme === current()));
    }
  });

  /* ------------------------------------------------------------ the six sections */

  const row = (section) => {
    const shellRow = element('div', 'settings-ov-row');
    shellRow.dataset.section = section.id;

    const toggle = element('button', 'settings-ov-row-main');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.id = `settings-ov-row-${section.id}`;
    toggle.setAttribute('aria-controls', `settings-ov-panel-${section.id}`);

    const icon = element('span', 'settings-ov-row-icon');
    icon.append(svgIcon(SECTION_ICONS[section.id], 18));

    const copy = element('span', 'settings-ov-row-copy');
    copy.append(
      element('span', 'settings-ov-row-title', section.title),
      element('span', 'settings-ov-row-desc', section.desc),
    );

    const chip = element('span', 'settings-ov-row-chip', '');
    chip.dataset.tone = 'default';

    const chevron = svgIcon(['M9 6l6 6-6 6'], 16, 'settings-ov-row-chevron');

    toggle.append(icon, copy, chip, chevron);

    const panel = element('div', 'settings-ov-row-panel');
    panel.id = `settings-ov-panel-${section.id}`;
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', toggle.id);

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      shellRow.dataset.open = String(open);
      if (open && typeof section.onOpen === 'function') section.onOpen(panel);
    });

    shellRow.append(toggle, panel);
    section.chip = chip;
    section.panel = panel;
    section.onOpen = section.onOpen ?? null;
    return shellRow;
  };

  /** A plain paragraph in a section panel. */
  const note = (text, className = 'settings-ov-row-text') => element('p', className, text);

  /* Appearance ------------------------------------------------------------ */
  const appearancePanel = () => {
    const wrap = element('div', 'settings-ov-panel-body');
    wrap.append(
      note('The window follows this choice, and it comes back after a restart.'),
      container('div', 'settings-ov-choices', themeChoices),
    );
    return wrap;
  };

  /* Providers and keys ----------------------------------------------------- */
  // The key form is the one the standalone providers page uses (initSettingsKeyView),
  // mounted here on first open. The key never comes back to this window: the form
  // asks main for a boolean and renders that.
  let keyViewMounted = false;
  const providersPanel = () => {
    const wrap = element('div', 'settings-ov-panel-body');
    wrap.append(
      note(
        'Your key is kept by the main process on this computer and never comes back to this window. This page learns one thing about it: whether one is saved.',
      ),
    );

    if (!bridge) {
      wrap.append(note('Keys can only be saved inside Zuri.', 'settings-ov-row-text settings-ov-row-text-quiet'));
      return wrap;
    }

    const form = element('form', 'settings-ov-key-form');
    form.id = 'provider-key-form';
    form.noValidate = true;

    const labelProvider = element('label', 'settings-ov-field-label', 'Provider');
    labelProvider.setAttribute('for', 'provider-key-provider');
    const provider = element('select', 'settings-ov-field');
    provider.id = 'provider-key-provider';
    provider.name = 'provider';
    for (const [value, text] of [
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic'],
    ]) {
      const option = element('option', '', text);
      option.value = value;
      provider.append(option);
    }

    // The drawn control (ui/select.js) replaces the select's own box, and a native
    // select was drawing the arrow that said "this opens a list". The field keeps one,
    // drawn beside the control the way the standalone page draws it.
    const providerField = element('span', 'settings-ov-select');
    const providerChevron = element('span', 'select-icon');
    providerChevron.setAttribute('aria-hidden', 'true');
    providerChevron.append(svgIcon(['m6 9 6 6 6-6'], 16));
    providerField.append(provider, providerChevron);

    // The drawn control from ui/select.js, like every other dropdown in the app: the
    // native list is painted by Windows and arrives as a pale system menu in the dark
    // shell. Called after the append because the trigger is inserted beside the select,
    // and that needs the select to already have a parent.
    enhanceSelect(provider, { doc });

    const labelKey = element('label', 'settings-ov-field-label', 'API key');
    labelKey.setAttribute('for', 'provider-key');
    const keyInput = element('input', 'settings-ov-field');
    keyInput.id = 'provider-key';
    keyInput.name = 'key';
    keyInput.type = 'password';
    keyInput.autocomplete = 'off';
    keyInput.placeholder = 'Paste your key';

    const actions = element('div', 'settings-ov-form-actions');
    const saveKey = element('button', 'settings-ov-save', 'Save key');
    saveKey.type = 'submit';
    saveKey.id = 'provider-key-save';
    const removeKey = element('button', 'settings-ov-remove', 'Remove key');
    removeKey.type = 'button';
    removeKey.id = 'provider-key-remove';
    const keyStatus = element('span', 'settings-ov-key-status', 'Checking...');
    keyStatus.id = 'provider-key-status';
    const keyError = element('p', 'settings-ov-key-error');
    keyError.id = 'provider-key-error';
    keyError.hidden = true;

    actions.append(saveKey, removeKey, keyStatus);
    form.append(labelProvider, providerField, labelKey, keyInput, actions, keyError);
    wrap.append(form);

    // The form's behaviour is the standalone page's own module, so the two cannot
    // drift. It binds to the ids above, which exist once this panel is in the DOM.
    queueMicrotask(() => {
      if (keyViewMounted) return;
      keyViewMounted = true;
      try {
        initSettingsKeyView(doc, api);
      } catch (error) {
        say(String(error?.message ?? error), 'error');
      }
    });
    return wrap;
  };

  /* Connectors ------------------------------------------------------------- */
  const connectorsPanel = () =>
    container('div', 'settings-ov-panel-body', [
      note(
        'Connectors are not part of this build yet. Act reads and writes your own files in the workspace instead of going through a third-party service.',
      ),
    ]);

  /* Desktop ---------------------------------------------------------------- */
  const desktopPanel = () => {
    const wrap = element('div', 'settings-ov-panel-body');
    const count = () => {
      const apps = Array.isArray(settings?.allowedApps) ? settings.allowedApps.length : 0;
      const urls = Array.isArray(settings?.allowedUrls) ? settings.allowedUrls.length : 0;
      return apps + urls;
    };
    const line = element('p', 'settings-ov-row-text');
    const paint = () => {
      const total = count();
      line.textContent =
        total === 0
          ? 'Act may open nothing yet. Add the apps and sites it should be able to use in the card beside this list.'
          : `Act may open the ${total} ${total === 1 ? 'entry' : 'entries'} listed in the card beside this list, and nothing else.`;
    };
    paint();
    painters.push(paint);
    wrap.append(line);
    return wrap;
  };

  /* Audit ------------------------------------------------------------------ */
  const auditPanel = () =>
    container('div', 'settings-ov-panel-body', [
      note(
        'No audit trail is recorded in this build yet. When Act runs, its steps are shown in the conversation as they happen.',
      ),
    ]);

  /* Account ---------------------------------------------------------------- */
  const accountPanel = () => {
    const wrap = element('div', 'settings-ov-panel-body');
    wrap.append(note('The name on the sidebar account row. It stays on this computer.'));

    const field = element('div', 'settings-ov-field-group');
    const label = element('label', 'settings-ov-field-label', 'Your name');
    label.setAttribute('for', 'settings-ov-name');
    const input = element('input', 'settings-ov-field');
    input.id = 'settings-ov-name';
    input.type = 'text';
    input.autocomplete = 'name';
    input.placeholder = 'Your name';
    input.maxLength = 60;
    field.append(label, input);

    const actions = element('div', 'settings-ov-form-actions');
    const save = element('button', 'settings-ov-save', 'Save name');
    save.type = 'button';
    const folder = element('button', 'settings-ov-remove', 'Open data folder');
    folder.type = 'button';
    actions.append(save, folder);

    const paint = () => {
      if (doc.activeElement !== input) input.value = String(settings?.name ?? '');
    };
    paint();
    painters.push(paint);

    save.addEventListener('click', async () => {
      const name = input.value.trim().slice(0, 60);
      if (await persist({ name }, 'Name saved.')) {
        // The sidebar row shows the same name, so keep it in step without a reload.
        try {
          fillSidebarUser(name);
        } catch {
          // The row is decoration; a failure to repaint it must not undo the save.
        }
      }
    });

    folder.addEventListener('click', async () => {
      if (!api?.settings?.openDataFolder) {
        say('The data folder can only be opened inside Zuri.', 'error');
        return;
      }
      const result = await api.settings.openDataFolder();
      if (result?.ok !== true) say(result?.error?.message ?? 'The data folder could not be opened.', 'error');
    });

    wrap.append(field, actions);
    return wrap;
  };

  const SECTIONS = [
    { id: 'appearance', title: 'Appearance', desc: 'Theme and how the window looks', build: appearancePanel },
    {
      id: 'providers',
      title: 'Providers and keys',
      desc: 'Provider, model name and the API key held in main',
      build: providersPanel,
    },
    { id: 'connectors', title: 'Connectors', desc: 'Research and file tools you have linked to Zuri', build: connectorsPanel },
    { id: 'desktop', title: 'Desktop', desc: 'What Act mode may open on this computer', build: desktopPanel },
    { id: 'audit', title: 'Audit', desc: 'Every Act step and every file written', build: auditPanel },
    { id: 'account', title: 'Account', desc: 'Your name, and where the data lives', build: accountPanel },
  ];

  sectionsColumn.append(element('p', 'settings-ov-group-label', 'Settings sections'));
  const rowList = element('div', 'settings-ov-row-list');
  const rowNodes = SECTIONS.map((section) => {
    const node = row(section);
    // Built on first open, so a panel that needs the bridge cannot fail on load.
    const originalOpen = section.onOpen;
    section.onOpen = (panel) => {
      if (panel.childElementCount === 0) panel.append(section.build());
      if (typeof originalOpen === 'function') originalOpen(panel);
    };
    return node;
  });
  rowList.append(...rowNodes);
  sectionsColumn.append(rowList);

  /* ---------------------------------------------------------- the right column */

  const modelCard = element('section', 'settings-ov-card');
  modelCard.append(element('h3', 'settings-ov-card-title', 'Model and appearance'));

  const modelRow = element('div', 'settings-ov-card-row');
  const modelChip = element('span', 'settings-ov-card-value', 'Not chosen');
  const modelPaint = () => {
    const model = String(settings?.model ?? '').trim();
    modelChip.textContent = model === '' ? 'Provider default' : model;
  };
  modelPaint();
  painters.push(modelPaint);
  const modelCopy = element('div', 'settings-ov-card-copy');
  modelCopy.append(
    element('span', 'settings-ov-card-label', 'Default model'),
    element('span', 'settings-ov-card-hint', 'Chosen by the provider adapter'),
  );
  modelRow.append(modelCopy, modelChip);

  const themeRow = element('div', 'settings-ov-card-row');
  const themeCopy = element('div', 'settings-ov-card-copy');
  themeCopy.append(
    element('span', 'settings-ov-card-label', 'Theme'),
    element('span', 'settings-ov-card-hint', 'Saved, and restored on launch'),
  );
  themeRow.append(themeCopy, container('div', 'settings-ov-choices', themeChoices));

  modelCard.append(modelRow, themeRow);

  /* Allowed apps and sites -------------------------------------------------- */
  const allowedCard = element('section', 'settings-ov-card');
  allowedCard.append(element('h3', 'settings-ov-card-title', 'Allowed apps and sites'));
  allowedCard.append(
    element('p', 'settings-ov-card-hint', 'Act mode may open only what is listed here'),
  );

  const list = element('ul', 'settings-ov-allow-list');
  const listEmpty = element('li', 'settings-ov-allow-empty', 'Nothing allowed yet');

  const appGlyph = ['M4 6h7v6H4z', 'M13 6h7v6h-7z', 'M4 14h7v4H4z', 'M13 14h7v4h-7z'];
  const siteGlyph = ['M12 4a8 8 0 100 16 8 8 0 000-16z', 'M4 12h16', 'M12 4c2.5 2.2 2.5 13.8 0 16', 'M12 4c-2.5 2.2-2.5 13.8 0 16'];

  /** One allowed entry: glyph, label, and the control that takes it away. */
  const allowRow = (value, kind) => {
    const item = element('li', 'settings-ov-allow-row');
    const glyph = element('span', 'settings-ov-allow-icon');
    glyph.append(svgIcon(kind === 'url' ? siteGlyph : appGlyph, 14));
    const label = element('span', 'settings-ov-allow-label', value);
    const remove = element('button', 'settings-ov-allow-remove');
    remove.type = 'button';
    remove.append(svgIcon(['M6 6l12 12M18 6L6 18'], 12));
    remove.setAttribute('aria-label', `Remove ${value}`);
    remove.title = `Remove ${value}`;
    remove.addEventListener('click', async () => {
      const key = kind === 'url' ? 'allowedUrls' : 'allowedApps';
      const next = (Array.isArray(settings?.[key]) ? settings[key] : []).filter(
        (entry) => entry !== value,
      );
      await persist({ [key]: next }, `${value} removed.`);
    });
    item.append(glyph, label, remove);
    return item;
  };

  const paintAllowList = () => {
    const apps = Array.isArray(settings?.allowedApps) ? settings.allowedApps : [];
    const urls = Array.isArray(settings?.allowedUrls) ? settings.allowedUrls : [];
    const rows = [...apps.map((value) => [value, 'app']), ...urls.map((value) => [value, 'url'])];
    if (rows.length === 0) {
      list.replaceChildren(listEmpty);
      return;
    }
    list.replaceChildren(...rows.map(([value, kind]) => allowRow(String(value), kind)));
  };
  paintAllowList();
  painters.push(paintAllowList);

  const addForm = element('form', 'settings-ov-allow-add');
  addForm.noValidate = true;
  const addLabel = element('label', 'settings-ov-visually-hidden', 'Add an app or site');
  addLabel.setAttribute('for', 'settings-ov-allow-input');
  const addInput = element('input', 'settings-ov-field');
  addInput.id = 'settings-ov-allow-input';
  addInput.type = 'text';
  addInput.placeholder = 'Add an app or site';
  addInput.autocomplete = 'off';
  addInput.maxLength = 120;
  const addButton = element('button', 'settings-ov-add', 'Add');
  addButton.type = 'submit';
  addForm.append(addLabel, addInput, addButton);
  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const typed = addInput.value.trim();
    if (typed === '') return;

    // A value with a scheme, a leading wildcard or a dot in it is a site; anything
    // else is an application name. The same rule main's Act allow-list uses when it
    // decides whether a target is a file, an app or a URL.
    const isUrl = /:\/\/|^\*\.|^[\w-]+\.[a-z]{2,}$/i.test(typed);
    const key = isUrl ? 'allowedUrls' : 'allowedApps';
    const existing = Array.isArray(settings?.[key]) ? settings[key] : [];
    if (existing.some((entry) => String(entry).toLowerCase() === typed.toLowerCase())) {
      say(`${typed} is already allowed.`, 'error');
      return;
    }

    if (await persist({ [key]: [...existing, typed] }, `${typed} allowed.`)) {
      addInput.value = '';
      addInput.focus();
    }
  });

  allowedCard.append(list, addForm, element('p', 'settings-ov-card-hint', 'Separate several entries with commas'));

  aside.append(modelCard, allowedCard);

  /* ---------------------------------------------------------------- foot + load */

  const foot = element('p', 'settings-ov-foot', 'settings.json · read on launch, written on save');
  inner.append(foot, statusLine);

  repaint();

  // Read settings once. Until the answer lands the chips stay neutral rather than
  // guessing ("No key saved" before a check has run would be a false statement).
  if (bridge) {
    api.settings
      .get()
      .then((result) => {
        if (result?.ok === true) {
          settings = result.data ?? {};
          repaint();
        }
      })
      .catch(() => {
        // A failed read is not a failed page: the rows still open and say what they
        // can. The chip for the key says so below.
      });
  }

  /** Chips: each row states something true about the build, never a sample value. */
  const keyChip = SECTIONS[1].chip;
  const setChip = (chip, text, tone = 'default') => {
    chip.textContent = text;
    chip.dataset.tone = tone;
  };

  setChip(SECTIONS[0].chip, String(current()).replace(/^./, (c) => c.toUpperCase()));
  painters.push(() =>
    setChip(SECTIONS[0].chip, String(current()).replace(/^./, (c) => c.toUpperCase())),
  );
  setChip(SECTIONS[2].chip, 'None');
  setChip(SECTIONS[4].chip, 'Not recorded');

  const paintDesktopChip = () => {
    const apps = Array.isArray(settings?.allowedApps) ? settings.allowedApps.length : 0;
    const urls = Array.isArray(settings?.allowedUrls) ? settings.allowedUrls.length : 0;
    setChip(SECTIONS[3].chip, `${apps + urls} allowed`);
  };
  paintDesktopChip();
  painters.push(paintDesktopChip);

  const paintAccountChip = () => {
    const name = String(settings?.name ?? '').trim();
    setChip(SECTIONS[5].chip, name === '' ? 'Not set' : name);
  };
  paintAccountChip();
  painters.push(paintAccountChip);

  if (!bridge || typeof api.settings.keyStatus !== 'function') {
    setChip(keyChip, 'Only inside Zuri');
  } else {
    api.settings
      .keyStatus({})
      .then((result) => {
        if (result?.ok !== true) {
          setChip(keyChip, 'Unknown', 'default');
          return;
        }
        const hasKey = result.data?.hasKey === true;
        setChip(keyChip, hasKey ? 'Key present' : 'No key saved', hasKey ? 'success' : 'default');
      })
      .catch(() => setChip(keyChip, 'Unknown', 'default'));
  }

  return page;
}
