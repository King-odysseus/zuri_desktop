/**
 * tools/index.js - the fixed list of tools Act mode may run.
 *
 * Why a fixed list: the model picks a tool by name from this registry, so a name
 * that is not declared here can never reach the file system or the desktop.
 * `runTool` is the only entry point. It rejects unknown names, honours the calling
 * agent's `allowedTools`, refuses a destructive tool until the person confirms,
 * then runs the handler.
 *
 * Two rules are enforced here rather than in the renderer, because the renderer is
 * the untrusted side of the bridge:
 * - `openApp` may launch only a name listed in `settings.allowedApps`.
 * - `openUrl` may open only an http(s) URL covered by `settings.allowedUrls`.
 * `writeFile` is confined to `userData/workspace` by a resolved-prefix check, so
 * `../escape.txt` and an absolute path outside the folder both fail before a write.
 *
 * Network, Electron, the AI provider and the desktop are injected dependencies
 * (`createDependencies` / the `dependencies` option), which is what lets
 * scripts/selftest.js exercise the guards without fetching, launching an app or
 * needing an API key. Every handler returns the discriminated result shape from
 * conventions.md: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readStore, findAgent, createTask, createReminder, createAutomation } from '../store.js';
import { OFFICE_KINDS, OfficeError, buildOfficeFile, reviewOfficeContent } from '../office.js';
import { describeWorkbook, editOfficeFile } from '../office-edit.js';
import { callMcpTool, listMcpTools as discoverMcpTools } from '../mcp/client.js';

const WORKSPACE_DIR_NAME = 'workspace';
const WORKSPACE_LIST_LIMIT = 500;
const WORKSPACE_LIST_DEPTH = 8;
/** Folders that never hold a saved result and would swamp the list if walked. */
const WORKSPACE_SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);
const FILE_SIZE_LIMIT = 8 * 1024 * 1024;
const READ_TEXT_LIMIT = 200_000;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_BODY_LIMIT = 5 * 1024 * 1024;
const FETCH_TEXT_DEFAULT = 4_000;
const FETCH_TEXT_LIMIT = 20_000;
const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const SEARCH_LIMIT = 8;
const SEARCH_LIMIT_MAX = 20;
const APP_NAME_LIMIT = 120;
const USER_AGENT = 'Zuri/0.1 (desktop assistant)';

const DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * An allow-list app entry is an executable name, not a command line. A path
 * separator, quote or shell metacharacter in an entry would let Settings launch
 * something other than the app it names, so such an entry is refused before spawn.
 */
const SAFE_APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/;

/** Absolute workspace directory set by scripts; null in the app. */
let workspaceOverride = null;

/**
 * Step ids the renderer cancelled, so a run that arrives for one of them is
 * refused instead of writing anything. A Cancel press on a step that has already
 * left the renderer cannot stop the write in flight (Node offers no way to
 * interrupt fs), but it can stop the next call, and it is what makes a step's
 * Cancel control mean something rather than only change a label on screen.
 * @type {Set<string>}
 */
const cancelledSteps = new Set();

/** Serial for temp file names, so two writes never share a scratch file. */
let tempSerial = 0;

/**
 * A guard failure a handler can throw. `runTool` turns it into the result shape,
 * so no handler has to build the same `{ ok: false }` object for every branch.
 */
class ToolError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** @param {any} data */
function ok(data) {
  return { ok: true, data };
}

/** @param {string} code @param {string} message */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/* ------------------------------------------------------------------ workspace */

/**
 * Point the workspace at an explicit directory. Only scripts use this: in the app
 * the folder is always `<userData>/workspace`, per the risk note in risks.md.
 * @param {string} directory Absolute path to use as the workspace root.
 * @returns {void}
 */
export function setWorkspaceRoot(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('setWorkspaceRoot expects an absolute directory path');
  }
  workspaceOverride = directory;
}

/**
 * The workspace folder Act writes Markdown into. Electron is required lazily so
 * `node scripts/selftest.js` can import this module without an app object.
 * @returns {string} Absolute workspace path.
 */
export function getWorkspaceRoot() {
  if (workspaceOverride) return workspaceOverride;

  const require = createRequire(import.meta.url);
  const electron = require('electron');
  const app = electron?.app;
  if (typeof app?.getPath !== 'function') {
    throw new ToolError(
      'TOOL_NO_WORKSPACE',
      'The workspace folder is unavailable. Call setWorkspaceRoot() before using the file tools outside the app.',
    );
  }
  return path.join(app.getPath('userData'), WORKSPACE_DIR_NAME);
}

/**
 * Resolve a user-supplied path inside the workspace, refusing anything that lands
 * outside it. `path.relative` is the check rather than a string prefix, because a
 * prefix check would accept `../workspace-evil` and Windows drive-relative paths.
 * @param {string} userPath Path from the tool call, relative to the workspace.
 * @returns {string} Absolute path inside the workspace.
 */
export function resolveWorkspacePath(userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'Give a file path inside the workspace folder.');
  }

  const root = getWorkspaceRoot();
  const target = path.resolve(root, userPath);
  const relative = path.relative(root, target);
  const escapes = relative === '' || relative.startsWith('..') || path.isAbsolute(relative);
  if (escapes) {
    throw new ToolError(
      'TOOL_PATH_OUTSIDE_WORKSPACE',
      `"${userPath}" is outside the workspace folder, so it was refused. Use a path inside the workspace instead.`,
    );
  }
  return target;
}

/**
 * Create the workspace folder if it is not there yet. Called on `app.whenReady`
 * so the folder exists on first run, before Act has written anything: the Files
 * view lists it, and an empty folder is a truthful "nothing saved yet" rather
 * than an error.
 * @returns {Promise<string>} Absolute workspace path.
 */
