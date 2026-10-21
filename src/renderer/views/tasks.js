/**
 * Tasks (design node "0:9586"): the page views/tasks.html and the "tasks"
 * destination in the shell.
 *
 * One surface builder draws both, so the page and the shell can never drift
 * apart. Every read and write goes through `window.zuri.tasks`, so a task only
 * reaches the list once it is in tasks.json; the view never invents a row.
 *
 * A task is `{ id, title, notes, due, priority, done, createdAt, updatedAt,
 * completedAt }` (see src/main/store.js). `due` is an ISO string or null,
 * `priority` is 'low' | 'medium' | 'high', and `done` is what the filters split
 * on: completing a task sets it true and the row leaves the Active list.
 */

import { element } from '../ui/dom.js';

/** Order the filters are drawn in, matching the design's segmented row. */
export const TASK_FILTERS = Object.freeze(['active', 'done', 'all']);

const PRIORITIES = Object.freeze(['low', 'medium', 'high']);
const PRIORITY_LABEL = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High' });
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------------------------------------------------------------------------
   Reading a task

   Kept as pure functions so the list, the counts and the tests all agree on
   what "Today", "Awaiting you" and "Overdue" mean.
   ------------------------------------------------------------------------- */

/**
 * Midnight local time for a date, so "today" is a calendar comparison rather
 * than a difference in hours.
 * @param {Date} value
 * @returns {number}
 */
function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/**
 * @param {Date} value
 * @returns {string}
 */
