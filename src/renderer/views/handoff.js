/**
 * Cloud handoff queue view (design node 0:14565, route /handoff).
 *
 * The node draws the page five times: queued (the default), empty, uploading,
 * failed and completed. All five are one markup tree, and `?state=` picks one,
 * the way account.js, connectors.js, desktop.js and audit.js do.
 *
 * Three more names are real frames rather than synonyms: loading, the queue
 * still being read; error, the read failed; and disabled, the same drawn queue
 * with every control switched off because the queue is paused. A screen check
 * opens those by name, so they are built here instead of aliased away.
 *
 * What is real here: cancelling an item, retrying a failed one and clearing the
 * completed rows, all within the page. What is not: the upload itself. The
 * handoff worker is not on the board yet, so the page holds the drawn queue and
 * says so rather than pretending to talk to a provider it cannot see.
 */

// The node's five frames first, then the three a screen check opens by name:
// the queue being read, the read failing, and the same queue with every
// control off. A frame missing from this list is a name a check can open and
// land on nothing.
const STATES = [
  'queued',
  'empty',
  'uploading',
  'failed',
  'completed',
  'loading',
  'error',
  'disabled',
];

// Names a screen check may reasonably use for the same frame. They cost
// nothing and stop a check from landing on the default frame under a synonym.
const STATE_ALIASES = {
  default: 'queued',
  main: 'queued',
  queue: 'queued',
  sending: 'uploading',
  busy: 'loading',
  done: 'completed',
  sent: 'completed',
};

window.__KAI_STATES__ = STATES;

/**
 * The queue the node draws. Each item mirrors one row: its type glyph, the two
 * lines under the name, its size and its status. `progress` and `error` are the
 * extra lines only the uploading and failed frames show, so the other frames
 * leave them out rather than carrying empty space.
 */
const QUEUE_ITEMS = [
  {
    id: 'acme-agreement',
    kind: 'document',
    name: 'Acme services agreement.docx',
    detail: 'Document summary \u00b7 48 pages',
    size: '6.1 MB',
    status: 'queued',
  },
  {
    id: 'board-pack',
    kind: 'document',
    name: 'Q3 board pack.pdf',
    detail: 'Document summary \u00b7 22 pages',
    size: '6.1 MB',
    status: 'queued',
  },
  {
    id: 'hiring-scan',
    kind: 'research',
    name: 'Hiring market scan',
    detail: 'Web research \u00b7 14 sources',
    size: '860 KB',
    status: 'queued',
  },
  {
    id: 'lease-notes',
    kind: 'document',
    name: 'Lease review notes.docx',
    detail: 'Document summary \u00b7 12 pages',
    size: '1.2 MB',
    status: 'queued',
  },
];

const FRAMES = {
  queued: QUEUE_ITEMS,
  disabled: QUEUE_ITEMS,
  uploading: [
    {
      id: 'acme-agreement',
      kind: 'document',
      name: 'Acme services agreement.docx',
      detail: 'Document summary \u00b7 48 pages',
      size: '6.1 MB',
      status: 'uploading',
      progress: 38,
      progressLabel: '2.4 of 6.1 MB sent',
    },
    {
      id: 'board-pack',
      kind: 'document',
      name: 'Q3 board pack.pdf',
      detail: 'Document summary \u00b7 22 pages',
      size: '6.1 MB',
      status: 'queued',
    },
    {
      id: 'hiring-scan',
      kind: 'research',
      name: 'Hiring market scan',
      detail: 'Web research \u00b7 14 sources',
      size: '860 KB',
      status: 'queued',
    },
  ],
  failed: [
    {
      id: 'acme-agreement',
      kind: 'document',
      name: 'Acme services agreement.docx',
      detail: 'Document summary \u00b7 48 pages',
      size: '6.1 MB',
      status: 'failed',
      error: 'Timed out after 30 s. Nothing was lost.',
    },
    {
      id: 'board-pack',
      kind: 'document',
      name: 'Q3 board pack.pdf',
      detail: 'Document summary \u00b7 22 pages',
      size: '6.1 MB',
      status: 'queued',
    },
    {
      id: 'hiring-scan',
      kind: 'research',
      name: 'Hiring market scan',
      detail: 'Web research \u00b7 14 sources',
      size: '860 KB',
      status: 'queued',
    },
  ],
  completed: [
    {
      id: 'acme-agreement',
      kind: 'document',
      name: 'Acme services agreement.docx',
      detail: 'Document summary \u00b7 48 pages',
      size: '6.1 MB',
      status: 'done',
    },
    {
      id: 'board-pack',
      kind: 'document',
      name: 'Q3 board pack.pdf',
      detail: 'Document summary \u00b7 22 pages',
      size: '6.1 MB',
      status: 'done',
    },
    {
      id: 'hiring-scan',
      kind: 'research',
      name: 'Hiring market scan',
      detail: 'Web research \u00b7 14 sources',
      size: '860 KB',
      status: 'done',
    },
    {
      id: 'lease-notes',
      kind: 'document',
      name: 'Lease review notes.docx',
      detail: 'Document summary \u00b7 12 pages',
      size: '1.2 MB',
      status: 'done',
    },
  ],
  empty: [],
  // Reading and failure both keep the card and the column labels: what is
  // missing is the rows, not the queue. Each draws its own body below the head.
  loading: [],
  error: [],
};