export async function ensureWorkspace() {
  const root = getWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Every file in the workspace, newest first, as paths relative to its root with
 * forward slashes so the renderer can send one straight back to open or reveal.
 * Bounded in depth and count: the list must not freeze the window if a tool ever
 * writes thousands of files.
 * @returns {Promise<{ files: Array<{ path: string, name: string, bytes: number, modifiedAt: string }>, truncated: boolean }>}
 */
export async function listWorkspaceFiles() {
  const root = await ensureWorkspace();
  /** @type {Array<{ path: string, name: string, bytes: number, modifiedAt: string }>} */
  const files = [];
  let truncated = false;

  /** @param {string} directory @param {number} depth @returns {Promise<void>} */
  async function walk(directory, depth) {
    if (truncated) return;
    if (depth > WORKSPACE_LIST_DEPTH) {
      truncated = true;
      return;
    }

    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= WORKSPACE_LIST_LIMIT) {
        truncated = true;
        return;
      }
      // A symbolic link can point outside the folder the tools guard, and a
      // junction on Windows reports as a link too, so neither is followed.
      if (entry.isSymbolicLink()) continue;

      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (WORKSPACE_SKIPPED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      // `notes.md.1234.1.tmp` is a write in flight; it is gone or renamed a moment later.
      if (entry.name.endsWith('.tmp')) continue;

      let stats;
      try {
        stats = await fs.stat(absolute);
      } catch {
        // Removed between readdir and stat: it is not a file the view can open.
        continue;
      }
      files.push({
        path: path.relative(root, absolute).split(path.sep).join('/'),
        name: entry.name,
        bytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
  }

  await walk(root, 0);
  files.sort(
    (left, right) =>
      right.modifiedAt.localeCompare(left.modifiedAt) || left.path.localeCompare(right.path),
  );
  return { files, truncated };
}

/**
 * Resolve a path the renderer got from listWorkspaceFiles to an existing file.
 * The workspace guard runs first, so a crafted path cannot open or reveal
 * anything outside the folder.
 * @param {unknown} userPath Path relative to the workspace.
 * @returns {Promise<string>} Absolute path of the file.
 */
export async function resolveWorkspaceFile(userPath) {
  const absolute = resolveWorkspacePath(userPath);

  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch {
    throw new ToolError('TOOL_FILE_MISSING', `"${userPath}" is no longer in the workspace.`);
  }
  if (!stats.isFile()) {
    throw new ToolError('TOOL_NOT_A_FILE', `"${userPath}" is a folder, not a file.`);
  }
  return absolute;
}

/**
 * Write through a temp file and rename it into place, the same guarantee store.js
 * gives its JSON files: a crash mid-write cannot leave a half-written document.
 * @param {string} target Absolute destination path.
 * @param {string | Buffer} content UTF-8 text, or the bytes of a binary file.
 * @returns {Promise<void>}
 */
async function writeAtomically(target, content) {
  tempSerial += 1;
  const tempPath = `${target}.${process.pid}.${tempSerial}.tmp`;
  try {
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, target);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/* ---------------------------------------------------------------- allow-lists */

/**
 * Normalise an app name for comparison: case-insensitive, and `notepad.exe` and
 * `Notepad` name the same app.
 * @param {string} name
 * @returns {string}
 */
function normaliseAppName(name) {
  return name.trim().toLowerCase().replace(/\.exe$/, '');
}

/** @param {string} name @returns {boolean} */
function isSafeAppName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= APP_NAME_LIMIT &&
    SAFE_APP_NAME.test(name) &&
    !name.includes('..')
  );
}

/**
 * Parse one `allowedUrls` entry. Anything that is not an absolute http(s) URL
 * without embedded credentials is not an allow-list entry and matches nothing.
 * @param {unknown} entry
 * @returns {URL | null}
 */
function parseAllowListUrl(entry) {
  if (typeof entry !== 'string' || entry.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(entry.trim());
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return parsed;
}

/**
 * True when `url` is the allow-listed origin, or below its path on a segment
 * boundary. `https://example.com` allows every page on that site;
 * `https://example.com/docs` allows `/docs` and `/docs/...` but not `/docs-other`.
 * @param {URL} url
 * @param {unknown} entry
 * @returns {boolean}
 */
function urlMatchesEntry(url, entry) {
  const allowed = parseAllowListUrl(entry);
  if (!allowed) return false;
  if (url.origin !== allowed.origin) return false;

  const allowedPath = allowed.pathname.replace(/\/+$/, '');
  const wantedPath = url.pathname.replace(/\/+$/, '');
  return allowedPath === '' || wantedPath === allowedPath || wantedPath.startsWith(`${allowedPath}/`);
}

/* ----------------------------------------------------------- web text helpers */

/**
 * Decode the entities that matter for titles and snippets. Deliberately small:
 * a full decoder belongs to cheerio, which is not installed (no new dependency).
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

/**
 * Flatten HTML to readable text. The stack names cheerio, which is not installed;
 * this keeps webFetch dependency-free and is good enough for reading an article,
 * not for scraping a layout. Swap in cheerio selectors when that lands.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  const withoutNoise = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const spaced = withoutNoise.replace(/<[^>]+>/g, ' ');
  return decodeEntities(spaced).replace(/\s+/g, ' ').trim();
}

/**
 * Turn a search-result href into the page it points at. DuckDuckGo wraps results
 * in `/l/?uddg=<encoded>` redirects, so the real target has to be unwrapped.
 * @param {string} href
 * @returns {string | null}
 */
function searchResultUrl(href) {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  let parsed;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  const target = parsed.searchParams.get('uddg');
  if (target) {
    try {
      const decoded = new URL(target);
      return WEB_PROTOCOLS.has(decoded.protocol) ? decoded.toString() : null;
    } catch {
      return null;
    }
  }
  return WEB_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
}

/**
 * Extract { title, url, snippet } from a DuckDuckGo HTML results page.
 * Narrow on purpose: it reads the two result classes, then falls back to any
 * anchor carrying an `uddg` redirect, so a markup change degrades instead of
 * throwing. @param {string} html @returns {{ title: string, url: string, snippet: string }[]}
 */
function parseSearchResults(html) {
  const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (match) => htmlToText(match[1]),
  );

  let anchors = [...html.matchAll(/<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  if (anchors.length === 0) {
    anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  }

  return anchors
    .map((match, index) => ({
      title: htmlToText(match[2]),
      url: searchResultUrl(decodeEntities(match[1])),
      snippet: snippets[index] ?? '',
    }))
    .filter((result) => result.url !== null && result.title !== '');
}

/** @param {unknown} value @returns {number} */
function searchResultLimit(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), SEARCH_LIMIT_MAX);
}

/**
 * Fetch a URL with a timeout, mapping the contract's error codes.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
async function fetchOrFail(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ToolError('TOOL_TIMEOUT', `${url} did not answer in time. Try again.`);
    }
    throw new ToolError('TOOL_NETWORK_ERROR', `Could not reach ${url}. Check the connection and try again.`);
  }
}

/* -------------------------------------------------------------- read a file */

/**
 * Read a file's text. A path from the native dialog is absolute and may live
 * anywhere the person chose; a relative path is resolved inside the workspace.
 * Office formats go through the injected `extractDocument`, because parsing OOXML
 * is officeparser's job and writing it back is out of scope (decision 12).
 * @param {{ extractDocument: (filePath: string) => Promise<string> }} dependencies
 * @param {unknown} userPath
 * @returns {Promise<{ path: string, name: string, bytes: number, text: string, truncated: boolean }>}
 */
async function readDocumentText(dependencies, userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'Give the path of the file to read.');
  }

  const filePath = path.isAbsolute(userPath) ? path.resolve(userPath) : resolveWorkspacePath(userPath);

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch {
    throw new ToolError('TOOL_READ_FAILED', `Could not open "${userPath}". Check the path and that the file exists.`);
  }
  if (!stats.isFile()) {
    throw new ToolError('TOOL_READ_FAILED', `"${userPath}" is a folder, not a file.`);
  }
  if (stats.size > FILE_SIZE_LIMIT) {
    throw new ToolError(
      'TOOL_FILE_TOO_LARGE',
      `"${userPath}" is larger than ${Math.round(FILE_SIZE_LIMIT / (1024 * 1024))} MB, which is too big to read here.`,
    );
  }

  const extension = path.extname(filePath).toLowerCase();
  let text;
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    text = await dependencies.extractDocument(filePath);
  } else {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch {
      throw new ToolError('TOOL_READ_FAILED', `Could not read "${userPath}". It may be locked by another app.`);
    }
    text = HTML_EXTENSIONS.has(extension) ? htmlToText(raw) : raw;
  }

  const truncated = text.length > READ_TEXT_LIMIT;
  return {
    path: filePath,
    name: path.basename(filePath),
    bytes: stats.size,
    text: truncated ? text.slice(0, READ_TEXT_LIMIT) : text,
    truncated,
  };
}

