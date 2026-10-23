/**
 * The three-column shell: which of #sidebar and #context-panel is collapsed.
 * The state is renderer memory only (architecture.md keeps column state there),
 * so a reload starts from the defaults again.
 *
 * #chat is not collapsible, and that is deliberate. As a rail it was a 12 px
 * sliver clipped by the column's own overflow, so the toggle inside it could not
 * be clicked at all and the conversation could not be reopened. It is also the
 * content: with the chat a rail the two panels took about 570 px of the window
 * and every remaining pixel was empty surface. The chat column keeps whatever the
 * two panels leave, always.
 *
 * On a phone the same state does double duty: a collapsed #sidebar is the drawer
 * pushed off screen and a collapsed #context-panel is the panel pulled off it,
 * while the bottom tab bar stays visible underneath the conversation.
 */

/** Below this viewport width the context panel starts collapsed. */
export const CONTEXT_PANEL_BREAKPOINT = 1000;

/**
 * Below this width the three columns cannot share the window: the sidebar
 * becomes a drawer with the bottom tab bar as its handle, so it starts closed.
 */
export const PHONE_BREAKPOINT = 768;

/** The columns that are sheets over the conversation on a phone. */
const PHONE_SHEETS = Object.freeze(['sidebar', 'context-panel']);

/**
 * Tab bar items that open one column, by data-shell-tab value. The everyday
 * destinations carry data-route instead and are handled by ui/router.js, so the bar
 * shows where the app goes without hiding the rest of the navigation behind one
 * item: More opens the drawer that holds the remaining destinations.
 */
const TAB_COLUMNS = Object.freeze({ more: 'sidebar', context: 'context-panel' });

/**
 * The columns that can be collapsed, in DOM order. #chat is absent on purpose;
 * the module comment above says why, and assertColumnName turns a call to
 * collapse it into a loud error rather than a silent dead end.
 */
export const COLUMN_IDS = Object.freeze(['sidebar', 'context-panel']);

/** @type {Record<string, boolean>} */
const collapsedState = {
  sidebar: false,
  'context-panel': false,
};

/**
 * @param {string} name
 * @returns {HTMLElement}
 */
function columnElement(name) {
  const element = document.getElementById(name);
  if (!element) throw new Error(`#${name} is missing from index.html`);
  return element;
}

/**
 * The column's collapse toggle, found by the column it controls.
 * @param {string} name
 * @returns {HTMLButtonElement}
 */
function toggleElement(name) {
  const toggle = document.querySelector(`.shell-toggle[aria-controls="${name}"]`);
  if (!toggle) throw new Error(`#${name} has no collapse toggle in index.html`);
  return toggle;
}

/**
 * The phone tab bar item that opens this column, if the column has one.
 * @param {string} name
 * @returns {HTMLButtonElement | null}
 */
function tabElementForColumn(name) {
  for (const [tab, column] of Object.entries(TAB_COLUMNS)) {
    if (column === name) return document.querySelector(`.shell-tabbar-item[data-shell-tab="${tab}"]`);
  }
  return null;
}

/** @param {string} name */
function assertColumnName(name) {
  if (!COLUMN_IDS.includes(name)) throw new Error(`unknown shell column: ${name}`);
}

/**
 * Mirror one column's state into the DOM: the attribute the stylesheet reads,
 * and the toggle's label and expanded state for assistive technology.
 * @param {string} name
 */