const STATUS_LABELS = {
  queued: 'Queued',
  uploading: 'Uploading',
  failed: 'Failed',
  done: 'Sent',
};

// The order column's check for a sent row, drawn once. A finished item has left
// the queue, so it no longer holds a position number.
const CHECK_GLYPH =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="m5 12.6 4.4 4.4L19 6.6" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" /></svg>';

/** @type {{page: HTMLElement, rows: HTMLElement, template: HTMLTemplateElement, table: HTMLElement, empty: HTMLElement, footer: HTMLElement, count: HTMLElement, clear: HTMLButtonElement, live: HTMLElement}} */
const el = {
  page: document.body,
  rows: document.querySelector('.handoff-rows'),
  template: document.getElementById('handoff-row-template'),
  table: document.querySelector('.handoff-table-wrap'),
  card: document.querySelector('.handoff-card'),
  empty: document.querySelector('.handoff-empty'),
  error: document.getElementById('handoff-error-body'),
  footer: document.querySelector('.handoff-footer'),
  count: document.getElementById('handoff-count'),
  clear: document.getElementById('handoff-clear'),
  live: document.getElementById('handoff-live'),
};

/** The items currently on the page, seeded from the frame that `?state=` names. */
let items = [];
/** Which frame is shown. Kept apart from the items because an action can move an
 * item without changing which frame's layout is drawn. */
let state = 'queued';

/**
 * @param {string} name
 * @returns {string} one of STATES, or 'queued' when the name is unknown
 */
function stateFromSearch(name) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value === null) return 'queued';
  if (STATES.includes(value)) return value;
  return STATE_ALIASES[value] ?? 'queued';
}

function announce(message) {
  el.live.textContent = message;
}

/** @param {number} n */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The footer's count, built from what is actually in the list so a cancelled or
 * retried item changes the sentence instead of leaving the drawn one behind.
 * @param {Array<{status: string}>} list
 */
function countLabel(list) {
  if (list.length === 0) return 'Nothing in the queue';

  const tally = { queued: 0, uploading: 0, failed: 0, done: 0 };
  for (const item of list) tally[item.status] += 1;

  if (tally.done === list.length) return `All ${plural(tally.done, 'item')} sent`;

  const parts = [];
  if (tally.failed > 0) parts.push(`${plural(tally.failed, 'item')} failed`);
  if (tally.uploading > 0) parts.push(`${plural(tally.uploading, 'item')} sending`);
  if (tally.queued > 0) parts.push(`${plural(tally.queued, 'item')} waiting`);
  if (tally.done > 0) parts.push(`${plural(tally.done, 'item')} sent`);
  return parts.join(' \u00b7 ');
}

/**
 * The button a row offers. A sent row offers none: there is nothing left to do
 * with it except clear it with the rest of the completed rows.
 * @param {{status: string}} item
 * @returns {'cancel'|'retry'|null}
 */
function actionFor(item) {
  if (item.status === 'failed') return 'retry';
  if (item.status === 'queued' || item.status === 'uploading') return 'cancel';
  return null;
}

/**
 * Build one row from the template.
 * @param {Record<string, any>} item
 * @param {number} index
 */
function createRow(item, index) {
  const row = /** @type {HTMLTableRowElement} */ (el.template.content.firstElementChild.cloneNode(true));

  row.dataset.status = item.status;
  row.dataset.id = item.id;

  const order = row.querySelector('.handoff-order');
  if (item.status === 'done') {
    order.innerHTML = CHECK_GLYPH;
  } else {
    order.textContent = String(index + 1).padStart(2, '0');
  }

  const glyph = row.querySelector('.handoff-type use');
  glyph.setAttribute('href', `#handoff-glyph-${item.kind}`);

  row.querySelector('.handoff-name').textContent = item.name;
  row.querySelector('.handoff-detail').textContent = item.detail;
  row.querySelector('.handoff-size').textContent = item.size;

  const pill = row.querySelector('.handoff-pill');
  pill.dataset.tone = item.status;
  row.querySelector('.handoff-pill-label').textContent = STATUS_LABELS[item.status];

  if (item.status === 'uploading') {
    row.querySelector('.handoff-spinner').hidden = false;
  }

  if (item.progress) {
    const progress = row.querySelector('.handoff-progress');
    progress.hidden = false;
    // The fill is a plain box sized in the CSSOM: a progress element's native
    // bar cannot be themed to the node's 4 px pill without losing its fill.
    row.querySelector('.handoff-fill').style.width = `${item.progress}%`;
    row.querySelector('.handoff-progress-label').textContent = item.progressLabel;
  }

  if (item.error) {
    const error = row.querySelector('.handoff-error');
    error.hidden = false;
    error.textContent = item.error;
  }

  const action = actionFor(item);
  const button = row.querySelector('.handoff-action');
  if (action === null) {
    button.remove();
  } else {
    button.dataset.action = action;
    button.textContent = action === 'retry' ? 'Retry' : 'Cancel';
    button.setAttribute('aria-label', `${action === 'retry' ? 'Retry' : 'Cancel'} ${item.name}`);
  }

  return row;
}