function clock(value) {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * The due column's text: "Today · 17:00", "Overdue · 3 days", "No date".
 * @param {string|null|undefined} due
 * @param {Date} [now]
 * @returns {string}
 */
export function formatDue(due, now = new Date()) {
  if (typeof due !== 'string' || due === '') return 'No date';
  const when = new Date(due);
  if (Number.isNaN(when.getTime())) return 'No date';

  const days = Math.round((startOfDay(when) - startOfDay(now)) / DAY_MS);
  if (days === 0) return `Today · ${clock(when)}`;
  if (days === 1) return `Tomorrow · ${clock(when)}`;
  if (days === -1) return `Yesterday · ${clock(when)}`;
  if (days < -1) return `Overdue · ${Math.abs(days)} days`;
  if (days <= 6) return `${WEEKDAYS[when.getDay()]} · ${clock(when)}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()]} · ${clock(when)}`;
}

/**
 * Whether a task's due date is in the past.
 * @param {object} task
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOverdue(task, now = new Date()) {
  if (typeof task?.due !== 'string' || task.due === '') return false;
  const when = new Date(task.due).getTime();
  return Number.isNaN(when) === false && when < now.getTime();
}

/**
 * The status column: done, awaiting you (overdue and still open), or active.
 * @param {object} task
 * @param {Date} [now]
 * @returns {{ label: string, tone: 'done'|'awaiting'|'active' }}
 */
export function statusFor(task, now = new Date()) {
  if (task?.done === true) return { label: 'Done', tone: 'done' };
  if (isOverdue(task, now)) return { label: 'Awaiting you', tone: 'awaiting' };
  return { label: 'Active', tone: 'active' };
}

/**
 * @param {unknown} priority
 * @returns {string}
 */
export function priorityLabel(priority) {
  return PRIORITY_LABEL[priority] ?? PRIORITY_LABEL.medium;
}

/**
 * Open tasks first, soonest due date next, oldest first as the tie-break. The
 * store sorts the same way; sorting here too keeps an optimistic update in the
 * order the next read would return.
 * @param {object[]} tasks
 * @returns {object[]}
 */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    const aDue = typeof a.due === 'string' && a.due !== '' ? Date.parse(a.due) : Number.POSITIVE_INFINITY;
    const bDue = typeof b.due === 'string' && b.due !== '' ? Date.parse(b.due) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

/**
 * The rows a filter shows.
 * @param {object[]} tasks
 * @param {'active'|'done'|'all'} filter
 * @returns {object[]}
 */
export function tasksForFilter(tasks, filter) {
  if (filter === 'active') return tasks.filter((task) => task.done !== true);
  if (filter === 'done') return tasks.filter((task) => task.done === true);
  return tasks.slice();
}

/**
 * How many tasks each filter would show, for the counts in the segmented row.
 * @param {object[]} tasks
 * @returns {{ active: number, done: number, all: number }}
 */
export function countTasks(tasks) {
  const done = tasks.filter((task) => task.done === true).length;
  return { active: tasks.length - done, done, all: tasks.length };
}

/**
 * An ISO string as the value a `datetime-local` input expects (local time, no
 * seconds, no zone). Empty when the task has no date.
 * @param {string|null|undefined} due
 * @returns {string}
 */
function toDateTimeLocal(due) {
  if (typeof due !== 'string' || due === '') return '';
  const when = new Date(due);
  if (Number.isNaN(when.getTime())) return '';
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}T${clock(when)}`;
}

/**
 * A `datetime-local` value as the ISO string the store saves, or null when the
 * field is empty. An unparseable value is null too: the store rejects it and
 * the form says why.
 * @param {string} value
 * @returns {string|null}
 */
function fromDateTimeLocal(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  return when.toISOString();
}

/* ---------------------------------------------------------------------------
   The bridge

   `window.zuri.tasks` exists only inside Electron. In a plain browser the page
   says so and shows no rows, rather than drawing sample tasks the person never
   asked for.
   ------------------------------------------------------------------------- */

/**
 * @returns {{ list: Function, create: Function, update: Function, delete: Function }|null}
 */
function tasksApi() {
  const api = typeof globalThis.window === 'undefined' ? null : globalThis.window.zuri;
  const tasks = api?.tasks;
  if (!tasks || typeof tasks.list !== 'function' || typeof tasks.create !== 'function') return null;
  return tasks;
}

/**
 * Run one bridge call and flatten a rejected promise into the store's result
 * shape, so every caller has one thing to branch on.
 * @param {() => Promise<{ ok: boolean, data?: unknown, error?: { code?: string, message?: string } }>} call
 * @returns {Promise<{ ok: boolean, data?: unknown, error?: { code: string, message: string } }>}
 */
async function callThrough(call) {
  try {
    return await call();
  } catch (error) {
    return {
      ok: false,
      error: { code: 'TASKS_UNAVAILABLE', message: String(error?.message ?? 'Tasks could not be reached.') },
    };
  }
}

/**
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(message) {
  return { ok: false, error: { code: 'TASKS_UNAVAILABLE', message } };
}

/* ---------------------------------------------------------------------------
   Small pieces of markup
   ------------------------------------------------------------------------- */

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5l5 5L20 6.5',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
};

/**
 * @param {keyof ICONS} name
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
function icon(name, className = 'tasks-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.7');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * A Low / Medium / High segmented control, the priority field the design uses
 * in both the New task sheet and the inline row editor.
 * @param {string} value
 * @param {(next: string) => void} onChange
 * @returns {HTMLElement}
 */
function priorityGroup(value, onChange) {
  const group = element('div', 'tasks-segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Priority');

  /** @type {HTMLElement[]} */
  const options = [];
  let current = PRIORITIES.includes(value) ? value : 'medium';

  const paint = () => {
    for (const option of options) {
      const selected = option.dataset.priority === current;
      option.setAttribute('aria-checked', selected ? 'true' : 'false');
      option.classList.toggle('is-selected', selected);
      option.tabIndex = selected ? 0 : -1;
    }
  };

  for (const priority of PRIORITIES) {
    const option = element('button', 'tasks-segment', PRIORITY_LABEL[priority]);
    option.type = 'button';
    option.dataset.priority = priority;
    option.setAttribute('role', 'radio');
    option.addEventListener('click', () => {
      current = priority;
      paint();
      option.focus();
      onChange(priority);
    });
    options.push(option);
    group.append(option);
  }

  paint();
  return group;
}

/**
 * A labelled form field: `<label>` around the label text and its input.
 * @param {string} labelText
 * @param {HTMLElement} control
 * @returns {HTMLElement}
 */
function field(labelText, control) {
  const wrapper = element('label', 'tasks-field');
  wrapper.append(element('span', 'tasks-field-label', labelText), control);
  return wrapper;
}

/**
 * @param {string} tag
 * @param {string} className
 * @returns {HTMLInputElement}
 */
function input(tag = 'input', className = 'tasks-input') {
  const control = document.createElement(tag);
  control.className = className;
  return control;
}

/* ---------------------------------------------------------------------------
   The surface

   Everything below draws into one container: header, filters, list, the states
   the design names (loading, empty, save failed), and the two dialogs.
   ------------------------------------------------------------------------- */

/**
 * Mount the Tasks surface into `host`.
 *
 * @param {HTMLElement} host
 * @param {{ cards?: boolean }} [options] `cards` draws the two
 *   summary cards under the list (the page); the shell's narrower column skips
 *   them.
 * @returns {{ reload: () => Promise<void>, element: HTMLElement }}
 */
export function mountTasks(host, options = {}) {
  const api = tasksApi();

  /** @type {{ tasks: object[], filter: 'active'|'done'|'all', editingId: string|null, busy: boolean }} */
  const state = { tasks: [], filter: 'active', editingId: null, busy: false };

  /* -- header ------------------------------------------------------------- */

  const newButton = element('button', 'tasks-primary');
  newButton.type = 'button';
  newButton.dataset.action = 'new-task';
  newButton.append(icon('plus', 'tasks-icon'), element('span', '', 'New task'));
  newButton.addEventListener('click', () => openSheet());

  const header = element('header', 'tasks-header');
  const copy = element('div', 'tasks-header-copy');
  copy.append(
    element('h1', 'tasks-title', 'Tasks'),
    element('p', 'tasks-lead', 'What you asked Zuri to remember, with its date and priority.'),
  );
  header.append(copy, newButton);

  /* -- filter row --------------------------------------------------------- */

  const filterRow = element('div', 'tasks-toolbar');
  const filterGroup = element('div', 'tasks-filters');
  filterGroup.setAttribute('role', 'group');
  filterGroup.setAttribute('aria-label', 'Filter tasks');

  /** @type {Map<string, HTMLElement>} */
  const filterButtons = new Map();
  for (const filter of TASK_FILTERS) {
    const control = element('button', 'tasks-filter');
    control.type = 'button';
    control.dataset.filter = filter;
    control.append(
      element('span', '', filter.charAt(0).toUpperCase() + filter.slice(1)),
      element('span', 'tasks-filter-count', '0'),
    );
    control.addEventListener('click', () => {
      state.filter = filter;
      state.editingId = null;
      render();
    });
    filterButtons.set(filter, control);
    filterGroup.append(control);
  }

  const meta = element('p', 'tasks-meta', 'tasks.json');
  filterRow.append(filterGroup, meta);

  /* -- list --------------------------------------------------------------- */

  const list = element('div', 'tasks-list');
  const columns = element('div', 'tasks-columns');
  columns.setAttribute('aria-hidden', 'true');
  const columnFacts = element('div', 'tasks-row-facts');
  columnFacts.append(
    element('span', 'tasks-column-label', 'Due'),
    element('span', 'tasks-column-label', 'Priority'),
    element('span', 'tasks-column-label', 'Status'),
  );
  columns.append(
    element('span', ''),
    element('span', 'tasks-column-label', 'Task'),
    columnFacts,
    element('span', ''),
  );

  const empty = element('div', 'tasks-empty');
  const emptyMark = element('span', 'tasks-empty-mark');
  emptyMark.append(icon('check', 'tasks-empty-icon'));
  empty.append(
    emptyMark,
    element('h2', 'tasks-empty-title', 'No tasks yet'),
    element('p', 'tasks-empty-text', 'Press New task to add the first one. Everything you add is written to tasks.json on this PC.'),
  );
  const emptyAction = element('button', 'tasks-primary tasks-empty-action', 'New task');
  emptyAction.type = 'button';
  emptyAction.addEventListener('click', () => openSheet());
  empty.append(emptyAction);

  const loading = element('div', 'tasks-loading');
  loading.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index += 1) loading.append(element('div', 'tasks-skeleton'));

  const banner = element('div', 'tasks-banner');
  banner.hidden = true;
  banner.setAttribute('role', 'alert');
  const bannerText = element('p', 'tasks-banner-text', '');
  const bannerRetry = element('button', 'tasks-banner-action', 'Try again');
  bannerRetry.type = 'button';
  bannerRetry.addEventListener('click', () => {
    void reload();
  });
  banner.append(bannerText, bannerRetry);

  const card = element('section', 'tasks-card');
  card.setAttribute('aria-label', 'Tasks');
  card.append(columns, loading, empty, banner, list);

  const status = element('p', 'tasks-status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  /* -- the two summary cards under the list (the page only) ---------------- */

  const cards = [];
  if (options.cards === true) {
    const reminderCard = element('section', 'tasks-summary-card');
    reminderCard.append(
      element('p', 'tasks-summary-label', 'Next reminder'),
      element('p', 'tasks-summary-value', 'Nothing scheduled'),
      element('p', 'tasks-summary-text', 'Reminders land here once one is scheduled.'),
    );

    const storageCard = element('section', 'tasks-summary-card');
    const storageValue = element('p', 'tasks-summary-value tasks-summary-path', 'tasks.json');
    storageCard.append(
      element('p', 'tasks-summary-label', 'Stored on this PC'),
      storageValue,
      element('p', 'tasks-summary-text', 'One file, no cloud sync.'),
    );
    cards.push(reminderCard, storageCard);

    const api2 = typeof globalThis.window === 'undefined' ? null : globalThis.window.zuri;
    const info = typeof api2?.app?.info === 'function' ? api2.app : null;
    if (info) {
      void callThrough(() => info.info()).then((result) => {
        if (result.ok && typeof result.data?.userData === 'string') {
          storageValue.textContent = `${result.data.userData}/zuri/tasks.json`;
        }
      });
    }
  }

  /* -- the New task sheet ------------------------------------------------- */

  const sheet = element('div', 'tasks-scrim');
  sheet.hidden = true;
  const sheetForm = element('form', 'tasks-sheet');
  sheetForm.noValidate = true;

  const sheetTitle = element('h2', 'tasks-sheet-title', 'New task');
  const sheetClose = element('button', 'tasks-sheet-close');
  sheetClose.type = 'button';
  sheetClose.setAttribute('aria-label', 'Close');
  sheetClose.textContent = 'Close';
  sheetClose.addEventListener('click', closeSheet);

  const titleInput = input();
  titleInput.id = 'task-title';
  titleInput.name = 'title';
  titleInput.type = 'text';
  titleInput.maxLength = 200;
  titleInput.autocomplete = 'off';
  titleInput.placeholder = 'What needs doing?';

  const dueInput = input();
  dueInput.id = 'task-due';
  dueInput.name = 'due';
  dueInput.type = 'datetime-local';

  let sheetPriority = 'medium';
  const sheetPriorityGroup = priorityGroup(sheetPriority, (next) => {
    sheetPriority = next;
  });

  const hint = element('p', 'tasks-hint', 'Add a title to enable Save.');
  const formError = element('p', 'tasks-form-error', '');
  formError.hidden = true;

  const sheetCancel = element('button', 'tasks-secondary', 'Cancel');
  sheetCancel.type = 'button';
  sheetCancel.addEventListener('click', closeSheet);

  const sheetSave = element('button', 'tasks-primary', 'Save');
  sheetSave.type = 'submit';
  sheetSave.disabled = true;

  const sheetActions = element('div', 'tasks-sheet-actions');
  sheetActions.append(sheetCancel, sheetSave);

  const sheetHead = element('div', 'tasks-sheet-head');
  sheetHead.append(sheetTitle, sheetClose);

  sheetForm.append(
    sheetHead,
    field('Task title', titleInput),
    field('Due', dueInput),
    (() => {
      const wrapper = element('div', 'tasks-field');
      wrapper.append(element('span', 'tasks-field-label', 'Priority'), sheetPriorityGroup);
      return wrapper;
    })(),
    hint,
    formError,
    sheetActions,
  );
  sheet.append(sheetForm);

  titleInput.addEventListener('input', () => {
    const ready = titleInput.value.trim() !== '';
    sheetSave.disabled = !ready;
    hint.textContent = ready ? 'Saved to tasks.json on this PC.' : 'Add a title to enable Save.';
  });

  sheetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveNewTask();
  });

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  /* -- the delete confirmation ------------------------------------------- */

  const confirm = element('div', 'tasks-scrim');
  confirm.hidden = true;
  const dialog = element('div', 'tasks-dialog');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'tasks-confirm-title');
  dialog.setAttribute('aria-describedby', 'tasks-confirm-text');

  const dialogTitle = element('h2', 'tasks-dialog-title', 'Delete this task?');
  dialogTitle.id = 'tasks-confirm-title';
  const dialogText = element('p', 'tasks-dialog-text', '');
  dialogText.id = 'tasks-confirm-text';

  const confirmCancel = element('button', 'tasks-secondary', 'Cancel');
  confirmCancel.type = 'button';
  confirmCancel.addEventListener('click', closeConfirm);

  const confirmDelete = element('button', 'tasks-danger', 'Delete');
  confirmDelete.type = 'button';

  const dialogActions = element('div', 'tasks-dialog-actions');
  dialogActions.append(confirmCancel, confirmDelete);

  dialog.append(dialogTitle, dialogText, dialogActions);
  confirm.append(dialog);

  /** @type {object|null} */
  let pendingDelete = null;

  confirmDelete.addEventListener('click', () => {
    const task = pendingDelete;
    closeConfirm();
    if (task) void deleteTask(task);
  });

  confirm.addEventListener('click', (event) => {
    if (event.target === confirm) closeConfirm();
  });

  /* -- putting the surface together -------------------------------------- */

  const root = element('div', 'tasks-surface');
  const column = element('div', 'tasks-column');
  column.append(header, filterRow, card, status);
  if (cards.length > 0) {
    const summary = element('div', 'tasks-summary');
    summary.append(...cards);
    column.append(summary);
  }
  root.append(column, sheet, confirm);
  host.append(root);

  /* -- dialogs ------------------------------------------------------------ */

  /** @param {boolean} open */
  function setSheetOpen(open) {
    sheet.hidden = !open;
    root.dataset.sheet = open ? 'open' : 'closed';
    if (open) {
      titleInput.value = '';
      dueInput.value = '';
      sheetPriority = 'medium';
      paintPriority(sheetPriorityGroup, sheetPriority);
      sheetSave.disabled = true;
      hint.textContent = 'Add a title to enable Save.';
      formError.hidden = true;
      formError.textContent = '';
      titleInput.focus();
    } else {
      newButton.focus();
    }
  }

  function openSheet() {
    closeConfirm();
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
  }

  function closeConfirm() {
    pendingDelete = null;
    confirm.hidden = true;
  }

  /**
   * @param {object} task
   */
  function askDelete(task) {
    pendingDelete = task;
    dialogText.textContent = `“${task.title}” will be removed from tasks.json. This cannot be undone.`;
    confirm.hidden = false;
    root.dataset.confirm = 'open';
    confirmDelete.focus();
  }

  /**
   * @param {HTMLElement} group
   * @param {string} value
   */
  function paintPriority(group, value) {
    for (const option of group.querySelectorAll('[data-priority]')) {
      const selected = option.dataset.priority === value;
      option.setAttribute('aria-checked', selected ? 'true' : 'false');
      option.classList.toggle('is-selected', selected);
      option.tabIndex = selected ? 0 : -1;
    }
  }

  // Esc closes whichever layer is open. One listener on the surface keeps this
  // working for both the page and the shell, which each own one surface.
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!confirm.hidden) {
      event.stopPropagation();
      closeConfirm();
      return;
    }
    if (!sheet.hidden) {
      event.stopPropagation();
      closeSheet();
    }
  });

  /* -- rendering ---------------------------------------------------------- */

  /**
   * @param {string} message
   */
  function say(message) {
    status.textContent = message;
  }

  /**
   * @param {string|null} message
   */
  function showError(message) {
    banner.hidden = message === null;
    bannerText.textContent = message ?? '';
  }

  function renderFilters() {
    const counts = countTasks(state.tasks);
    for (const [filter, control] of filterButtons) {
      const selected = filter === state.filter;
      control.setAttribute('aria-pressed', selected ? 'true' : 'false');
      control.classList.toggle('is-selected', selected);
      const badge = control.querySelector('.tasks-filter-count');
      if (badge) badge.textContent = String(counts[filter] ?? 0);
    }
    meta.textContent = `${counts.active} active · ${counts.done} done · tasks.json`;
  }

  function render() {
    renderFilters();
    list.replaceChildren();

    const rows = tasksForFilter(state.tasks, state.filter);
    const loaded = root.dataset.loaded === 'true';
    loading.hidden = loaded;
    empty.hidden = loaded === false || rows.length > 0;
    columns.hidden = loaded === false || rows.length === 0;

    if (loaded === false) return;

    if (rows.length === 0) {
      const filtered = state.filter !== 'all' && state.tasks.length > 0;
      empty.querySelector('.tasks-empty-title').textContent = filtered ? `No ${state.filter} tasks` : 'No tasks yet';
      empty.querySelector('.tasks-empty-text').textContent = filtered
        ? 'Everything in tasks.json is in the other list.'
        : 'Press New task to add the first one. Everything you add is written to tasks.json on this PC.';
      return;
    }

    for (const task of rows) {
      list.append(state.editingId === task.id ? buildEditRow(task) : buildRow(task));
    }
  }

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  function buildRow(task) {
    const row = element('article', 'tasks-row');
    row.dataset.taskId = task.id;
    row.dataset.done = task.done === true ? 'true' : 'false';

    const check = element('button', 'tasks-check');
    check.type = 'button';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', task.done === true ? 'true' : 'false');
    check.setAttribute('aria-label', task.done === true ? `Reopen “${task.title}”` : `Complete “${task.title}”`);
    check.append(icon('check', 'tasks-check-icon'));
    check.addEventListener('click', () => {
      void toggleDone(task);
    });

    const title = element('button', 'tasks-row-title', task.title);
    title.type = 'button';
    title.dataset.action = 'edit';
    title.setAttribute('aria-label', `Edit “${task.title}”`);
    title.addEventListener('click', () => {
      state.editingId = task.id;
      render();
      const editor = list.querySelector(`[data-task-id="${task.id}"] .tasks-edit-title`);
      if (editor) editor.focus();
    });

    const note = typeof task.notes === 'string' && task.notes !== '' ? task.notes : '';
    const rowCopy = element('div', 'tasks-row-copy');
    rowCopy.append(title, element('p', 'tasks-row-meta', note === '' ? `Added ${formatAdded(task.createdAt)}` : note));

    const facts = element('div', 'tasks-row-facts');
    const due = element('span', 'tasks-row-due', formatDue(task.due));
    if (isOverdue(task) && task.done !== true) due.dataset.overdue = 'true';
    const pill = element('span', 'tasks-pill', priorityLabel(task.priority));
    pill.dataset.priority = PRIORITIES.includes(task.priority) ? task.priority : 'medium';

    const statusInfo = statusFor(task);
    const statusPill = element('span', 'tasks-row-status');
    statusPill.dataset.tone = statusInfo.tone;
    statusPill.append(element('span', 'tasks-dot'), element('span', '', statusInfo.label));
    facts.append(due, pill, statusPill);

    const remove = element('button', 'tasks-row-action');
    remove.type = 'button';
    remove.dataset.action = 'delete';
    remove.setAttribute('aria-label', `Delete “${task.title}”`);
    remove.append(icon('trash', 'tasks-icon'));
    remove.addEventListener('click', () => askDelete(task));

    row.append(check, rowCopy, facts, remove);
    return row;
  }

  /**
   * The row's edit mode (design "05 Tasks - row in edit mode"): title, due and
   * priority in place, Enter saves and Esc cancels.
   * @param {object} task
   * @returns {HTMLElement}
   */
  function buildEditRow(task) {
    const row = element('article', 'tasks-row tasks-row-editing');
    row.dataset.taskId = task.id;

    const editor = element('form', 'tasks-edit');
    editor.noValidate = true;

    const titleField = input('input', 'tasks-input tasks-edit-title');
    titleField.type = 'text';
    titleField.maxLength = 200;
    titleField.value = task.title;
    titleField.setAttribute('aria-label', 'Task title');

    const dueField = input('input', 'tasks-input tasks-edit-due');
    dueField.type = 'datetime-local';
    dueField.value = toDateTimeLocal(task.due);
    dueField.setAttribute('aria-label', 'Due');

    let priority = PRIORITIES.includes(task.priority) ? task.priority : 'medium';
    const group = priorityGroup(priority, (next) => {
      priority = next;
    });

    const cancel = element('button', 'tasks-secondary', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      state.editingId = null;
      render();
    });

    const save = element('button', 'tasks-primary', 'Save');
    save.type = 'submit';
    save.disabled = task.title === '';

    titleField.addEventListener('input', () => {
      save.disabled = titleField.value.trim() === '';
    });

    const actions = element('div', 'tasks-edit-actions');
    actions.append(cancel, save);

    editor.append(
      field('Task title', titleField),
      field('Due', dueField),
      (() => {
        const wrapper = element('div', 'tasks-field');
        wrapper.append(element('span', 'tasks-field-label', 'Priority'), group);
        return wrapper;
      })(),
      actions,
    );

    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      const nextTitle = titleField.value.trim();
      if (nextTitle === '') return;
      void saveEdit(task, { title: nextTitle, due: fromDateTimeLocal(dueField.value), priority });
    });

    row.append(editor);
    return row;
  }

  /* -- actions ------------------------------------------------------------ */

  /**
   * @param {string|null|undefined} createdAt
   * @returns {string}
   */
  function formatAdded(createdAt) {
    if (typeof createdAt !== 'string' || createdAt === '') return 'today';
    const when = new Date(createdAt);
    if (Number.isNaN(when.getTime())) return 'today';
    return formatDue(when.toISOString()).toLowerCase();
  }

  /**
   * @returns {Promise<void>}
   */
  async function reload() {
    if (!api) {
      root.dataset.loaded = 'true';
      state.tasks = [];
      showError('Tasks can only be read inside Zuri.');
      render();
      return;
    }

    const result = await callThrough(() => api.list());
    root.dataset.loaded = 'true';
    if (!result.ok) {
      state.tasks = [];
      showError(result.error?.message ?? 'tasks.json could not be read.');
      render();
      return;
    }
    showError(null);
    state.tasks = sortTasks(Array.isArray(result.data) ? result.data : []);
    render();
  }

  /** @returns {Promise<void>} */
  async function saveNewTask() {
    const title = titleInput.value.trim();
    if (title === '' || !api) {
      if (!api) formErrorShow('Tasks can only be saved inside Zuri.');
      return;
    }

    sheetSave.disabled = true;
    formError.hidden = true;
    const result = await callThrough(() =>
      api.create({ title, due: fromDateTimeLocal(dueInput.value), priority: sheetPriority }),
    );

    if (!result.ok) {
      formError.hidden = false;
      formError.textContent = result.error?.message ?? 'That task could not be saved.';
      sheetSave.disabled = false;
      return;
    }

    state.tasks = sortTasks([...state.tasks, result.data]);
    setSheetOpen(false);
    showError(null);
    say('Task saved to tasks.json.');
    render();
  }

  /**
   * @param {string} message
   */
  function formErrorShow(message) {
    formError.hidden = false;
    formError.textContent = message;
  }

  /**
   * @param {object} task
   * @param {object} patch
   * @returns {Promise<void>}
   */
  async function saveEdit(task, patch) {
    if (!api) {
      say('Tasks can only be saved inside Zuri.');
      return;
    }

    const result = await callThrough(() => api.update({ id: task.id, ...patch }));
    if (!result.ok) {
      showError(result.error?.message ?? 'That task could not be saved.');
      return;
    }

    showError(null);
    state.editingId = null;
    state.tasks = sortTasks(state.tasks.map((entry) => (entry.id === task.id ? result.data : entry)));
    say('Task saved.');
    render();
  }

  /**
   * Completing sets `done: true`, which is what takes the row out of the Active
   * list; reopening puts it back.
   * @param {object} task
   * @returns {Promise<void>}
   */
  async function toggleDone(task) {
    if (!api) {
      say('Tasks can only be saved inside Zuri.');
      return;
    }

    const row = list.querySelector(`[data-task-id="${task.id}"]`);
    if (row) row.dataset.completing = 'true';
    say(task.done === true ? 'Reopening the task…' : 'Completing the task…');

    const result = await callThrough(() => api.update({ id: task.id, done: task.done !== true }));
    if (!result.ok) {
      if (row) delete row.dataset.completing;
      showError(result.error?.message ?? 'That task could not be saved.');
      say('');
      return;
    }

    showError(null);
    if (state.editingId === task.id) state.editingId = null;
    state.tasks = sortTasks(state.tasks.map((entry) => (entry.id === task.id ? result.data : entry)));
    say(task.done === true ? 'Task reopened.' : 'Task completed.');
    render();
  }

  /**
   * @param {object} task
   * @returns {Promise<void>}
   */
  async function deleteTask(task) {
    if (!api) {
      say('Tasks can only be deleted inside Zuri.');
      return;
    }

    const result = await callThrough(() => api.delete({ id: task.id }));
    if (!result.ok) {
      showError(result.error?.message ?? 'That task could not be deleted.');
      return;
    }

    showError(null);
    if (state.editingId === task.id) state.editingId = null;
    state.tasks = state.tasks.filter((entry) => entry.id !== task.id);
    say('Task deleted from tasks.json.');
    render();
  }

  /* -- start -------------------------------------------------------------- */

  render();
  void reload();

  if (typeof globalThis.window !== 'undefined') {
    const stateApi = globalThis.window.zuri?.state;
    if (typeof stateApi?.onChanged === 'function') {
      stateApi.onChanged((event) => {
        if (event?.area !== 'tasks') return;
        void reload();
      });
    }
  }

  return { reload, element: root };
}

/* ---------------------------------------------------------------------------
   The two callers
   ------------------------------------------------------------------------- */

/**
 * The "tasks" destination in the shell. A centred, scrollable page like the
 * other routed views, wide enough for the due / priority / status columns.
 * @returns {HTMLElement}
 */
export function createView() {
  const page = element('div', 'view-page');
  const inner = element('div', 'view-page-inner tasks-view-inner');
  page.append(inner);
  mountTasks(inner);
  return page;
}

/**
 * The standalone page (views/tasks.html). The page keeps its own top bar, so the
 * surface is mounted into the column the file provides.
 * @param {Document} [doc]
 * @returns {{ reload: () => Promise<void>, element: HTMLElement }|null}
 */
export function initTasksPage(doc = document) {
  const host = doc.getElementById('tasks-surface');
  if (!host) return null;
  host.replaceChildren();
  wireTheme(doc);
  return mountTasks(host, { cards: true });
}

/**
 * The page's own light/dark toggle, the same one the other design pages carry.
 * The shell's toggle lives in the top bar and saves to settings.json.
 * @param {Document} doc
 */
function wireTheme(doc) {
  const control = doc.getElementById('tasks-theme');
  if (!control) return;
  control.addEventListener('click', () => {
    const root = doc.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    control.setAttribute('aria-pressed', String(next === 'dark'));
    control.setAttribute(
      'aria-label',
      next === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
    );
  });
}

// The page loads this module with a script tag; the shell imports createView.
// Guarded so Node can import the pure helpers (scripts/selftest.js does).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initTasksPage(document);
}