/* -------------------------------------------------------------------- tools */

/** @param {any} args @param {any} context */
async function webSearchTool(args, context) {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (query === '') throw new ToolError('TOOL_INVALID_ARGUMENT', 'webSearch needs a search query.');

  const endpoint = new URL(SEARCH_ENDPOINT);
  endpoint.searchParams.set('q', query);

  const response = await fetchOrFail(context.dependencies.fetch, endpoint.toString(), {
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new ToolError('TOOL_SEARCH_FAILED', `The search service returned ${response.status}. Try again later.`);
  }

  const results = parseSearchResults(await response.text()).slice(0, searchResultLimit(args?.limit));
  return ok({ query, results });
}

/** @param {any} args @param {any} context */
async function webFetchTool(args, context) {
  const requested = typeof args?.url === 'string' ? args.url.trim() : '';
  if (requested === '') throw new ToolError('TOOL_INVALID_ARGUMENT', 'webFetch needs a URL.');

  let parsed;
  try {
    parsed = new URL(requested);
  } catch {
    throw new ToolError('TOOL_INVALID_ARGUMENT', `"${requested}" is not a full URL.`);
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) {
    throw new ToolError('TOOL_URL_NOT_ALLOWED', 'Only http and https pages can be fetched.');
  }

  const response = await fetchOrFail(context.dependencies.fetch, parsed.toString(), {
    headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'user-agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new ToolError('TOOL_FETCH_FAILED', `${parsed.hostname} returned ${response.status}.`);
  }

  // Refuse an oversized download before buffering it in the main process.
  const declaredBytes = Number(response.headers?.get?.('content-length') ?? '0');
  if (Number.isFinite(declaredBytes) && declaredBytes > FETCH_BODY_LIMIT) {
    throw new ToolError('TOOL_RESPONSE_TOO_LARGE', `${parsed.hostname} returned a page too large to read here.`);
  }

  const body = await response.text();
  const limit = Math.min(Math.max(Number(args?.maxChars) || FETCH_TEXT_DEFAULT, 1), FETCH_TEXT_LIMIT);
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = htmlToText(body);

  return ok({
    url: parsed.toString(),
    title: titleMatch ? htmlToText(titleMatch[1]) : '',
    text: text.slice(0, limit),
    truncated: text.length > limit,
  });
}

/** @param {any} args @param {any} context */
async function readFileTool(args, context) {
  const document = await readDocumentText(context.dependencies, args?.path ?? args?.file);
  return ok(document);
}

/** @param {any} args @param {any} context */
async function writeFileTool(args, context) {
  const content = args?.content;
  if (typeof content !== 'string') {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'writeFile needs the text to write in `content`.');
  }

  const filePath = resolveWorkspacePath(args?.path ?? args?.file);
  const existed = await fs
    .stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeAtomically(filePath, content);
  } catch (error) {
    console.error('[zuri:tools] writeFile', error);
    throw new ToolError('TOOL_WRITE_FAILED', `Could not save "${path.basename(filePath)}" in the workspace.`);
  }

  return ok({
    path: filePath,
    relative: path.relative(getWorkspaceRoot(), filePath).split(path.sep).join('/'),
    bytes: Buffer.byteLength(content, 'utf8'),
    overwritten: existed,
  });
}

/** Folder inside the workspace that holds files Zuri builds for the person to download. */
const DOCUMENTS_DIR_NAME = 'documents';

/**
 * A safe base name for a generated file: no folders, no reserved characters, no
 * extension (the kind supplies it). Falls back to "document" when nothing is left.
 * @param {unknown} raw
 * @returns {string}
 */
