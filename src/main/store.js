/**
 * store.js - the single owner of the JSON files under userData.
 *
 * Every read and write of chats/tasks/reminders/schedules/runs/notifications/settings
 * goes through here, so no other module has to know where userData is or how a file
 * is written. Writes are atomic (temp file, then rename), because a crash halfway
 * through a plain write would truncate the user's whole task list.
 *
 * Note on the writer: the stack entry named `write-file-atomic`, which is not
 * installed. The guarantee it exists for is implemented directly below (write to a
 * unique `.tmp` file, fsync, rename into place), which is the same tmp-then-rename
 * behaviour the acceptance test looks for and adds no dependency.
 *
 * All functions return the main process' discriminated result shape from
 * conventions.md: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
 * Nothing throws across this boundary, so IPC handlers can forward the result as is.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const STORE_DIR_NAME = 'zuri';
const WRITE_RETRY_DELAY_MS = 250;

/**
 * The files this module owns and the shape each one holds when it has never been
 * written. Collections are arrays, settings is a single object; an empty array or
 * an object of defaults is what "no data yet" means on disk.
 * @type {Readonly<Record<string, Object>>}
 */
export const DEFAULT_DATA = Object.freeze({
  chats: Object.freeze([]),
  tasks: Object.freeze([]),
  reminders: Object.freeze([]),
  schedules: Object.freeze([]),
  runs: Object.freeze([]),
  notifications: Object.freeze([]),
  // Dark is the default theme: index.html paints the dark canvas before the first
  // frame, so a light default here would flash the wrong theme on first launch.
  // Both Act allow-lists start empty, so a fresh install can launch nothing until
  // the person adds app names and URLs in Settings. Deny by default.
  settings: Object.freeze({
    name: '',
    theme: 'dark',
    // The top bar shows the active model, so the choice has to live somewhere the
    // renderer can read; gpt-4o is the adapter's default when none is chosen.
    model: 'gpt-4o',
    allowedApps: Object.freeze([]),
    allowedUrls: Object.freeze([]),
  }),
});

/** Every store key, in the order the acceptance test lists the files. */
export const STORE_KEYS = Object.freeze(Object.keys(DEFAULT_DATA));

/** Absolute directory set by tests; null in the app, which uses userData/zuri. */
let rootOverride = null;

/** Serial number for temp file names, so two writes never share a scratch file. */
let tempSerial = 0;

/**
 * One promise chain per destination file, so writes to the same file run in order.
 * Windows refuses a rename whose destination another rename is replacing at the
 * same instant (EPERM), so two concurrent writes to one file would fail even though
 * each is individually atomic. The map holds at most one entry per store file.
 * @type {Map<string, Promise<void>>}
 */
const writeChains = new Map();

/**
 * Point the store at an explicit directory. Only scripts use this: the acceptance
 * rule is that tests write under os.tmpdir() and never into the real userData.
 * @param {string} directory Absolute path to use as the store root.
 * @returns {void}
 */
export function setStoreRoot(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('setStoreRoot expects an absolute directory path');
  }
  rootOverride = directory;
}

/**
 * The directory the store reads and writes today.
 * Electron is required lazily so `node scripts/selftest.js` can import this module
 * without an Electron app object; in the app it resolves to userData/zuri.
 * @returns {string} Absolute store root.
 */
export function getStoreRoot() {
  if (rootOverride) return rootOverride;

  const require = createRequire(import.meta.url);
  const electron = require('electron');
  const app = electron?.app;
  if (typeof app?.getPath !== 'function') {
    throw new Error('store.js needs Electron: call setStoreRoot() before using it outside the app');
  }
  return path.join(app.getPath('userData'), STORE_DIR_NAME);
}

/**
 * The on-disk filename for a store key.
 * @param {string} key One of STORE_KEYS.
 * @returns {string} Filename such as `tasks.json`.
 */
export function fileNameFor(key) {
  if (!Object.hasOwn(DEFAULT_DATA, key)) {
    throw new Error(`unknown store key: ${key}`);
  }
  return `${key}.json`;
}

/**
 * Absolute path of one store file. The key is checked against DEFAULT_DATA first,
 * so a caller cannot walk out of the store directory with a crafted name.
 * @param {string} key One of STORE_KEYS.
 * @param {string} [root] Override for the store root; defaults to getStoreRoot().
 * @returns {string} Absolute file path.
 */
