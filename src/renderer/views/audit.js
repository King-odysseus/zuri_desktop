/**
 * Audit log view (design node 0:14163, route /settings/audit).
 *
 * The node draws the page six times: default, loading (the log is still being
 * read), empty (nothing has been recorded), filtered (no entry matches the
 * filters), expanded (one entry's detail is open) and exporting (the export is
 * being prepared). All six are one markup tree, and `?state=` picks one, the
 * way account.js, connectors.js and desktop.js do.
 *
 * Two more names are offered for the states a screen check opens: error, the
 * log file could not be read; and disabled, the drawn page with every control
 * out of reach. They reuse the same tree, so a frame is a change of values
 * rather than a second layout.
 *
 * What is real here: filtering, opening and closing an entry's detail, and the
 * CSV export. What is not: where the entries come from. The log store is not on
 * the board yet, so the page holds the drawn entries and says so rather than
 * pretending to read a file that does not exist.
 */

import { enhanceSelects } from '../ui/select.js';

// The node's six frames first, then the two standard states a screen check
// also opens. A frame missing from this list is a name a screen check can open
// and land on nothing.
const STATES = ['default', 'loading', 'empty', 'filtered', 'expanded', 'exporting', 'error', 'disabled'];

window.__KAI_STATES__ = STATES;

const EXPORT_DELAY_MS = 900; // the exporting frame's dwell, from the node's frame
const SKELETON_ROWS = 4; // the drawn rows the loading frame stands in for

// The page's closing note. The disabled frame swaps it for a line that says why
// nothing can be pressed, then every other frame puts this one back.
const FOOTNOTE = 'Kept on this PC. Nothing is uploaded.';

/**
 * The entries the node draws, newest first. `ageDays` is what the date filter
 * compares against, kept apart from the time the row prints so a frame reads
 * the same whenever it is opened.
 */
const DRAWN_ENTRIES = [
  {
    id: 'run-morning-briefing',
    time: '09:42',
    ageDays: 0.05,
    tool: 'Automation',
    target: 'Morning briefing',
    status: 'Done',
    tone: 'success',
    details: [
      ['Started', 'Today 09:42:06'],
      ['Finished', 'Today 09:42:09, after 3.1 s'],
      ['Steps', '3 of 3 completed'],
      ['Result', 'Briefing written to workspace/briefings/today.md'],
    ],
  },
  {
    id: 'open-notepad',
    time: '09:12',
    ageDays: 0.15,
    tool: 'openApp',
    target: 'notepad.exe',
    status: 'Allowed',
    tone: 'success',
    details: [
      ['Mode', 'Act'],
      ['Duration', '0.4 s'],
      ['Allow-list', 'notepad.exe is on the app allow-list'],
      ['Result', 'Window opened and focused'],
    ],
  },
  {
    id: 'write-meeting-notes',
    time: '08:55',
    ageDays: 0.3,
    tool: 'writeFile',
    target: 'workspace/notes/meeting.md',
    status: 'Confirmed',
    tone: 'success',
    details: [
      ['Mode', 'Act'],
      ['Duration', '0.1 s'],
      ['Size', '1.8 KB'],
      ['Result', 'File replaced, the previous copy kept as meeting.md.bak'],
    ],
  },
  {
    id: 'read-contract',
    time: '08:31',
    ageDays: 0.6,
    tool: 'readFile',
    target: 'workspace/contracts/acme.pdf',
    status: 'Read',
    tone: 'neutral',
    details: [
      ['Mode', 'Ask'],
      ['Duration', '0.2 s'],
      ['Size', '412 KB'],
      ['Result', 'Text read for this answer only'],
    ],
  },
  {
    id: 'fetch-jobs',
    time: 'Yesterday 18:20',
    ageDays: 1.2,
    tool: 'webFetch',
    target: 'hiring.cafe/jobs',
    status: 'Read',
    tone: 'neutral',
    details: [
      ['Mode', 'Ask'],
      ['Duration', '1.2 s'],
      ['Size', '248 KB'],
      ['Result', 'Page text read for this answer only'],
    ],
  },
  {
    id: 'open-notion',
    time: 'Yesterday 17:04',
    ageDays: 1.3,
    tool: 'openUrl',
    target: 'notion.so/docs',
    status: 'Blocked',
    tone: 'warning',
    details: [
      ['Mode', 'Act'],
      ['Reason', 'notion.so/docs is not on the URL allow-list'],
      ['Result', 'Nothing was opened'],
    ],
  },
  {
    id: 'run-inbox-sweep',
    time: 'Oct 17',
    ageDays: 2.4,
    tool: 'Automation',
    target: 'Inbox sweep',
    status: 'Done',
    tone: 'success',
    details: [
      ['Started', 'Oct 17 07:30:00'],
      ['Finished', 'Oct 17 07:30:12, after 12.4 s'],
      ['Steps', '5 of 5 completed'],
      ['Result', '3 messages flagged, 1 reminder created'],
    ],
  },
];

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
 *   rows: HTMLElement,
 *   rowTemplate: HTMLTemplateElement,
 *   emptyBody: HTMLElement,
 *   filteredBody: HTMLElement,
 *   errorBody: HTMLElement,
 *   tool: HTMLSelectElement,
 *   status: HTMLSelectElement,
 *   date: HTMLSelectElement,
 *   clear: HTMLButtonElement,
 *   retry: HTMLButtonElement,
 *   export: HTMLButtonElement,
 *   exportLabel: HTMLElement,
 *   footnote: HTMLElement,
 *   live: HTMLElement,
 * }}
 */
