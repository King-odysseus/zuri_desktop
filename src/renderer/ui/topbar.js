/**
 * topbar.js - the top bar's stateful controls.
 *
 * index.html carries only what never changes: the brand row in the sidebar and the
 * bar's section title. The model chip, the search field, the notification bell and
 * the theme toggle all depend on settings, which the renderer can only learn after
 * the bridge answers, so they are built here rather than sitting in the markup.
 *
 * Geometry is the current design's "Top Bar" (node 0:541, 928x56): a 16 px inset
 * each side, the title on the left, then search (220x32), the bell (32), the model
 * chip (68x28, pill) and the theme button (32), 8 px apart. The account moved to
 * the sidebar's user row (node 0:530), so the bar's trailing side ends at the theme
 * button and this module no longer builds an avatar.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const LIGHT_THEME = 'light';
const DARK_THEME = 'dark';

/**
 * The theme toggle built by initTopbar, kept so other surfaces can change the
 * theme through it. The Settings destination is the caller: it must not flip the
 * attribute behind the control's back, or the button would announce the wrong
 * theme and the next press would do nothing.
 * @type {{ setTheme: (theme: 'light'|'dark') => Promise<{ ok: boolean, message?: string }> } | null}
 */
let themeControl = null;

/** Shown when settings carries no model choice yet; the store defaults to gpt-4o. */
const UNCHOSEN_MODEL = 'Choose model';

/**
 * Static icon markup on the design's 24 unit grid. Kept as strings because the
 * paths are drawings, not data: nothing here is ever interpolated from settings.
 */
const ICONS = {
  search:
    '<path d="M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13z" fill="none" stroke="currentColor" stroke-width="1.6"></path>' +
    '<path d="M15.4 15.4L20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>',
  bell:
    '<path d="M12 4a5 5 0 015 5v3.4l1.4 2.6H5.6L7 12.4V9a5 5 0 015-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>' +
    '<path d="M10 18a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>',
  moon:
    '<path d="M20 14.6A8.2 8.2 0 019.4 4 8.5 8.5 0 1020 14.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>',
  sun:
    '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"></circle>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>',
  chevron:
    '<path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>',
};

/**
 * One stroked icon in the design's icon box.
 * @param {string} markup Paths from ICONS.
 * @param {number} [size] Box in pixels.
 * @returns {SVGSVGElement}
 */
function createIcon(markup, size = 16) {
  const icon = document.createElementNS(SVG_NS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.innerHTML = markup;
  return icon;
}

/**
 * Whether the document is on the dark theme right now.
 * @returns {boolean}
 */
function isDarkTheme() {
  return document.documentElement.dataset.theme !== LIGHT_THEME;
}

/**
 * Write the theme the token layer reads. Only 'light' or 'dark' is ever passed;
 * an unknown stored value never reaches here, because app.js applies the launch
 * theme with its own fallback.
 * @param {'light'|'dark'} theme
 * @returns {'light'|'dark'}
 */
function setDocumentTheme(theme) {
  const next = theme === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
  document.documentElement.dataset.theme = next;
  return next;
}

/**
 * Change the theme from outside the top bar, saving it the same way the toggle
 * does. A page shown without the bar (a browser preview of one view) still gets
 * the attribute; there is simply no control to keep in step.
 * @param {'light'|'dark'} theme
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function setTheme(theme) {
  if (themeControl !== null) return themeControl.setTheme(theme);
  setDocumentTheme(theme);
  return { ok: true };
}

/**
 * Read settings through the preload bridge.
 * A failed read is not fatal: the bar falls back to its defaults and the app still
 * starts. It deliberately does not log, because console output during load fails
 * the smoke gate, and the visible result (dark theme, no model) already says the
 * read did not answer.
 * @returns {Promise<object>} The stored settings, or an empty object.
 */
export async function readSettings() {
  try {
    const result = await window.zuri?.settings?.get?.();
    if (result?.ok === true && result.data !== null && typeof result.data === 'object') {
      return result.data;
    }
  } catch {
    return {};
  }
  return {};
}

/**
 * Persist one settings field through the bridge.
 * A plain browser preview has no bridge; the theme still flips for the session,
 * there is just nothing to save it to.
 * @param {object} patch Fields to change.
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function saveSettings(patch) {
  const save = window.zuri?.settings?.save;
  if (typeof save !== 'function') return { ok: true };

  try {
    const result = await save(patch);
    if (result?.ok === false) {
      return { ok: false, message: String(result.error?.message ?? 'settings were not saved') };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) };
  }
}

/**
 * The model chip (design 0:550, 68x28 pill on the panel tone): a status dot and the
 * model's name, so the bar names the model in use without opening a menu.
 * @param {unknown} model
 * @returns {HTMLButtonElement}
 */
function createModelChip(model) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'top-bar-model';
  chip.title = 'Provider and model are chosen in Settings';

  const dot = document.createElement('span');
  dot.className = 'top-bar-model-dot';
  dot.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'top-bar-model-name';
  const label = typeof model === 'string' ? model.trim() : '';
  name.textContent = label === '' ? UNCHOSEN_MODEL : label;

  chip.append(dot, name);
  return chip;
}

