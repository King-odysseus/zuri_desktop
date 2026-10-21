/**
 * Files view: what Act has saved in the workspace, with the two things a person
 * can do with a result without leaving Zuri - open it, or show it in Explorer -
 * plus the Summarize flow that turns one chosen document into a Markdown result.
 *
 * The list comes from main over `zuri:files:list`; this page never reads the
 * disk. Paths arrive relative to the workspace with forward slashes and go
 * straight back in the open and reveal payloads, where the main process resolves
 * them against the same workspace guard the file tools use. So a path edited in
 * DevTools cannot open or reveal anything outside the workspace folder.
 *
 * Summarize is two calls: `zuri:files:choose` opens the native picker in main,
 * then `zuri:files:summarize` reads, summarises and writes the Markdown there.
 * The document never crosses into the renderer, and neither does the API key.
 *
 * The last export is the shell's Files destination (route "files" in
 * ui/router.js), which lists the same workspace inside #chat. It reuses the size
 * and date formatters above so the two surfaces read one way.
 */

import { button, card, element, pageView } from '../ui/dom.js';

const IDS = Object.freeze({
  list: 'files-list',
  empty: 'files-empty',
  error: 'files-error',
  refresh: 'files-refresh',
  status: 'files-status',
  truncated: 'files-truncated',
  summarize: 'files-summarize',
  summary: 'files-summary',
  summaryMeta: 'files-summary-meta',
  summaryBody: 'files-summary-body',
  summarySaved: 'files-summary-saved',
  summaryOpen: 'files-summary-open',
  summaryReveal: 'files-summary-reveal',
});

/**
 * @param {Document} doc
 * @returns {Record<string, HTMLElement>}
 */
function collectElements(doc) {
  /** @type {Record<string, HTMLElement>} */
  const elements = {};
  for (const [name, id] of Object.entries(IDS)) {
    const element = doc.getElementById(id);
    if (element === null) throw new Error(`files view: #${id} is missing`);
    elements[name] = element;
  }
  return elements;
}

/**
 * Human size for the meta line: "640 B", "12.4 KB", "3 MB".
 * @param {unknown} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Short local date and time for the meta line. An unparseable timestamp is left
 * out rather than shown as "Invalid Date".
 * @param {unknown} iso
 * @returns {string}
 */