function documentBaseName(raw) {
  const leaf = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  const stem = leaf.replace(/\.(docx|xlsx|pptx|pdf)$/i, '');
  const cleaned = stem.replace(/[<>:"|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned.slice(0, 80) || 'document';
}

/** First path under `directory` that does not exist yet, so a new file never overwrites one. */
async function freeDocumentPath(directory, base, kind) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(directory, n === 1 ? `${base}.${kind}` : `${base} (${n}).${kind}`);
    const taken = await fs.stat(candidate).then(() => true).catch(() => false);
    if (!taken) return candidate;
  }
  throw new ToolError('TOOL_WRITE_FAILED', 'Too many files with that name already exist in the workspace.');
}

const IMAGE_TYPES = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' });
const IMAGE_BYTES_LIMIT = 5 * 1024 * 1024;

/**
 * A picture in the workspace as a data link, which is the one form the builders take.
 * The path goes through the same workspace guard as every other file the tools touch,
 * so a model cannot name a picture elsewhere on the disk.
 * @param {string} userPath
 * @returns {Promise<string>}
 */
async function workspaceImageUri(userPath) {
  const file = resolveWorkspacePath(userPath);
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new ToolError('TOOL_INVALID_ARGUMENT', `"${userPath}" is not a PNG, JPEG or GIF picture.`);
  let bytes;
  try {
    const stats = await fs.stat(file);
    if (stats.size > IMAGE_BYTES_LIMIT) throw new ToolError('TOOL_FILE_TOO_LARGE', `"${userPath}" is larger than 5 MB.`);
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('TOOL_READ_FAILED', `Could not open the picture "${userPath}" in the workspace.`);
  }
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/**
 * Replace picture paths in a document's content with data links, in place. A picture is
 * any object of type "image", or the value under an "image" key, that names a file.
 * @param {unknown} node
 * @param {number} [depth]
 * @returns {Promise<void>}
 */
async function inlineWorkspaceImages(node, depth = 0) {
  if (depth > 6 || node === null || typeof node !== 'object') return;
  const entries = Array.isArray(node) ? node.map((value, index) => [index, value]) : Object.entries(node);
  for (const [key, value] of entries) {
    if (key === 'image' && typeof value === 'string' && !value.startsWith('data:')) {
      node[key] = { data: await workspaceImageUri(value) };
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (typeof value.path === 'string' && typeof value.data !== 'string' && (value.type === 'image' || key === 'image')) {
      value.data = await workspaceImageUri(value.path);
      delete value.path;
    }
    await inlineWorkspaceImages(value, depth + 1);
  }
}

/** @param {any} args @param {any} context */
async function createDocumentTool(args, context) {
  const requestedKind = String(args?.kind ?? args?.format ?? '').trim().toLowerCase();
  const kind = {
    word: 'docx',
    document: 'docx',
    doc: 'docx',
    excel: 'xlsx',
    spreadsheet: 'xlsx',
    powerpoint: 'pptx',
    presentation: 'pptx',
    slides: 'pptx',
    pdf: 'pdf',
  }[requestedKind] ?? requestedKind;
  if (!OFFICE_KINDS.includes(kind)) {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'createDocument needs `kind` to be docx, xlsx, pptx or pdf.');
  }

  // Some providers hand nested arguments back as a JSON string rather than an object.
  // Some providers flatten the structured payload or call it `document` even when
  // the schema says `content`. Accept those equivalent shapes at this boundary so
  // Word creation does not fail before the builder ever sees the document.
  let content = args?.content ?? args?.document ?? args?.body;
  if (content === undefined && args && typeof args === 'object') {
    const { kind: _kind, format: _format, fileName: _fileName, ...flattened } = args;
    if (Object.keys(flattened).length > 0) content = flattened;
  }
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      throw new ToolError('TOOL_INVALID_ARGUMENT', 'createDocument `content` must be a JSON object.');
    }
  }

  await inlineWorkspaceImages(content);

  let bytes;
  try {
    bytes = await buildOfficeFile(kind, content);
  } catch (error) {
    if (error instanceof OfficeError) throw new ToolError('TOOL_INVALID_ARGUMENT', error.message);
    console.error('[zuri:tools] createDocument', error);
    throw new ToolError('TOOL_WRITE_FAILED', `Could not build the ${kind} file.`);
  }

  const directory = resolveWorkspacePath(DOCUMENTS_DIR_NAME);
  const filePath = await freeDocumentPath(directory, documentBaseName(args?.fileName), kind);
  try {
    await fs.mkdir(directory, { recursive: true });
    await writeAtomically(filePath, bytes);
  } catch (error) {
    console.error('[zuri:tools] createDocument', error);
    throw new ToolError('TOOL_WRITE_FAILED', `Could not save "${path.basename(filePath)}" in the workspace.`);
  }

  return ok({
    path: filePath,
    name: path.basename(filePath),
    kind,
    relative: path.relative(getWorkspaceRoot(), filePath).split(path.sep).join('/'),
    bytes: bytes.length,
    // Plain sentences about what will read badly; the model sees them in the tool
    // result and can build a corrected copy, which is the repair round.
    warnings: reviewOfficeContent(kind, content),
  });
}

/**
 * Absolute paths of files the person picked in a system dialog. The model may name a
 * path to edit, but only one the person chose (or one already in the workspace), so a
 * reply can never reach for an arbitrary file on the disk.
 * @type {Set<string>}
 */
const chosenFiles = new Set();

/** @param {string} filePath Absolute path returned by a file dialog. */
export function registerChosenFile(filePath) {
  if (typeof filePath === 'string' && path.isAbsolute(filePath)) chosenFiles.add(path.resolve(filePath).toLowerCase());
}

/** @param {unknown} userPath @returns {string} Absolute, permitted path. */
function resolveEditableSource(userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'editDocument needs the `path` of the attached file.');
  }
  if (!path.isAbsolute(userPath)) return resolveWorkspacePath(userPath);
  const absolute = path.resolve(userPath);
  const relative = path.relative(getWorkspaceRoot(), absolute);
  const insideWorkspace = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!insideWorkspace && !chosenFiles.has(absolute.toLowerCase())) {
    throw new ToolError('TOOL_PATH_NOT_CHOSEN', 'That file was not attached in this app, so it cannot be edited. Attach it first.');
  }
  return absolute;
}