/** How many placeholders the loading frame draws: the same number of rows the
 * drawn queue carries, so the card keeps its height while the read runs. */
const SKELETON_ROWS = 4;

/** @param {string} width */
function skeletonBar(width) {
  const bar = document.createElement('span');
  bar.className = 'handoff-skeleton-bar';
  bar.style.width = width;
  return bar;
}

/**
 * One placeholder row, shaped like a real one (position, type tile, name and
 * detail lines, size, status pill, action) so nothing shifts when the queue
 * arrives.
 */
function createSkeletonRow() {
  const row = document.createElement('tr');
  row.className = 'handoff-row handoff-row-skeleton';
  row.setAttribute('aria-hidden', 'true');

  const order = document.createElement('td');
  order.append(skeletonBar('14px'));

  const item = document.createElement('td');
  item.className = 'handoff-item-cell';
  const tile = document.createElement('span');
  tile.className = 'handoff-type handoff-skeleton-tile';
  const text = document.createElement('span');
  text.className = 'handoff-item-text';
  text.append(skeletonBar('58%'), skeletonBar('42%'));
  item.append(tile, text);

  const size = document.createElement('td');
  size.append(skeletonBar('40px'));

  const status = document.createElement('td');
  status.className = 'handoff-status-cell';
  const pill = document.createElement('span');
  pill.className = 'handoff-skeleton-pill';
  status.append(pill);

  const action = document.createElement('td');
  action.className = 'handoff-action-cell';
  action.append(skeletonBar('34px'));

  row.append(order, item, size, status, action);
  return row;
}

function render() {
  const isReading = state === 'loading';
  const isError = state === 'error';
  const isPaused = state === 'disabled';

  if (isReading) {
    el.rows.replaceChildren(...Array.from({ length: SKELETON_ROWS }, createSkeletonRow));
  } else {
    el.rows.replaceChildren(...items.map(createRow));
  }

  // Only a queue that answered and has nothing in it swaps in the empty body.
  const isEmpty = items.length === 0 && !isReading && !isError;

  el.table.hidden = isEmpty;
  el.empty.hidden = !isEmpty;
  el.error.hidden = !isError;
  el.footer.hidden = isEmpty;

  el.count.textContent = isReading
    ? 'Reading the queue'
    : isError
      ? 'Nothing was read'
      : countLabel(items) + (isPaused ? ' \u00b7 queue paused' : '');

  el.clear.disabled = isPaused || !items.some((item) => item.status === 'done');

  // A paused queue offers no row actions either; the rows keep their place so
  // the page still shows what is waiting.
  if (isPaused) {
    for (const button of el.rows.querySelectorAll('.handoff-action')) {
      button.disabled = true;
    }
  }

  el.card.setAttribute('aria-busy', isReading ? 'true' : 'false');
  el.page.dataset.state = state;
}

/**
 * @param {string} next
 * @param {{announcement?: string, keepItems?: boolean}} [options]
 */
function applyState(next, options = {}) {
  state = STATES.includes(next) ? next : 'queued';
  if (!options.keepItems) {
    items = FRAMES[state].map((item) => ({ ...item }));
  }
  render();
  if (options.announcement) announce(options.announcement);
}

el.rows.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest('.handoff-action');
  if (!(button instanceof HTMLButtonElement)) return;

  const row = button.closest('.handoff-row');
  const item = items.find((entry) => entry.id === row?.dataset.id);
  if (!item) return;

  if (button.dataset.action === 'retry') {
    item.status = 'uploading';
    item.progress = 39;
    item.progressLabel = `Restarting at 2.4 of ${item.size} sent`;
    delete item.error;
    state = 'uploading';
    render();
    announce(`Retrying ${item.name}. The page holds the drawn queue; the upload worker is not connected yet.`);
    return;
  }

  items = items.filter((entry) => entry.id !== item.id);
  if (items.length === 0) state = 'empty';
  render();
  announce(`${item.name} was taken out of the queue. Nothing was sent.`);
});

el.clear.addEventListener('click', () => {
  const cleared = items.filter((item) => item.status === 'done').length;
  items = items.filter((item) => item.status !== 'done');
  if (items.length === 0) state = 'empty';
  render();
  announce(cleared > 0 ? `Cleared ${plural(cleared, 'sent item')}.` : 'No completed items to clear.');
});

applyState(stateFromSearch('state'));