function formatModified(iso) {
  if (typeof iso !== 'string') return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Wire the Files page. Every disk action goes through `window.zuri.files`, so the
 * view works with only the bridge and no Node globals.
 * @param {Document} [doc]
 * @param {any} [api] The `window.zuri` bridge.
 * @returns {{ refresh: () => Promise<void>, stopListening: (() => void) | null }}
 */
export function initFilesView(doc = document, api = window.zuri) {
  const elements = collectElements(doc);
  /** @type {Array<{ path: string, name: string, bytes: number, modifiedAt: string }>} */
  let files = [];
  /** Workspace-relative path of the last summary written, '' before the first. */
  let summaryPath = '';

  /** @param {string} message Empty string hides the line. */
  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = message === '';
  }

  /** @param {string} message */
  function setStatus(message) {
    elements.status.textContent = message;
  }

  /**
   * A rejected invoke means main never answered (it crashed or the channel is
   * gone); the view reports it the same way as a returned failure.
   * @param {() => Promise<any>} call
   * @returns {Promise<{ ok: boolean, data?: any, error?: { code?: string, message?: string } }>}
   */
  async function settle(call) {
    try {
      return await call();
    } catch (error) {
      return { ok: false, error: { message: String(error?.message ?? error) } };
    }
  }

  /**
   * One file row: name, size and date, then Open and Reveal in Explorer.
   * @param {{ path: string, name: string, bytes: number, modifiedAt: string }} file
   * @returns {HTMLLIElement}
   */
  function createRow(file) {
    const name = String(file?.name ?? file?.path ?? '');
    const relativePath = String(file?.path ?? name);

    const row = doc.createElement('li');
    row.className = 'file-row';
    row.dataset.filePath = relativePath;

    const text = doc.createElement('div');
    text.className = 'file-row-text';

    const label = doc.createElement('span');
    label.className = 'file-row-name';
    label.textContent = name;
    // The folder inside the workspace matters when two results share a name.
    label.title = relativePath;

    const meta = doc.createElement('span');
    meta.className = 'file-row-meta';
    meta.textContent = [formatSize(file?.bytes), formatModified(file?.modifiedAt)]
      .filter(Boolean)
      .join(' - ');

    text.append(label, meta);

    const actions = doc.createElement('div');
    actions.className = 'file-row-actions';

    const open = doc.createElement('button');
    open.type = 'button';
    open.className = 'file-action';
    open.textContent = 'Open';
    open.setAttribute('aria-label', `Open ${name}`);
    open.addEventListener('click', () => run('open', relativePath, open));

    const reveal = doc.createElement('button');
    reveal.type = 'button';
    reveal.className = 'file-action file-action-quiet';
    reveal.textContent = 'Reveal in Explorer';
    reveal.setAttribute('aria-label', `Reveal ${name} in Explorer`);
    reveal.addEventListener('click', () => run('reveal', relativePath, reveal));

    actions.append(open, reveal);
    row.append(text, actions);
    return row;
  }

  /** @param {boolean} truncated */
  function render(truncated = false) {
    elements.list.replaceChildren(...files.map(createRow));
    elements.list.dataset.state = files.length === 0 ? 'empty' : 'filled';
    elements.empty.hidden = files.length > 0;
    elements.truncated.hidden = !truncated || files.length === 0;
    setStatus(
      files.length === 0
        ? 'No files saved yet'
        : `${files.length} file${files.length === 1 ? '' : 's'} in the workspace`,
    );
  }

  /**
   * Open or reveal one file. The button is disabled while main works so a second
   * click cannot fire twice; a file that vanished since the list was drawn
   * refreshes the list instead of leaving a stale row.
   * @param {'open' | 'reveal'} action
   * @param {string} relativePath
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  async function run(action, relativePath, button) {
    showError('');
    button.disabled = true;
    const result =
      action === 'open'
        ? await settle(() => api.files.open({ path: relativePath }))
        : await settle(() => api.files.reveal({ path: relativePath }));
    button.disabled = false;

    if (result?.ok === true) {
      setStatus(action === 'open' ? `Opened ${relativePath}.` : `Showing ${relativePath} in Explorer.`);
      return;
    }

    showError(result?.error?.message ?? `Could not ${action} ${relativePath}.`);
    if (result?.error?.code === 'TOOL_FILE_MISSING') await refresh();
  }

  /**
   * Show what the summariser produced and where it was saved. The saved file, not
   * this card, is the durable result, so the card links to it like any row.
   * @param {any} data The `zuri:files:summarize` result payload.
   */
  function renderSummary(data) {
    const sourceName = String(data?.sourceName ?? data?.source ?? 'the document');
    const model = String(data?.model ?? '');
    const notes = [sourceName, model].filter(Boolean).join(' - ');

    elements.summaryMeta.textContent =
      data?.truncated === true ? `${notes} (only the start of the document was read)` : notes;
    elements.summaryBody.textContent = String(data?.summary ?? '');

    summaryPath = typeof data?.path === 'string' ? data.path : '';
    const savedName = String(data?.name ?? summaryPath);
    elements.summarySaved.textContent = summaryPath === '' ? '' : `Saved as ${savedName} in your workspace.`;
    elements.summaryOpen.disabled = summaryPath === '';
    elements.summaryReveal.disabled = summaryPath === '';
    elements.summaryOpen.setAttribute('aria-label', `Open ${savedName}`);
    elements.summaryReveal.setAttribute('aria-label', `Reveal ${savedName} in Explorer`);
    elements.summary.hidden = false;
  }

  /**
   * Choose a document, summarise it in main, and re-list. A failure keeps the
   * previous listing and shows the reason inline, per flows.md step 7.
   * @returns {Promise<void>}
   */
  async function summarize() {
    showError('');

    if (typeof api?.files?.choose !== 'function' || typeof api?.files?.summarize !== 'function') {
      showError('Summarizing is only available inside Zuri.');
      return;
    }

    elements.summarize.disabled = true;
    try {
      setStatus('Choosing a document...');
      const picked = await settle(() => api.files.choose({}));
      if (picked?.ok !== true) {
        showError(picked?.error?.message ?? 'The file picker could not be opened.');
        return;
      }

      const chosenPath = picked.data?.path;
      if (picked.data?.cancelled === true || typeof chosenPath !== 'string' || chosenPath === '') {
        setStatus('No document chosen.');
        return;
      }

      const chosenName = String(picked.data?.name ?? chosenPath);
      setStatus(`Summarizing ${chosenName}. This can take a moment.`);

      const result = await settle(() => api.files.summarize({ path: chosenPath }));
      if (result?.ok !== true) {
        showError(result?.error?.message ?? `Could not summarize ${chosenName}.`);
        setStatus('The summary was not saved.');
        return;
      }

      renderSummary(result.data);
      // Main also pushes state:changed, but refreshing from the answer means the
      // new file is listed even if that push is missed.
      await refresh();
      setStatus(`Saved ${String(result.data?.name ?? 'the summary')} to your workspace.`);
    } finally {
      elements.summarize.disabled = false;
    }
  }

  /**
   * Ask main for the current list. Called on load, on Refresh, after a file
   * turns out to be missing, and after a summary is written.
   * @returns {Promise<void>}
   */
  async function refresh() {
    showError('');

    if (typeof api?.files?.list !== 'function') {
      // The page opened outside Zuri (a browser preview): there is no bridge.
      elements.refresh.disabled = true;
      elements.summarize.disabled = true;
      files = [];
      render();
      setStatus('Files can only be listed inside Zuri');
      return;
    }

    elements.refresh.disabled = true;
    const result = await settle(() => api.files.list({}));
    elements.refresh.disabled = false;

    if (result?.ok !== true) {
      files = [];
      render();
      setStatus('The workspace could not be read');
      showError(result?.error?.message ?? 'The workspace could not be read.');
      return;
    }

    files = Array.isArray(result.data?.files) ? result.data.files : [];
    render(result.data?.truncated === true);
  }

  elements.refresh.addEventListener('click', refresh);
  elements.summarize.addEventListener('click', summarize);
  elements.summaryOpen.addEventListener('click', () => {
    if (summaryPath !== '') run('open', summaryPath, elements.summaryOpen);
  });
  elements.summaryReveal.addEventListener('click', () => {
    if (summaryPath !== '') run('reveal', summaryPath, elements.summaryReveal);
  });

  // A file saved by any flow is announced by main; re-list so this view never
  // shows a stale folder. No polling.
  const stopListening =
    typeof api?.state?.onChanged === 'function'
      ? api.state.onChanged((event) => {
          if (event?.area === undefined || event.area === 'files') refresh();
        })
      : null;

  refresh();

  return { refresh, stopListening };
}