function collectElements() {
  /** @param {string} id */
  const byId = (id) => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`audit.html is missing #${id}`);
    return found;
  };

  return {
    page: document.body,
    rows: byId('audit-rows'),
    rowTemplate: /** @type {HTMLTemplateElement} */ (byId('audit-row-template')),
    emptyBody: byId('audit-empty-body'),
    filteredBody: byId('audit-filtered-body'),
    errorBody: byId('audit-error-body'),
    tool: /** @type {HTMLSelectElement} */ (byId('audit-filter-tool')),
    status: /** @type {HTMLSelectElement} */ (byId('audit-filter-status')),
    date: /** @type {HTMLSelectElement} */ (byId('audit-filter-date')),
    clear: /** @type {HTMLButtonElement} */ (byId('audit-clear')),
    retry: /** @type {HTMLButtonElement} */ (byId('audit-retry')),
    export: /** @type {HTMLButtonElement} */ (byId('audit-export')),
    exportLabel: byId('audit-export-label'),
    footnote: byId('audit-footnote'),
    live: byId('audit-live'),
  };
}

const el = collectElements();

/**
 * One drawn entry, paired with the rows it produced, so filtering and opening a
 * detail never have to guess which table rows belong to which entry.
 * @type {Array<{ entry: typeof DRAWN_ENTRIES[number], row: HTMLTableRowElement, detail: HTMLTableRowElement, toggle: HTMLButtonElement }>}
 */
let drawn = [];

/** @type {number | undefined} */
let exportTimer;

/**
 * @param {string} message
 * @returns {void}
 */
function announce(message) {
  el.live.textContent = message;
}

/**
 * Replace the table body with placeholder rows while the log is being read, so
 * the frame says "not read yet" rather than "nothing recorded".
 * @returns {void}
 */
function renderSkeleton() {
  drawn = [];
  el.rows.replaceChildren(
    ...Array.from({ length: SKELETON_ROWS }, () => {
      const row = document.createElement('tr');
      row.className = 'audit-row audit-row-skeleton';
      row.setAttribute('aria-hidden', 'true');

      for (const column of ['time', 'tool', 'target', 'status', 'toggle']) {
        const cell = document.createElement('td');
        cell.className = `audit-cell audit-cell-${column}`;
        if (column !== 'toggle') {
          const bar = document.createElement('span');
          bar.className = 'audit-skeleton-bar';
          cell.append(bar);
        }
        row.append(cell);
      }

      return row;
    }),
  );
}