/** @param {any} args @param {any} context */
async function editDocumentTool(args, context) {
  const source = resolveEditableSource(args?.path);
  const kind = path.extname(source).slice(1).toLowerCase();
  if (!OFFICE_KINDS.includes(kind)) {
    throw new ToolError('TOOL_INVALID_ARGUMENT', 'editDocument works on .docx, .xlsx and .pptx files only.');
  }

  let original;
  try {
    const stats = await fs.stat(source);
    if (stats.size > FILE_SIZE_LIMIT) throw new ToolError('TOOL_FILE_TOO_LARGE', 'That file is too large to edit here.');
    original = await fs.readFile(source);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('TOOL_READ_FAILED', `Could not open "${path.basename(source)}". Check that it exists and is not open in another app.`);
  }

  let edited;
  try {
    edited = await editOfficeFile(kind, original, args?.edits);
  } catch (error) {
    if (error instanceof OfficeError) throw new ToolError('TOOL_INVALID_ARGUMENT', error.message);
    console.error('[zuri:tools] editDocument', error);
    throw new ToolError('TOOL_WRITE_FAILED', `Could not edit the ${kind} file.`);
  }
  if (edited.applied === 0) {
    throw new ToolError('TOOL_NOTHING_CHANGED', `None of the edits matched anything in the file. Text that was not found: ${edited.notFound.join('; ').slice(0, 300)}`);
  }

  const directory = resolveWorkspacePath(DOCUMENTS_DIR_NAME);
  const base = `${documentBaseName(path.basename(source))}-edited`;
  const filePath = await freeDocumentPath(directory, base, kind);
  try {
    await fs.mkdir(directory, { recursive: true });
    await writeAtomically(filePath, edited.buffer);
  } catch (error) {
    console.error('[zuri:tools] editDocument', error);
    throw new ToolError('TOOL_WRITE_FAILED', `Could not save "${path.basename(filePath)}" in the workspace.`);
  }

  return ok({
    path: filePath,
    name: path.basename(filePath),
    kind,
    relative: path.relative(getWorkspaceRoot(), filePath).split(path.sep).join('/'),
    bytes: edited.buffer.length,
    changes: edited.applied,
    notFound: edited.notFound,
  });
}

/** @param {any} args @param {any} context */
async function summarizeDocumentTool(args, context) {
  // A caller that already ran readFile passes the text in, so the document is
  // read once instead of twice; a bare path still reads it here.
  const prefetched = typeof args?.text === 'string' && args.text !== '' ? args : null;
  const document = prefetched
    ? {
        path: typeof prefetched.path === 'string' ? prefetched.path : '',
        name:
          typeof prefetched.name === 'string' && prefetched.name !== ''
            ? prefetched.name
            : typeof prefetched.path === 'string'
              ? path.basename(prefetched.path)
              : 'document',
        text: prefetched.text,
        truncated: prefetched.truncated === true,
      }
    : await readDocumentText(context.dependencies, args?.path ?? args?.file);
  const instruction = typeof args?.instruction === 'string' ? args.instruction.trim() : '';

  const summarized = await context.dependencies.summarize({
    text: document.text,
    fileName: document.name,
    instruction,
  });
  if (!summarized || summarized.ok !== true) {
    if (summarized?.error) return summarized;
    throw new ToolError('TOOL_SUMMARIZER_FAILED', 'The summariser returned nothing.');
  }

  const summary =
    typeof summarized.data === 'string' ? summarized.data : String(summarized.data?.summary ?? '').trim();
  if (summary === '') throw new ToolError('TOOL_SUMMARIZER_FAILED', 'The summariser returned an empty summary.');

  // Which provider and model wrote the summary is shown on the result card, so
  // pass it through when the summariser reports it.
  const details = summarized.data && typeof summarized.data === 'object' ? summarized.data : {};
  return ok({
    source: document.path,
    name: document.name,
    summary,
    truncated: document.truncated || details.truncated === true,
    ...(typeof details.provider === 'string' ? { provider: details.provider } : {}),
    ...(typeof details.model === 'string' ? { model: details.model } : {}),
    ...(typeof details.label === 'string' ? { label: details.label } : {}),
  });
}