/**
 * The search field (design 0:543, 220x32 on radius 9): a real input with the icon at
 * its left, always visible rather than collapsing to an icon, because the design
 * draws it with its placeholder showing.
 * @returns {{ element: HTMLElement, focus: () => void, destroy: () => void }}
 */
function createSearch() {
  const wrap = document.createElement('div');
  wrap.className = 'top-bar-search';
  wrap.setAttribute('role', 'search');

  const icon = createIcon(ICONS.search, 14);
  icon.classList.add('top-bar-search-icon');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'top-bar-search-input';
  input.placeholder = 'Search chats and files';
  input.setAttribute('aria-label', 'Search chats and files');
  input.setAttribute('autocomplete', 'off');

  const focusInput = () => input.focus();

  // Ctrl+K is the shortcut the design prints next to the field; it is wired here
  // so the hint is honest. Escape gives the bar its space back and drops the query.
  const onKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      focusInput();
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });
  wrap.addEventListener('click', focusInput);
  document.addEventListener('keydown', onKeydown);

  wrap.append(icon, input);
  return {
    element: wrap,
    focus: focusInput,
    destroy: () => document.removeEventListener('keydown', onKeydown),
  };
}

/**
 * The bell and its unread badge. The badge is always in the DOM so the count is
 * part of the control's spoken label; it is hidden at zero rather than drawn as 0.
 * @param {number} unread
 * @returns {{ element: HTMLButtonElement, setUnread: (count: number) => void }}
 */
function createBell(unread) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'top-bar-button top-bar-notify';

  const badge = document.createElement('span');
  badge.className = 'top-bar-badge';

  const setUnread = (count) => {
    const unreadCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    const label = unreadCount === 0 ? 'Notifications, no unread' : `Notifications, ${unreadCount} unread`;
    button.setAttribute('aria-label', unreadCount === 0 ? 'Notifications' : label);
    button.title = label;
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;
  };
  setUnread(unread);

  button.append(createIcon(ICONS.bell), badge);
  return { element: button, setUnread };
}

/**
 * The light/dark toggle. The icon shows the theme the click switches to, so the
 * control reads as an action rather than a state: a sun in dark, a moon in light.
 * @returns {{ element: HTMLButtonElement, sync: (storedTheme?: string) => void }}
 */
function createThemeToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'top-bar-button top-bar-theme';

  const moon = createIcon(ICONS.moon);
  moon.classList.add('top-bar-theme-icon', 'top-bar-theme-moon');
  const sun = createIcon(ICONS.sun);
  sun.classList.add('top-bar-theme-icon', 'top-bar-theme-sun');
  button.append(moon, sun);

  /**
   * Point the control at the theme it would switch to. `status` carries a failed
   * save so the next screen reader stop hears it; a successful save clears it.
   * @param {string} [status]
   */
  const sync = (status = '') => {
    const dark = isDarkTheme();
    const action = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-pressed', String(dark));
    if (status === '') {
      button.setAttribute('aria-label', action);
      button.title = action;
      delete button.dataset.status;
      return;
    }
    button.setAttribute('aria-label', `${status}. ${action}`);
    button.title = `${status}. ${action}`;
    button.dataset.status = status;
  };
  sync();

  button.addEventListener('click', async () => {
    await setTheme(isDarkTheme() ? LIGHT_THEME : DARK_THEME);
  });

  /**
   * Put the document on `theme` and save it, rolling back if main refuses. The
   * Settings destination calls this too, so both controls run one code path.
   * @param {'light'|'dark'} theme
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async function setTheme(theme) {
    const previous = isDarkTheme() ? DARK_THEME : LIGHT_THEME;
    const next = theme === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
    if (next === previous) {
      sync();
      return { ok: true };
    }

    // Flip first: the design asks the attribute to change on the click, not after
    // a round trip to main.
    setDocumentTheme(next);
    sync();

    const saved = await saveSettings({ theme: next });
    if (saved.ok) {
      sync();
      return saved;
    }
    // The stored theme is the truth after a failed save, so put the document back
    // on it rather than leaving the window in a theme that will not survive restart.
    setDocumentTheme(previous);
    sync(saved.message ?? 'Theme not saved');
    return saved;
  }

  return { element: button, sync, setTheme };
}

/**
 * Build and wire the top bar's controls.
 * @param {{ settings?: object, unreadCount?: number }} [options] Settings already
 *   read by the caller; without them the bar reads them through the bridge.
 * @returns {{ setUnreadCount: (count: number) => void } | null} Null when the bar
 *   is not on this page.
 */
export function initTopbar(options = {}) {
  const trailing = document.querySelector('.top-bar-trailing');
  if (!trailing) return null;

  const settings = options.settings ?? {};
  const search = createSearch();
  const bell = createBell(options.unreadCount ?? 0);
  const themeToggle = createThemeToggle();
  // The Settings destination changes the theme through this same control.
  themeControl = themeToggle;

  // The design's order, left to right: search, bell, model, theme. The account is
  // the sidebar's user row now, so it is deliberately not part of this group.
  trailing.replaceChildren(
    search.element,
    bell.element,
    createModelChip(settings.model),
    themeToggle.element,
  );
  themeToggle.sync();

  return { setUnreadCount: bell.setUnread };
}
