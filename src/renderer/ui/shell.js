/**
 * The three-column shell: which of #sidebar, #chat and #context-panel is
 * collapsed. The state is renderer memory only (architecture.md keeps column
 * state there), so a reload starts from the defaults again.
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

/** Tab bar items that open one column, by data-shell-tab value. */
const TAB_COLUMNS = Object.freeze({ chats: 'sidebar', context: 'context-panel' });

/** Column ids, in DOM order. */
export const COLUMN_IDS = Object.freeze(['sidebar', 'chat', 'context-panel']);

/** @type {Record<string, boolean>} */
const collapsedState = {
  sidebar: false,
  chat: false,
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
 * Wire the collapse toggles and apply the starting state.
 * The breakpoints are read once, at start: a later resize must not undo a choice
 * the user made by hand, so nothing here listens for resize.
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

  // The tab bar's middle item starts a thread by pressing the real New chat
  // button, so the phone route goes through the same handler as the desktop one.
  document
    .querySelector('.shell-tabbar-item[data-shell-tab="new"]')
    ?.addEventListener('click', () => document.getElementById('new-chat-button')?.click());

  setColumnCollapsed('sidebar', viewport.innerWidth < PHONE_BREAKPOINT);
  setColumnCollapsed('context-panel', viewport.innerWidth < CONTEXT_PANEL_BREAKPOINT);
}