/** @param {any} args @param {any} context */
async function openUrlTool(args, context) {
  const requested = typeof args?.url === 'string' ? args.url.trim() : '';
  if (requested === '') throw new ToolError('TOOL_INVALID_ARGUMENT', 'openUrl needs a URL.');

  let parsed;
  try {
    parsed = new URL(requested);
  } catch {
    throw new ToolError('TOOL_INVALID_ARGUMENT', `"${requested}" is not a full URL.`);
  }
  if (!WEB_PROTOCOLS.has(parsed.protocol)) {
    throw new ToolError('TOOL_URL_NOT_ALLOWED', 'openUrl only opens http and https links.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ToolError('TOOL_URL_NOT_ALLOWED', 'openUrl does not open links with a username or password in them.');
  }

  const settings = await context.getSettings();
  const allowedUrls = Array.isArray(settings?.allowedUrls) ? settings.allowedUrls : [];
  if (!allowedUrls.some((entry) => urlMatchesEntry(parsed, entry))) {
    throw new ToolError(
      'TOOL_URL_NOT_ALLOWED',
      `"${parsed.origin}" is not in the openUrl allow-list. Add it in Settings, then try again.`,
    );
  }

  await context.dependencies.openExternal(parsed.toString());
  return ok({ url: parsed.toString(), host: parsed.hostname });
}

/** @param {any} args @param {any} context */
async function openAppTool(args, context) {
  const requested = typeof args?.app === 'string' ? args.app.trim() : '';
  if (requested === '') throw new ToolError('TOOL_INVALID_ARGUMENT', 'openApp needs an app name.');
  if (!isSafeAppName(requested)) {
    throw new ToolError(
      'TOOL_INVALID_ARGUMENT',
      `"${requested}" is not a plain app name. Use the name of an executable, without a path.`,
    );
  }

  const settings = await context.getSettings();
  const allowedApps = Array.isArray(settings?.allowedApps) ? settings.allowedApps : [];
  const match = allowedApps.find(
    (entry) => typeof entry === 'string' && normaliseAppName(entry) === normaliseAppName(requested),
  );
  if (!match) {
    throw new ToolError(
      'TOOL_APP_NOT_ALLOWED',
      `"${requested}" is not in the openApp allow-list. Add it in Settings, then try again.`,
    );
  }

  // Launch the stored entry, not the requested text, so casing or a stray suffix
  // on the request cannot change what runs; and refuse an unsafe stored entry.
  const launchName = match.trim();
  if (!isSafeAppName(launchName)) {
    throw new ToolError(
      'TOOL_APP_ENTRY_INVALID',
      `The allow-list entry "${launchName}" is not a plain app name. Fix it in Settings.`,
    );
  }

  await context.dependencies.launchApp(launchName);
  return ok({ app: launchName });
}

/**
 * Add one task to the person's Tasks page.
 *
 * The store owns the rules - a title is required, a due date has to be a real date,
 * a priority has to be one of three - so its refusal is passed through with its own
 * code and message. The model can read that message and correct the arguments on the
 * next round, instead of being told only that something went wrong.
 * @param {{ title?: string, notes?: string, due?: string, priority?: string }} args
 * @returns {Promise<{ ok: true, data: object }>}
 */
async function createTaskTool(args) {
  // Every field is passed on as it arrived: the store treats undefined as "not given",
  // so an empty optional field never turns into an empty string in the saved task.
  const created = await createTask({
    title: args?.title,
    notes: args?.notes,
    due: args?.due,
    priority: args?.priority,
  });
  if (!created.ok) throw new ToolError(created.error.code, created.error.message);
  return ok(created.data);
}

/**
 * A reminder is the only way Zuri can put something in front of the person later, so the
 * call is passed straight through: the store already decides what a moment, a repeat and
 * an interval may look like, and refuses anything it could not schedule.
 */
async function createReminderTool(args) {
  const created = await createReminder({
    title: args?.title,
    dueAt: args?.dueAt,
    repeat: args?.repeat,
    intervalMinutes: args?.intervalMinutes,
    timeOfDay: args?.timeOfDay,
  });
  if (!created.ok) throw new ToolError(created.error.code, created.error.message);
  return ok(created.data);
}

/**
 * Save an explicit account memory. The cloud request is injected by main so the
 * tool registry remains usable offline in tests and never owns session tokens.
 */
async function createMemoryTool(args, context) {
  const content = typeof args?.content === 'string' ? args.content.trim() : '';
  if (content === '') throw new ToolError('MEMORY_CONTENT_REQUIRED', 'A memory needs some text to save.');
  if (typeof context.dependencies.createMemory !== 'function') {
    throw new ToolError('MEMORY_CLOUD_UNAVAILABLE', 'Saving a memory needs a signed-in Zuri Cloud account.');
  }
  const saved = await context.dependencies.createMemory(content);
  if (!saved?.ok) throw new ToolError(saved?.error?.code ?? 'MEMORY_FAILED', saved?.error?.message ?? 'The memory could not be saved.');
  return ok(saved.data?.memory ?? saved.data);
}

/**
 * The cadence arrives flattened as cadenceType plus one matching field, which keeps the
 * tool schema a plain list a model can fill in. It is rebuilt here into the nested shape
 * the store validates, so a half-specified schedule is refused there rather than saved as
 * something that could never fire.
 */
async function createAutomationTool(args) {
  const type = typeof args?.cadenceType === 'string' ? args.cadenceType.trim().toLowerCase() : '';
  const cadence = { type };
  if (type === 'once') cadence.at = args?.at;
  if (type === 'interval') cadence.minutes = args?.minutes;
  if (type === 'daily') cadence.timeOfDay = args?.timeOfDay;

  const created = await createAutomation({
    prompt: args?.prompt,
    mode: args?.mode,
    cadence,
  });
  if (!created.ok) throw new ToolError(created.error.code, created.error.message);
  return ok(created.data);
}

/**
 * The tool list from the card. `requiresConfirmation` is true for anything that
 * changes something outside Zuri: the file system (writeFile) and the desktop
 * (openUrl, openApp). The main process holds the gate, per risks.md.
 * `label` is the short human name the agents page shows beside a checkbox; it is
 * kept here so the registry stays the one list of tools.
 */
export const TOOLS = Object.freeze([
  Object.freeze({
    name: 'createMemory',
    label: 'Remember a fact or preference',
    description: 'Save a short fact or preference across the signed-in account\'s chats and devices.',
    requiresConfirmation: false,
    handler: createMemoryTool,
  }),
  // A to-do the person asked for is reversible: it can be ticked off or deleted on
  // the Tasks page, and it stays inside Zuri. Asking for permission to write down a
  // list item they just asked for would be noise, so this needs no confirmation.
  Object.freeze({
    name: 'createTask',
    label: 'Add a task to the Tasks page',
    description: 'Add one task to the Tasks page in Zuri, with an optional note, due date and priority.',
    requiresConfirmation: false,
    handler: createTaskTool,
  }),
  // Setting a reminder is the other half of "tell me later": one row they can edit or
  // delete, so it needs no confirmation either.
  Object.freeze({
    name: 'createReminder',
    label: 'Set a reminder',
    description: 'Set a reminder that notifies the person at a moment they choose, once or on a repeat.',
    requiresConfirmation: false,
    handler: createReminderTool,
  }),
  Object.freeze({
    name: 'webSearch',
    label: 'Search the web',
    description: 'Search the web and return a short list of results with title, URL and snippet.',
    requiresConfirmation: false,
    handler: webSearchTool,
  }),
  Object.freeze({
    name: 'webFetch',
    label: 'Fetch a web page',
    description: 'Fetch one web page and return its title and readable text.',
    requiresConfirmation: false,
    handler: webFetchTool,
  }),
  Object.freeze({
    name: 'readFile',
    label: 'Read a file or Office document',
    description: 'Read a text document, or the text inside a .docx, .xlsx or .pptx file.',
    requiresConfirmation: false,
    handler: readFileTool,
  }),
  Object.freeze({
    name: 'writeFile',
    label: 'Save a file in the workspace',
    description: 'Save text or Markdown inside the Zuri workspace folder. Overwrites an existing file of the same name.',
    requiresConfirmation: true,
    handler: writeFileTool,
  }),
  // Needs no confirmation: it only ever adds a new file inside the Zuri workspace.
  Object.freeze({
    name: 'createDocument',
    label: 'Create a Word, Excel or PowerPoint file',
    description: 'Build a new .docx, .xlsx, .pptx or .pdf file in the workspace from structured content, for the person to open and edit.',
    requiresConfirmation: false,
    handler: createDocumentTool,
  }),
  Object.freeze({
    name: 'editDocument',
    label: 'Edit a Word, Excel or PowerPoint file',
    description: 'Change text or cells in an attached .docx, .xlsx or .pptx file. The result is saved as a new copy; the original is never changed.',
    // A new copy is safer than overwriting, but it still writes a user document.
    // Keep the approval gate in the main process so model output cannot bypass it.
    requiresConfirmation: true,
    handler: editDocumentTool,
  }),
  Object.freeze({
    name: 'summarizeDocument',
    label: 'Summarise a document',
    description: 'Read a document and ask the AI provider for a summary of it.',
    requiresConfirmation: false,
    handler: summarizeDocumentTool,
  }),
  Object.freeze({
    name: 'openUrl',
    label: 'Open a link in the browser',
    description: 'Open a link in the default browser. Only URLs on the Settings allow-list are accepted.',
    requiresConfirmation: true,
    handler: openUrlTool,
  }),
  Object.freeze({
    name: 'openApp',
    label: 'Start an allowed app',
    description: 'Start an application. Only app names on the Settings allow-list are accepted.',
    requiresConfirmation: true,
    handler: openAppTool,
  }),
  // An automation keeps running after the conversation ends, so it always asks first.
  Object.freeze({
    name: 'createAutomation',
    label: 'Create an automation',
    description: 'Create a prompt Zuri runs on a schedule by itself: a one-off moment, an interval or a daily time.',
    requiresConfirmation: true,
    handler: createAutomationTool,
  }),
]);

/** Every registered tool name, in registration order. */
export const TOOL_NAMES = Object.freeze(TOOLS.map((tool) => tool.name));

/**
 * Live implementations of everything that leaves this module. Injected so the
 * selftest can drive the guards with fakes (conventions.md section 6). The
 * summariser is supplied by the caller: importing the provider back into this
 * module would be a cycle, since providers/chat.js selects tools from here.
 */
const DEFAULT_DEPENDENCIES = Object.freeze({
  fetch: (...args) => globalThis.fetch(...args),

  /**
   * Ask the OS to open a link. Electron is required lazily so this module can be
   * imported under plain Node.
   * @param {string} url @returns {Promise<void>}
   */
  async openExternal(url) {
    const require = createRequire(import.meta.url);
    const electron = require('electron');
    const shell = electron?.shell;
    if (typeof shell?.openExternal !== 'function') {
      throw new ToolError('TOOL_OPEN_URL_UNAVAILABLE', 'Opening a link needs the desktop shell, which is not available here.');
    }
    await shell.openExternal(url);
  },

  /**
   * Start an executable by name. There is no shell in the way, so an allow-list
   * entry cannot smuggle a second command in.
   * @param {string} name @returns {Promise<void>}
   */
  async launchApp(name) {
    const child = spawn(name, [], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error) => {
        console.error('[zuri:tools] launchApp', error);
        reject(
          new ToolError(
            'TOOL_APP_LAUNCH_FAILED',
            `Windows could not start "${name}". The allow-list entry must be an executable name that is on PATH.`,
          ),
        );
      });
    });
    child.unref();
  },

  /**
   * Extract text from an Office file. A workbook is listed cell by cell with its
   * addresses so an edit can name the cell; Word and PowerPoint use officeparser.
   * @param {string} filePath @returns {Promise<string>}
   */
  async extractDocument(filePath) {
    try {
      if (path.extname(filePath).toLowerCase() === '.xlsx') return await describeWorkbook(filePath);
      const officeparser = await import('officeparser');
      const parsed = await officeparser.parseOffice(filePath);
      return parsed.toText();
    } catch (error) {
      console.error('[zuri:tools] extractDocument', error);
      throw new ToolError(
        'TOOL_READ_FAILED',
        `Could not read "${path.basename(filePath)}". It may be damaged, password protected or open in another app.`,
      );
    }
  },

  /**
   * Summariser seam. The main process passes the provider-backed version once the
   * AI adapter is wired; until then the tool reports why it cannot summarise.
   * @returns {Promise<never>}
   */
  async summarize() {
    throw new ToolError(
      'TOOL_SUMMARIZER_MISSING',
      'Summarising needs the AI provider, which is not connected to the tool layer yet.',
    );
  },
});

