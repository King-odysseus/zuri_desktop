/**
 * contextPanel.js - the Context panel's data (design node 0:634).
 *
 * The panel is four cards. Three are static text written in index.html; the first,
 * "Detected files", names the files Act has saved in the workspace, which only the
 * main process can know. So this module asks `zuri:files:list` once and draws up to
 * three rows, newest first.
 *
 * Three outcomes, all honest:
 * - rows, when main answers with files;
 * - "No files yet", when it answers with an empty workspace;
 * - "Files can only be listed inside Zuri", when the bridge is missing (a browser
 *   preview) or the call fails. It never claims the workspace is empty when it could
 *   not look.
 */

/** How many rows the card shows; the panel is a summary, not the Files page. */
const MAX_ROWS = 3;

/** Icon path data for the row glyph, by extension family. */
const FILE_GLYPH = Object.freeze({
  document: 'M7 3h6l4 4v14H7zM13 3v4h4',
  sheet: 'M5 4h14v16H5zM5 10h14M5 15h14M11 4v16',
  slides: 'M4 5h16v10H4zM12 15v5M8 20h8',
  other: 'M6 3h8l4 4v14H6z',
});

/**
 * Which glyph a file name gets. It is a hint, not a promise: an unknown extension
 * falls back to the plain document mark rather than guessing wrong.
 * @param {string} name
 * @returns {string}
 */
function glyphFor(name) {
  const extension = name.toLowerCase().split('.').pop();
  if (['xlsx', 'xls', 'csv', 'xlsm'].includes(extension)) return FILE_GLYPH.sheet;
  if (['pptx', 'ppt'].includes(extension)) return FILE_GLYPH.slides;
  if (['docx', 'doc', 'pdf', 'txt', 'md', 'json'].includes(extension)) return FILE_GLYPH.document;
  return FILE_GLYPH.other;
}

/**
 * An SVG element in the document's namespace. Build with createElementNS rather than
 * innerHTML so file names never become markup.
 * @param {string} pathData
 * @returns {SVGSVGElement}
 */
function createGlyph(pathData) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/**
 * One file row: glyph, name, and the word "saved" - the only state this build can
 * know about a file in the workspace.
 * @param {{ name?: string, path?: string, modifiedAt?: string }} file
 * @returns {HTMLLIElement}
 */
function fileRow(file) {
  const name = String(file?.name ?? file?.path ?? 'Untitled');

  const row = document.createElement('li');
  row.className = 'context-file-row';

  const icon = document.createElement('span');
  icon.className = 'context-file-icon';
  icon.append(createGlyph(glyphFor(name)));

  const label = document.createElement('span');
  label.className = 'context-file-name';
  label.textContent = name;
  label.title = name;

  const state = document.createElement('span');
  state.className = 'context-file-state';
  state.textContent = 'saved';

  row.append(icon, label, state);
  return row;
}

/**
 * Newest first, without trusting the order main happens to return. A file with no
 * `modifiedAt` sorts last rather than jumping to the top.
 * @param {Array<{ modifiedAt?: string }>} files
 * @returns {Array<{ modifiedAt?: string }>}
 */
function newestFirst(files) {
  return files.slice().sort((left, right) => {
    const leftTime = Date.parse(left?.modifiedAt ?? '');
    const rightTime = Date.parse(right?.modifiedAt ?? '');
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });
}

/**
 * Fill the detected-files card.
 * @param {Document} [doc]
 * @param {any} [api] The `window.zuri` bridge.
 * @returns {Promise<{ state: 'filled' | 'empty' | 'unavailable' }>}
 */
export async function initContextPanel(doc = document, api = window.zuri) {
  const list = doc.getElementById('context-file-list');
  const empty = doc.getElementById('context-files-empty');
  if (!list || !empty) return { state: 'unavailable' };

  /** @param {string} message */
  const showUnavailable = (message) => {
    list.replaceChildren();
    list.dataset.state = 'unavailable';
    empty.textContent = message;
    empty.hidden = false;
    return { state: /** @type {const} */ ('unavailable') };
  };

  if (!api?.files?.list) {
    return showUnavailable('Files can only be listed inside Zuri.');
  }

  let result;
  try {
    result = await api.files.list({});
  } catch {
    // The bridge refused. Say so; do not present an empty workspace as a fact.
    return showUnavailable('Files are not readable right now.');
  }

  if (result?.ok !== true) {
    return showUnavailable('Files can only be listed inside Zuri.');
  }

  const files = Array.isArray(result.data) ? result.data : [];
  if (files.length === 0) {
    list.replaceChildren();
    list.dataset.state = 'empty';
    empty.textContent = 'Nothing yet. Files Act saves will be listed here.';
    empty.hidden = false;
    return { state: /** @type {const} */ ('empty') };
  }

  list.replaceChildren(...newestFirst(files).slice(0, MAX_ROWS).map(fileRow));
  list.dataset.state = 'filled';
  empty.hidden = true;
  return { state: /** @type {const} */ ('filled') };
}