function renderColumn(name) {
  const isCollapsed = collapsedState[name];
  const column = columnElement(name);
  column.dataset.collapsed = String(isCollapsed);

  const toggle = toggleElement(name);
  const label = column.getAttribute('aria-label') ?? name;
  const action = `${isCollapsed ? 'Expand' : 'Collapse'} ${label.toLowerCase()}`;
  toggle.setAttribute('aria-expanded', String(!isCollapsed));
  toggle.setAttribute('aria-label', action);
  toggle.title = action;

  // The phone tab bar shows the same state as the desktop toggle it mirrors.
  tabElementForColumn(name)?.setAttribute('aria-expanded', String(!isCollapsed));
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isColumnCollapsed(name) {
  assertColumnName(name);
  return collapsedState[name];
}

/**
 * Collapse or expand one column.
 * @param {string} name
 * @param {boolean} isCollapsed
 */
export function setColumnCollapsed(name, isCollapsed) {
  assertColumnName(name);
  collapsedState[name] = Boolean(isCollapsed);
  renderColumn(name);
}

/**
 * On a phone both side panels are sheets laid over the conversation, so opening
 * one closes the other; on a desktop they are independent columns and stay put.
 * @param {string} name
 */
function closeOtherSheet(name) {
  if (window.innerWidth >= PHONE_BREAKPOINT) return;
  if (!PHONE_SHEETS.includes(name)) return;
  for (const other of PHONE_SHEETS) {
    if (other !== name) setColumnCollapsed(other, true);
  }
}

/**
 * @param {string} name
 */
export function toggleColumn(name) {
  const isCollapsed = isColumnCollapsed(name);
  // Opening a sheet on a phone closes the other one first.
  if (isCollapsed) closeOtherSheet(name);
  setColumnCollapsed(name, !isCollapsed);
}

/**
 * Names of the columns that are currently collapsed.
 * @returns {string[]}
 */
export function getCollapsedColumns() {
  return COLUMN_IDS.filter((name) => collapsedState[name]);
}

/**
 * Fill the sidebar account row (design "User Row") with the saved name: the row
 * shows initials in the avatar, the name, and the plan underneath. A blank or
 * missing name keeps the neutral "You" the markup ships with, so the row is never
 * empty and nothing here has to guess at an account.
 * @param {string} [name]
 */
export function fillSidebarUser(name) {
  const initials = document.getElementById('sidebar-user-avatar');
  const label = document.getElementById('sidebar-user-name');
  if (!initials || !label) return;

  const words = String(typeof name === 'string' ? name : '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const short = words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

  initials.textContent = short || 'You';
  label.textContent = words.length > 0 ? words.join(' ') : 'You';
}

/**
 * Which layout band a viewport width falls in. The two breakpoints above split
 * the window into three, and each band starts from its own defaults.
 * @param {number} width
 * @returns {'phone' | 'narrow' | 'wide'}
 */
function bandFor(width) {
  if (width < PHONE_BREAKPOINT) return 'phone';
  if (width < CONTEXT_PANEL_BREAKPOINT) return 'narrow';
  return 'wide';
}

/**
 * The columns' starting state for a band: a phone starts with both side panels
 * closed because each one is a full-height sheet over the conversation, a narrow
 * window keeps the sidebar and closes the context panel, a wide one shows all three.
 * @param {'phone' | 'narrow' | 'wide'} band
 */
function applyBandDefaults(band) {
  setColumnCollapsed('sidebar', band === 'phone');
  setColumnCollapsed('context-panel', band !== 'wide');
}

/**
 * Wire the collapse toggles and apply the starting state.
 * The breakpoints decide the starting state only: a window that opens narrow starts
 * with its sheets closed and a wide one shows all three columns. A resize never
 * re-applies them, because a panel the reader opened by hand is theirs to keep - a
 * drag that put it back would undo a deliberate choice.
 * @param {Window} [viewport]
 */
export function initShell(viewport = window) {
  for (const name of COLUMN_IDS) {
    toggleElement(name).addEventListener('click', () => toggleColumn(name));
    renderColumn(name);
  }

  for (const [tab, column] of Object.entries(TAB_COLUMNS)) {
    document
      .querySelector(`.shell-tabbar-item[data-shell-tab="${tab}"]`)
      ?.addEventListener('click', () => toggleColumn(column));
  }

  applyBandDefaults(bandFor(viewport.innerWidth));
}