/**
 * Draw one entry and its detail panel from the template.
 * @param {typeof DRAWN_ENTRIES[number]} entry
 * @returns {{ row: HTMLTableRowElement, detail: HTMLTableRowElement, toggle: HTMLButtonElement }}
 */
function createEntryRows(entry) {
  const fragment = el.rowTemplate.content.cloneNode(true);
  /** @type {HTMLTableRowElement} */
  const row = /** @type {HTMLTableRowElement} */ (fragment.querySelector('.audit-row'));
  /** @type {HTMLTableRowElement} */
  const detail = /** @type {HTMLTableRowElement} */ (fragment.querySelector('.audit-detail-row'));

  const detailId = `audit-detail-${entry.id}`;
  detail.id = detailId;

  row.dataset.tool = entry.tool;
  row.dataset.status = entry.status;
  row.dataset.ageDays = String(entry.ageDays);

  const time = /** @type {HTMLElement} */ (row.querySelector('.audit-cell-time'));
  time.textContent = entry.time;

  const tool = /** @type {HTMLElement} */ (row.querySelector('.audit-cell-tool'));
  tool.textContent = entry.tool;

  const target = /** @type {HTMLElement} */ (row.querySelector('.audit-cell-target'));
  target.textContent = entry.target;
  target.title = entry.target; // a long path is truncated, not lost

  const status = /** @type {HTMLElement} */ (row.querySelector('.audit-status'));
  status.textContent = entry.status;
  status.dataset.tone = entry.tone;

  /** @type {HTMLButtonElement} */
  const toggle = /** @type {HTMLButtonElement} */ (row.querySelector('.audit-toggle'));
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detailId);
  toggle.setAttribute('aria-label', `Details for ${entry.tool} on ${entry.target}`);

  /** @type {HTMLElement} */
  const list = /** @type {HTMLElement} */ (detail.querySelector('.audit-detail'));
  list.replaceChildren(
    ...entry.details.map(([label, value]) => {
      const pair = document.createElement('div');
      pair.className = 'audit-detail-pair';

      const term = document.createElement('dt');
      term.className = 'audit-detail-label';
      term.textContent = label;

      const description = document.createElement('dd');
      description.className = 'audit-detail-value';
      description.textContent = value;

      pair.append(term, description);
      return pair;
    }),
  );

  el.rows.append(fragment);
  return { row, detail, toggle };
}

/**
 * Draw every drawn entry, newest first.
 * @returns {void}
 */
function renderEntries() {
  el.rows.replaceChildren();
  drawn = DRAWN_ENTRIES.map((entry) => ({ entry, ...createEntryRows(entry) }));
  for (const { row, detail } of drawn) {
    row.hidden = false;
    detail.hidden = true;
  }
}

/**
 * @param {string} filter 'all' or one of the tool names
 * @param {string} value
 * @returns {boolean}
 */
function matches(filter, value) {
  return filter === 'all' || filter === value;
}

/**
 * True when the entry survives all three filters.
 * @param {typeof DRAWN_ENTRIES[number]} entry
 * @returns {boolean}
 */
function isVisible(entry) {
  if (!matches(el.tool.value, entry.tool)) return false;
  if (!matches(el.status.value, entry.status)) return false;

  const range = el.date.value;
  if (range === 'all') return true;

  const days = Number(range);
  // A range that is not a number is a broken option, not a reason to hide rows.
  return Number.isFinite(days) ? entry.ageDays <= days : true;
}

/**
 * Hide the entries the filters exclude and put the no-match frame up when
 * nothing is left. The page state is the caller's to set, because the
 * expanding and exporting frames keep this result but own their own name.
 * @returns {number} how many entries are visible
 */
function applyFilters() {
  let shown = 0;
  for (const { entry, row, detail } of drawn) {
    const visible = isVisible(entry);
    row.hidden = !visible;
    if (!visible) detail.hidden = true;
    if (visible) shown += 1;
  }

  el.filteredBody.hidden = shown > 0 || drawn.length === 0;
  return shown;
}