/**
 * Read settings lazily, so a tool that does not need the allow-list never touches
 * the store. A caller-supplied settings object wins, which keeps the tests offline.
 * @param {{ settings?: object }} options
 * @returns {() => Promise<any>}
 */
function settingsLoader(options) {
  if (options.settings && typeof options.settings === 'object') {
    return async () => options.settings;
  }
  return async () => {
    const stored = await readStore('settings');
    if (!stored.ok) {
      throw new ToolError(
        'TOOL_SETTINGS_UNAVAILABLE',
        `Could not read the allow-list from Settings: ${stored.error.message}`,
      );
    }
    return stored.data;
  };
}

/**
 * One tool by name, or null when the name is not registered.
 * @param {string} name
 * @returns {typeof TOOLS[number] | null}
 */
export function getTool(name) {
  return TOOLS.find((tool) => tool.name === name) ?? null;
}

/**
 * The descriptors Act may offer, without handlers, so the renderer never receives
 * a function. Passing `allowedTools` filters to the active agent's set; an empty
 * array legitimately means "this agent may use no tools".
 * @param {{ allowedTools?: string[] }} [options]
 * @returns {{ name: string, description: string, requiresConfirmation: boolean }[]}
 */
export function listTools(options = {}) {
  const allowed = Array.isArray(options.allowedTools) ? options.allowedTools : null;
  return TOOLS.filter((tool) => allowed === null || allowed.includes(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    requiresConfirmation: tool.requiresConfirmation,
  }));
}