export function resolveStorePath(key, root = getStoreRoot()) {
  return path.join(root, fileNameFor(key));
}

/**
 * Read one store file. A missing file is created from DEFAULT_DATA and returned,
 * which is what makes first launch produce every file the app expects.
 * A file that cannot be parsed is reported as an error and left byte-for-byte
 * alone: it is the only copy of that data, so silently overwriting it would be
 * data loss dressed up as recovery.
 * @param {string} key One of STORE_KEYS.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string } }>}
 */
export async function readStore(key, options = {}) {
  if (!Object.hasOwn(DEFAULT_DATA, key)) {
    return failure('STORE_UNKNOWN_KEY', `unknown store key: ${key}`);
  }

  const root = options.root ?? getStoreRoot();
  const target = resolveStorePath(key, root);

  let raw;
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return failure('STORE_READ_FAILED', `${fileNameFor(key)}: ${error.message}`);
    }
    return createWithDefaults(key, root);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return failure('STORE_READ_FAILED', `${fileNameFor(key)} is not valid JSON: ${error.message}`);
  }

  if (!matchesShape(parsed, expectedShape(key))) {
    return failure(
      'STORE_READ_FAILED',
      `${fileNameFor(key)} should hold ${expectedShape(key)} but holds ${describeShape(parsed)}`,
    );
  }

  return { ok: true, data: parsed };
}

/**
 * Replace one store file with `value`, atomically.
 * Retries once after a short delay before reporting STORE_WRITE_FAILED, which is
 * the behaviour conventions.md asks for (a transient Windows file lock, for
 * example from antivirus, usually clears by the second attempt).
 * @param {string} key One of STORE_KEYS.
 * @param {any} value Array for collections, object for settings, matching the default shape.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string } }>}
 */