/**
 * @param {typeof DRAWN_ENTRIES[number]} entry
 * @param {boolean} open
 * @returns {void}
 */
function setDetailOpen(entry, open) {
  const pair = drawn.find((item) => item.entry.id === entry.id);
  if (!pair) return;
  pair.detail.hidden = !open;
  pair.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) announce(`Details for ${entry.tool} on ${entry.target} shown.`);
}

/**
 * Put the view into one state. Every state is a change of values, never a second
 * layout, so all eight frames stay comparable in a screenshot.
 * @param {string} state
 * @returns {void}
 */
function applyState(state) {
  const next = STATES.includes(state) ? state : 'default';
  window.clearTimeout(exportTimer);
  el.export.removeAttribute('aria-busy'); // the exporting frame is the only one that sets it

  if (next === 'loading') {
    renderSkeleton();
    el.emptyBody.hidden = true;
    el.filteredBody.hidden = true;
    el.errorBody.hidden = true;
    el.footnote.textContent = FOOTNOTE;
    el.page.setAttribute('aria-busy', 'true');
    for (const control of [el.tool, el.status, el.date]) control.disabled = true;
    el.export.disabled = true;
    el.exportLabel.textContent = 'Export CSV';
    el.page.dataset.state = next;
    announce('Reading the audit log.');
    return;
  }

  if (next === 'empty') {
    drawn = [];
    el.rows.replaceChildren();
    el.emptyBody.hidden = false;
    el.filteredBody.hidden = true;
    el.errorBody.hidden = true;
    el.footnote.textContent = FOOTNOTE;
    el.page.setAttribute('aria-busy', 'false');
    for (const control of [el.tool, el.status, el.date]) control.disabled = true;
    el.export.disabled = true;
    el.exportLabel.textContent = 'Export CSV';
    el.page.dataset.state = next;
    announce('No activity has been recorded yet.');
    return;
  }

  // The error frame: the log file could not be read, so the table keeps its
  // frame and says so instead of drawing an empty log that reads as a quiet day.
  if (next === 'error') {
    drawn = [];
    el.rows.replaceChildren();
    el.emptyBody.hidden = true;
    el.filteredBody.hidden = true;
    el.errorBody.hidden = false;
    el.footnote.textContent = FOOTNOTE;
    el.page.setAttribute('aria-busy', 'false');
    for (const control of [el.tool, el.status, el.date]) control.disabled = true;
    el.export.disabled = true;
    el.exportLabel.textContent = 'Export CSV';
    el.page.dataset.state = next;
    announce('The audit log could not be read.');
    return;
  }

  renderEntries();
  el.emptyBody.hidden = true;
  el.errorBody.hidden = true;
  el.footnote.textContent = FOOTNOTE;
  const locked = next === 'disabled';
  el.page.setAttribute('aria-busy', 'false');
  for (const control of [el.tool, el.status, el.date]) control.disabled = locked;
  el.exportLabel.textContent = 'Export CSV';
  el.export.disabled = next === 'exporting';

  // The disabled frame keeps the drawn rows and takes every control out of
  // reach, the row chevrons included, so nothing on the page can be pressed.
  if (locked) {
    el.export.disabled = true;
    el.footnote.textContent = 'Every control is off while the log is read-only.';
    for (const { toggle } of drawn) toggle.disabled = true;
  }

  if (next === 'filtered') {
    for (const { row, detail } of drawn) {
      row.hidden = true;
      detail.hidden = true;
    }
    el.filteredBody.hidden = false;
    el.page.dataset.state = next;
    announce('No entries match these filters.');
    return;
  }

  const shown = applyFilters();
  el.page.dataset.state = next;

  if (next === 'expanded' && drawn.length > 0) {
    setDetailOpen(drawn[0].entry, true);
    announce(`One of ${shown} entries is open.`);
    return;
  }

  if (next === 'exporting') {
    el.exportLabel.textContent = 'Exporting...';
    el.export.setAttribute('aria-busy', 'true');
    announce(`Preparing ${shown} entries for export.`);
    return;
  }

  if (locked) {
    announce('The audit log is read-only. Every control is off.');
    return;
  }

  announce(shown === drawn.length ? '' : `Showing ${shown} of ${drawn.length} entries.`);
}