/**
 * The short names the agents page and any picker show, without handlers.
 * Separate from listTools because the settings page needs the label and the run
 * path needs the description, and neither should carry the other.
 * @returns {{ name: string, label: string, description: string }[]}
 */
export function toolCatalogue() {
  return TOOLS.map((tool) => ({ name: tool.name, label: tool.label, description: tool.description }));
}

/** Return enabled connector tools without exposing a handler to the renderer. */
export async function listMcpTools(settings) {
  return (await discoverMcpTools(settings)).map((tool) => ({ name: tool.name, label: tool.label, description: tool.description, requiresConfirmation: true }));
}

function mcpToolFor(name, descriptors = []) {
  return descriptors.find((tool) => tool.name === name) ?? null;
}

/**
 * The tools the active agent may use, read from settings.json.
 *
 * This is where the agent's allow-list is turned into a tool list: the composer
 * only sends the id, and the filter lives here so a renderer cannot widen its own
 * tool set by claiming a different list.
 * @param {object} settings
 * @param {string} [agentId] Defaults to `settings.activeAgentId`.
 * @returns {string[] | null} null means no agent, so every tool stays available.
 */
export function agentAllowedTools(settings, agentId) {
  const agent = findAgent(settings, agentId);
  return agent === null ? null : agent.allowedTools;
}

/**
 * listTools narrowed to one agent's allow-list.
 * @param {object} settings
 * @param {string} [agentId]
 * @returns {{ name: string, description: string, requiresConfirmation: boolean }[]}
 */
export function listToolsForAgent(settings, agentId) {
  return listTools({ allowedTools: agentAllowedTools(settings, agentId) });
}

/**
 * Run one tool call. This is the only way in, and it holds every guard in order:
 * unknown name, the agent's allow-list, the confirmation gate, then the handler.
 * @param {string} name
 * @param {Record<string, any>} [args]
 * @param {{
 *   allowedTools?: string[],
 *   confirmed?: boolean,
 *   settings?: object,
 *   dependencies?: Record<string, Function>
 * }} [options]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string } }>}
 */
export async function runTool(name, args = {}, options = {}) {
  const stepId = typeof options.stepId === 'string' ? options.stepId.trim() : '';
  if (stepId !== '' && cancelledSteps.has(stepId)) {
    cancelledSteps.delete(stepId);
    return failure('TOOL_CANCELLED', `${String(name)} was cancelled before it ran.`);
  }

  const tool = getTool(name);
  const mcpTool = mcpToolFor(name, options.mcpTools);
  if (!tool && mcpTool) {
    if (Array.isArray(options.allowedTools) && !options.allowedTools.includes(mcpTool.name)) {
      return failure('TOOL_NOT_ALLOWED', `${mcpTool.name} is not in this agent's allowed tools.`);
    }
    if (options.confirmed !== true) return failure('TOOL_CONFIRMATION_REQUIRED', `${name} changes things outside Zuri, so it needs confirmation first.`);
    try {
      const settings = await settingsLoader(options)();
      const server = Array.isArray(settings?.mcpServers) ? settings.mcpServers.find((entry) => entry.id === mcpTool.mcpServerId && entry.enabled === true) : null;
      if (!server) return failure('MCP_SERVER_DISABLED', 'That MCP server is disabled or no longer configured.');
      const result = await callMcpTool(server, mcpTool.mcpToolName, args);
      return ok({ server: mcpTool.mcpServerId, tool: mcpTool.mcpToolName, result });
    } catch (error) {
      console.warn(`[zuri:mcp] ${mcpTool.mcpServerId}: ${error.message}`);
      return failure('MCP_TOOL_FAILED', error.message);
    }
  }
  if (!tool) {
    return failure('TOOL_UNKNOWN', `"${String(name)}" is not a Zuri tool. The tools are: ${TOOL_NAMES.join(', ')}.`);
  }

  if (Array.isArray(options.allowedTools) && !options.allowedTools.includes(tool.name)) {
    return failure('TOOL_NOT_ALLOWED', `${tool.name} is not in this agent's allowed tools.`);
  }

  if (tool.requiresConfirmation && options.confirmed !== true) {
    return failure('TOOL_CONFIRMATION_REQUIRED', `${tool.name} changes things outside Zuri, so it needs confirmation first.`);
  }

  const context = {
    getSettings: settingsLoader(options),
    dependencies: { ...DEFAULT_DEPENDENCIES, ...(options.dependencies ?? {}) },
  };

  try {
    return await tool.handler(args ?? {}, context);
  } catch (error) {
    if (error instanceof ToolError) return failure(error.code, error.message);
    console.error('[zuri:tools]', error);
    return failure('TOOL_FAILED', `${tool.name} failed: ${error?.message ?? 'unknown error'}`);
  }
}

/**
 * Record a Cancel press from a step row. tools:cancel in main.js calls this.
 * An unknown id is accepted rather than refused: cancel is idempotent, and a step
 * that is already gone has nothing left to stop.
 * @param {string} stepId
 * @returns {{ ok: true, data: { id: string, cancelled: boolean } } | { ok: false, error: { code: string, message: string } }}
 */
export function cancelToolStep(stepId) {
  const id = typeof stepId === 'string' ? stepId.trim() : '';
  if (id === '') {
    return failure('TOOLS_STEP_REQUIRED', 'Cancelling a step needs the step id shown on the row.');
  }
  cancelledSteps.add(id);
  return ok({ id, cancelled: true });
}

/**
 * Whether a step was cancelled before its run left the renderer. The selftest
 * drives the guard through this, so it never has to wait for a rejected run.
 * @param {string} stepId
 * @returns {boolean}
 */
export function isToolStepCancelled(stepId) {
  return cancelledSteps.has(String(stepId ?? '').trim());
}