export async function writeStore(key, value, options = {}) {
  if (!Object.hasOwn(DEFAULT_DATA, key)) {
    return failure('STORE_UNKNOWN_KEY', `unknown store key: ${key}`);
  }
  if (!matchesShape(value, expectedShape(key))) {
    return failure(
      'STORE_INVALID_DATA',
      `${fileNameFor(key)} should hold ${expectedShape(key)} but was given ${describeShape(value)}`,
    );
  }

  const root = options.root ?? getStoreRoot();
  const target = resolveStorePath(key, root);
  const text = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await fs.mkdir(root, { recursive: true });
  } catch (error) {
    return failure('STORE_WRITE_FAILED', `${fileNameFor(key)}: could not create ${root}: ${error.message}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await enqueueWrite(target, () => writeAtomic(target, text));
      return { ok: true, data: value };
    } catch (error) {
      lastError = error;
      if (attempt === 1) await delay(WRITE_RETRY_DELAY_MS);
    }
  }

  return failure('STORE_WRITE_FAILED', `${fileNameFor(key)}: ${lastError?.message ?? 'write failed'}`);
}

/* ---------------------------------------------------------------------------
   Settings

   settings.json is one object the renderer reads through zuri:settings:get and
   writes a patch of through zuri:settings:save. Reads merge the stored object over
   the defaults, so a file written by an older build (no `model`, for example) still
   answers with every field the top bar asks for.
   ------------------------------------------------------------------------- */

/**
 * Serial queue for settings saves. saveSettings is read-modify-write on one file:
 * a theme toggle and an onboarding save landing together would otherwise each read
 * the same object and the second would drop the first's field.
 * @type {Promise<void>}
 */
let settingsChain = Promise.resolve();

/**
 * Run `task` after every settings save already queued has settled.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withSettingsLock(task) {
  const result = settingsChain.then(task, task);
  settingsChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * The stored settings with every default filled in.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function readSettings(options = {}) {
  const read = await readStore('settings', options);
  if (!read.ok) return read;
  return { ok: true, data: { ...structuredClone(DEFAULT_DATA.settings), ...read.data } };
}

/**
 * Merge `patch` into the stored settings and write the result.
 * Only fields the caller names change, so two views can save different settings
 * without having to read and resend the whole object.
 * @param {object} patch Fields to change, e.g. `{ theme: 'light' }`.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function saveSettings(patch, options = {}) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return failure('SETTINGS_INVALID_PATCH', 'settings save expects an object of the fields to change');
  }
  // index.html paints `data-theme` before the renderer runs, and the token layer
  // only has two themes: an unknown value would leave the app unthemed after a restart.
  if (Object.hasOwn(patch, 'theme') && patch.theme !== 'light' && patch.theme !== 'dark') {
    return failure('SETTINGS_INVALID_THEME', "theme must be 'light' or 'dark'");
  }

  return withSettingsLock(async () => {
    const read = await readStore('settings', options);
    if (!read.ok) return read;

    const next = { ...read.data, ...patch };
    const written = await writeStore('settings', next, options);
    if (!written.ok) return written;

    return { ok: true, data: next };
  });
}

/* ---------------------------------------------------------------------------
   Chat threads

   chats.json holds every thread with its messages inline. One file makes
   "list the threads, newest first" and "append one message" a single read and a
   single write, and it means restoring the sidebar on launch is one read.

   A thread is `{ id, title, createdAt, updatedAt, messages: [] }`; `updatedAt`
   exists because the sidebar sorts on it, and a thread with no messages would
   otherwise have nothing to sort by after its first send. A message is
   `{ id, role: 'user' | 'assistant', content, createdAt }`.
   ------------------------------------------------------------------------- */

/** Title a thread carries until its first user message names it. */
export const UNTITLED_THREAD = 'New chat';

/** Longer titles are cut here; sidebar rows truncate them anyway. */
const THREAD_TITLE_MAX_LENGTH = 60;

/**
 * Serial queue for chat mutations. createThread and appendMessage are both
 * read-modify-write on one file: two running at once would each read the same
 * array and whichever wrote last would drop the other's message.
 * @type {Promise<void>}
 */
let chatChain = Promise.resolve();

/**
 * Run `task` after every chat mutation already queued has settled. A failed
 * mutation must not block the next one, so the chain swallows errors here; the
 * caller still sees its own failure through the returned promise.
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withChatLock(task) {
  const result = chatChain.then(task, task);
  chatChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Every stored thread, newest first by `updatedAt`.
 * Entries that are not thread-shaped are skipped rather than crashing the list:
 * one bad record must not hide the rest of the sidebar.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: any[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listThreads(options = {}) {
  const read = await readStore('chats', options);
  if (!read.ok) return read;

  const threads = read.data.filter(isThread).sort((left, right) => compareThreads(right, left));
  return { ok: true, data: threads };
}

/**
 * Create one empty thread and persist it.
 * @param {{ title?: string }} [input]
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string } }>}
 */
export async function createThread(input = {}, options = {}) {
  const now = new Date().toISOString();
  const thread = {
    id: randomUUID(),
    title: normaliseTitle(input?.title) || UNTITLED_THREAD,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  return withChatLock(async () => {
    const read = await readStore('chats', options);
    if (!read.ok) return read;

    read.data.push(thread);
    const written = await writeStore('chats', read.data, options);
    if (!written.ok) return written;

    return { ok: true, data: thread };
  });
}

/**
 * The modes a turn can be sent in. Kept here as well as in the renderer because a
 * stored turn keeps the mode it was sent in, and an unknown one is dropped rather
 * than written into chats.json.
 */
const MESSAGE_MODES = Object.freeze(['ask', 'act', 'autopilot']);

/**
 * Append one message to a thread, bump its `updatedAt`, and persist.
 * @param {string} threadId
 * @param {{ role?: 'user' | 'assistant', content?: string, mode?: string }} message
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { thread: any, message: any } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function appendMessage(threadId, message, options = {}) {
  if (typeof threadId !== 'string' || threadId === '') {
    return failure('CHAT_INVALID_THREAD', 'appending a message needs a thread id');
  }
  if (message === null || typeof message !== 'object') {
    return failure('CHAT_INVALID_MESSAGE', 'a message needs a role and a content string');
  }

  const role = message.role ?? 'user';
  if (role !== 'user' && role !== 'assistant') {
    return failure('CHAT_INVALID_MESSAGE', `unknown message role: ${String(role)}`);
  }
  if (typeof message.content !== 'string' || message.content.trim() === '') {
    return failure('CHAT_INVALID_MESSAGE', 'a message needs non-empty content');
  }

  const now = new Date().toISOString();
  const content = message.content.trim();

  return withChatLock(async () => {
    const read = await readStore('chats', options);
    if (!read.ok) return read;

    const thread = read.data.find((entry) => entry?.id === threadId);
    if (!thread) return failure('CHAT_NOT_FOUND', `no chat thread with id ${threadId}`);
    if (!Array.isArray(thread.messages)) thread.messages = [];

    const mode = MESSAGE_MODES.includes(message.mode) ? message.mode : null;
    const stored = { id: randomUUID(), role, content, createdAt: now, ...(mode ? { mode } : {}) };
    thread.messages.push(stored);
    thread.updatedAt = now;
    // The first user message names the thread, so a chat called "New chat" in the
    // sidebar does not stay that way. A title set by anything else is left alone.
    if (role === 'user' && isUntitled(thread.title)) thread.title = normaliseTitle(content);

    const written = await writeStore('chats', read.data, options);
    if (!written.ok) return written;

    return { ok: true, data: { thread, message: stored } };
  });
}

/**
 * Newest first, with ISO strings compared directly. `createdAt` breaks a tie on
 * `updatedAt`, so two threads saved in the same millisecond still have an order.
 * @param {{ updatedAt?: string, createdAt?: string }} left
 * @param {{ updatedAt?: string, createdAt?: string }} right
 * @returns {number}
 */
function compareThreads(left, right) {
  const byUpdate = String(left.updatedAt ?? '').localeCompare(String(right.updatedAt ?? ''));
  if (byUpdate !== 0) return byUpdate;
  return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
}

/**
 * @param {unknown} entry
 * @returns {boolean}
 */
function isThread(entry) {
  return entry !== null && typeof entry === 'object' && typeof entry.id === 'string';
}

/**
 * @param {unknown} title
 * @returns {boolean}
 */
function isUntitled(title) {
  return typeof title !== 'string' || title.trim() === '' || title === UNTITLED_THREAD;
}

/**
 * One line, at most THREAD_TITLE_MAX_LENGTH characters, with ASCII dots rather
 * than an ellipsis so the value stays plain text everywhere it is shown.
 * @param {unknown} text
 * @returns {string}
 */
function normaliseTitle(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= THREAD_TITLE_MAX_LENGTH) return flat;
  return `${flat.slice(0, THREAD_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

/**
 * Run `task` after every write already queued for `target` has settled.
 * A failed write must not block the next one, hence the swallow below: the error
 * still reaches the caller that caused it through the returned promise.
 * @param {string} target Absolute destination path.
 * @param {() => Promise<void>} task
 * @returns {Promise<void>}
 */
function enqueueWrite(target, task) {
  const previous = writeChains.get(target) ?? Promise.resolve();
  const result = previous.then(task, task);
  writeChains.set(
    target,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/**
 * Write the defaults for `key` and return them, for a file seen for the first time.
 * @param {string} key
 * @param {string} root
 * @returns {Promise<{ ok: true, data: any } | { ok: false, error: { code: string, message: string } }>}
 */
async function createWithDefaults(key, root) {
  const defaults = structuredClone(DEFAULT_DATA[key]);
  const written = await writeStore(key, defaults, { root });
  if (!written.ok) return written;
  return { ok: true, data: defaults };
}

/**
 * Write `text` to `target` through a temp file in the same directory.
 * The temp name is unique per call: two writers sharing one scratch file could
 * interleave their bytes before either rename, producing a valid-looking file
 * with mixed content.
 * @param {string} target Absolute destination path.
 * @param {string} text Exact file contents.
 * @returns {Promise<void>}
 */
async function writeAtomic(target, text) {
  tempSerial += 1;
  const tempPath = `${target}.${process.pid}-${tempSerial}.tmp`;
  try {
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      // Flush before the rename: otherwise a crash can leave the destination name
      // pointing at a file whose bytes never reached the disk.
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Rename within one directory is atomic: a reader sees the old file or the new
    // one, never a half-written one.
    await fs.rename(tempPath, target);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch (cleanupError) {
      console.error('[zuri:store] could not remove temp file', cleanupError);
    }
    throw error;
  }
}

/**
 * Shape a value must have to be stored under `key`.
 * @param {string} key
 * @returns {'array'|'object'}
 */
function expectedShape(key) {
  return Array.isArray(DEFAULT_DATA[key]) ? 'array' : 'object';
}

/**
 * @param {unknown} value
 * @param {'array'|'object'} shape
 * @returns {boolean}
 */
function matchesShape(value, shape) {
  if (shape === 'array') return Array.isArray(value);
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Short, printable description of a value's shape, for error messages.
 * @param {unknown} value
 * @returns {string}
 */
function describeShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * @param {string} code SCREAMING_SNAKE code for the caller to branch on.
 * @param {string} message User-presentable prose.
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