/**
 * Choose the columns written to the file. The detail pairs go into one cell so
 * a row stays one line, which is what a spreadsheet expects.
 * @param {typeof DRAWN_ENTRIES[number]} entry
 * @returns {string[]}
 */
function csvCells(entry) {
  const detail = entry.details.map(([label, value]) => `${label}: ${value}`).join('; ');
  return [entry.time, entry.tool, entry.target, entry.status, detail];
}

/**
 * @param {string} value
 * @returns {string}
 */
function csvField(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Today as YYYY-MM-DD in the machine's own calendar. Built from local parts on
 * purpose: toISOString() would turn an evening export into tomorrow's date.
 * @returns {string}
 */
function localDateStamp() {
  const now = new Date();
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Hand the visible entries to the browser as a CSV file. No main-process call:
 * the file is built from what is already on the page, so an export cannot fail
 * because a channel is missing.
 * @returns {number} how many entries were written
 */
function downloadCsv() {
  const visible = DRAWN_ENTRIES.filter(isVisible);
  const lines = [
    ['Time', 'Tool', 'Target', 'Status', 'Details'].map(csvField).join(','),
    ...visible.map((entry) => csvCells(entry).map(csvField).join(',')),
  ];

  try {
    const blob = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zuri-audit-${localDateStamp()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    // The rows are still on screen, so the reader loses nothing but the file.
    console.error('audit: the CSV export could not be saved', error);
    announce('The export could not be saved. The entries are still on this page.');
    return 0;
  }

  return visible.length;
}

/**
 * Show the exporting frame for a moment, then hand over the file and settle
 * back on the page the filters describe.
 * @returns {void}
 */
function startExport() {
  if (el.export.disabled) return;
  applyState('exporting');

  exportTimer = window.setTimeout(() => {
    const count = downloadCsv();
    applyState('default');
    if (count > 0) announce(`Exported ${count} ${count === 1 ? 'entry' : 'entries'}.`);
  }, EXPORT_DELAY_MS);
}

/**
 * A filter change is a read of the same table, so it never leaves the page in a
 * frame that hides why the rows changed.
 * @returns {void}
 */
function handleFilterChange() {
  const shown = applyFilters();
  el.page.dataset.state = shown === 0 && drawn.length > 0 ? 'filtered' : 'default';
  announce(
    shown === 0 && drawn.length > 0
      ? 'No entries match these filters.'
      : shown === drawn.length
        ? ''
        : `Showing ${shown} of ${drawn.length} entries.`,
  );
}

el.rows.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest('.audit-toggle');
  if (!(button instanceof HTMLButtonElement)) return;

  const row = button.closest('.audit-row');
  const pair = drawn.find((item) => item.row === row);
  if (!pair) return;

  const open = button.getAttribute('aria-expanded') !== 'true';
  setDetailOpen(pair.entry, open);
  el.page.dataset.state = 'default';
});

for (const control of [el.tool, el.status, el.date]) {
  control.addEventListener('change', handleFilterChange);
}

el.clear.addEventListener('click', () => {
  el.tool.value = 'all';
  el.status.value = 'all';
  el.date.value = '7';
  applyState('default');
});

// Try again re-reads the log. The store is not on the board yet, so the frame
// settles on the drawn entries rather than pretending a file was opened.
el.retry.addEventListener('click', () => applyState('default'));

el.export.addEventListener('click', startExport);

applyState(stateFromSearch('state'));

// Every filter is the drawn dropdown (ui/select.js). The native selects keep the
// values the filter and the Clear button read, and the list they open is the
// design's Select / Menu instead of the system's.
enhanceSelects(document);