// Only the Files document has this list; importing the module elsewhere is a no-op.
if (typeof document !== 'undefined' && document.getElementById(IDS.list)) {
  initFilesView(document, window.zuri);
}

/* ---------------------------------------------------------------------------
   Shell view (route "files")

   The sidebar's Files destination, mounted inside #chat by ui/router.js, and the
   one placeholder-shaped route that can already show real work: main has a files
   channel, so this page lists the workspace and opens or reveals a file with no
   new IPC. The full page above keeps the Summarize flow; this keeps to the list,
   which is what a destination tab is for.
   --------------------------------------------------------------------------- */

/**
 * A rejected invoke means main never answered; report it like a returned failure
 * rather than letting the view sit on "reading your workspace" forever.
 * @param {() => Promise<any>} call
 * @returns {Promise<{ ok: boolean, data?: any, error?: { code?: string, message?: string } }>}
 */
async function callThrough(call) {
  try {
    return await call();
  } catch (error) {
    return { ok: false, error: { message: String(error?.message ?? error) } };
  }
}

/**
 * Build the Files destination.
 * @param {Document} [doc]
 * @param {any} [api] The `window.zuri` bridge.
 * @returns {HTMLElement}
 */
export function createView(doc = document, api = window.zuri) {
  const status = element('p', 'view-card-text', 'Reading your workspace...');
  const list = element('div', 'view-file-list');
  const refresh = button('Refresh', () => load());

  /** @param {string} message */
  function setStatus(message) {
    status.textContent = message;
  }

  /**
   * One file row: name, size and when it changed, then Open and Reveal.
   * @param {{ path: string, name: string, bytes: number, modifiedAt: string }} file
   * @returns {HTMLElement}
   */
  function createRow(file) {
    const name = String(file?.name ?? file?.path ?? '');
    const path = String(file?.path ?? name);

    const label = element('span', 'view-file-name', name);
    label.title = path;

    const meta = element(
      'span',
      'view-file-meta',
      [formatSize(file?.bytes), formatModified(file?.modifiedAt)].filter(Boolean).join(' - '),
    );

    const open = button('Open', () => act('open', path, open));
    const reveal = button('Reveal', () => act('reveal', path, reveal));
    open.setAttribute('aria-label', `Open ${name}`);
    reveal.setAttribute('aria-label', `Reveal ${name} in Explorer`);

    const row = element('div', 'view-file-row');
    row.append(label, meta, open, reveal);
    return row;
  }

  /**
   * Open or reveal one file. The button is disabled while main works, so a second
   * click cannot fire twice.
   * @param {'open' | 'reveal'} action
   * @param {string} path
   * @param {HTMLButtonElement} control
   */
  async function act(action, path, control) {
    control.disabled = true;
    const result =
      action === 'open'
        ? await callThrough(() => api.files.open({ path }))
        : await callThrough(() => api.files.reveal({ path }));
    control.disabled = false;

    if (result?.ok === true) {
      setStatus(action === 'open' ? `Opened ${path}.` : `Showing ${path} in Explorer.`);
      return;
    }
    setStatus(result?.error?.message ?? `Could not ${action} ${path}.`);
  }

  /** Ask main for the list; also what Refresh and the change push call. */
  async function load() {
    if (typeof api?.files?.list !== 'function') {
      refresh.disabled = true;
      list.replaceChildren();
      setStatus('Files can only be listed inside Zuri.');
      return;
    }

    refresh.disabled = true;
    const result = await callThrough(() => api.files.list({}));
    refresh.disabled = false;

    if (result?.ok !== true) {
      list.replaceChildren();
      setStatus(result?.error?.message ?? 'The workspace could not be read.');
      return;
    }

    const files = Array.isArray(result.data?.files) ? result.data.files : [];
    list.replaceChildren(...files.map(createRow));
    const more = result.data?.truncated === true ? ' The list is cut off at the first files.' : '';
    setStatus(
      files.length === 0
        ? 'No files in your workspace yet. Anything Act saves shows up here.'
        : `${files.length} file${files.length === 1 ? '' : 's'} in your workspace.${more}`,
    );
  }

  const page = pageView({
    title: 'Files',
    lead: 'Everything Act has saved in your workspace. Open a file in its own app, or show it in Explorer.',
    actions: [refresh],
    sections: [card({ children: [status, list] })],
  });

  // A file written by any flow is announced by main; re-list so this page cannot
  // show a stale folder. No polling.
  if (typeof api?.state?.onChanged === 'function') {
    api.state.onChanged((event) => {
      if (event?.area === undefined || event.area === 'files') load();
    });
  }

  load();
  return page;
}
