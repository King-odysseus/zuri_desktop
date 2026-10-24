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
    // The floating quick-ask window is opt-in: it sits above every other application,
    // so it opens at launch only after the person switches it on in Settings.
    overlayEnabled: false,
    // The chat the main window last had on screen. The overlay appends to this thread,
    // so a question asked from over another application lands in the conversation the
    // person was reading. Written by the chat view; empty until a thread is opened.
    activeThreadId: '',
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

/**
 * One agent record out of settings.json: `{ id, name, systemPrompt, allowedTools }`.
 *
 * The chat adapter and the tool registry both want this normalised shape rather
 * than the raw entry: a record with no prompt still has to be trimmable, and one
 * with no allow-list still has to be iterable. An empty id means "whoever is
 * active", which is what the composer sends when no agent is picked; with no
 * active agent either there is no agent, and the caller keeps plain chat
 * behaviour.
 * @param {object} settings
 * @param {string} [agentId] Defaults to `settings.activeAgentId`.
 * @returns {{ id: string, name: string, systemPrompt: string, allowedTools: string[] } | null}
 */
export function findAgent(settings, agentId = '') {
  const agents = Array.isArray(settings?.agents) ? settings.agents : [];
  const wanted = typeof agentId === 'string' && agentId !== '' ? agentId : settings?.activeAgentId;
  if (typeof wanted !== 'string' || wanted === '') return null;

  const found = agents.find((agent) => agent?.id === wanted);
  if (found === undefined) return null;

  return {
    id: found.id,
    name: typeof found.name === 'string' ? found.name : '',
    systemPrompt: typeof found.systemPrompt === 'string' ? found.systemPrompt : '',
    allowedTools: Array.isArray(found.allowedTools)
      ? found.allowedTools.filter((tool) => typeof tool === 'string')
      : [],
  };
}

/* ---------------------------------------------------------------------------
   Tasks

   tasks.json is one array, and every action is one read plus one write of that
   array: the list is small, and the whole file is the unit the person sees, so
   a create, an edit and a delete all leave the file in the state the Tasks view
   is showing. A task is
   `{ id, title, notes, due, priority, done, createdAt, updatedAt, completedAt }`.
   `due` is an ISO 8601 string or null (a task may have no date), `done` is the
   boolean the view filters on, and `priority` is 'low' | 'medium' | 'high'.
   ------------------------------------------------------------------------- */

/** Priorities, low to high. Anything else is refused rather than guessed at. */
export const TASK_PRIORITIES = Object.freeze(['low', 'medium', 'high']);
export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_NOTES_MAX_LENGTH = 500;

/** Serialises task writes so two quick actions cannot read the same old array. */
let tasksChain = Promise.resolve();

/**
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
function withTasksLock(task) {
  const result = tasksChain.then(task, task);
  tasksChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Trimmed, length-capped title, or '' when the caller sent nothing usable.
 * @param {unknown} value
 * @returns {string}
 */
function normaliseTaskTitle(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, TASK_TITLE_MAX_LENGTH);
}

/**
 * Notes are optional: '' and null both mean "no note".
 * @param {unknown} value
 * @returns {string|undefined} undefined when the value is not text at all.
 */
function normaliseTaskNotes(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, TASK_NOTES_MAX_LENGTH);
}

/**
 * @param {unknown} value
 * @returns {string|null|undefined} null means "no due date", undefined means "not a date".
 */
function normaliseTaskDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * @param {unknown} value
 * @returns {string|undefined} undefined when the value is not one of TASK_PRIORITIES.
 */
function normaliseTaskPriority(value) {
  if (value === undefined || value === null || value === '') return 'medium';
  const candidate = String(value).toLowerCase();
  return TASK_PRIORITIES.includes(candidate) ? candidate : undefined;
}

/**
 * A stored entry is only a task if it has the two fields the view needs to draw
 * a row. Anything else in the file (a hand edit, an older shape) is skipped
 * rather than crashing the list.
 * @param {unknown} value
 * @returns {boolean}
 */
function isTaskEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string'
  );
}

/**
 * Open tasks first, then the soonest due date, then the oldest task. Undated open
 * tasks sink below dated ones: they are the ones the person has not scheduled yet.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareTasks(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const aDue = typeof a.due === 'string' && a.due !== '' ? Date.parse(a.due) : Number.POSITIVE_INFINITY;
  const bDue = typeof b.due === 'string' && b.due !== '' ? Date.parse(b.due) : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
}

/**
 * Every task in tasks.json, ordered the way the Tasks view draws them.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listTasks(options = {}) {
  const read = await readStore('tasks', options);
  if (!read.ok) return read;
  return { ok: true, data: read.data.filter(isTaskEntry).sort(compareTasks) };
}

/**
 * Add one task and return it. The id, timestamps and `done: false` are set here,
 * so a renderer cannot invent a task that the view would then be unable to edit.
 * @param {{ title?: unknown, notes?: unknown, due?: unknown, priority?: unknown }} input
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function createTask(input, options = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return failure('TASK_INVALID_INPUT', 'Saving a task expects the fields to save.');
  }

  const title = normaliseTaskTitle(input.title);
  if (title === '') {
    return failure('TASK_TITLE_REQUIRED', 'A task needs a title before it can be saved.');
  }
  const notes = normaliseTaskNotes(input.notes);
  if (notes === undefined) return failure('TASK_INVALID_NOTES', 'The note must be text.');
  const due = 'due' in input ? normaliseTaskDue(input.due) : null;
  if (due === undefined) return failure('TASK_INVALID_DUE', 'The due date must be a date, or left empty.');
  const priority = normaliseTaskPriority(input.priority);
  if (priority === undefined) {
    return failure('TASK_INVALID_PRIORITY', `The priority must be one of ${TASK_PRIORITIES.join(', ')}.`);
  }

  const now = new Date().toISOString();

  return withTasksLock(async () => {
    const read = await readStore('tasks', options);
    if (!read.ok) return read;

    const task = {
      id: randomUUID(),
      title,
      notes,
      due,
      priority,
      done: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const next = [...read.data.filter(isTaskEntry), task].sort(compareTasks);
    const written = await writeStore('tasks', next, options);
    if (!written.ok) return written;

    return { ok: true, data: task };
  });
}

/**
 * Change the fields the caller names on one task. Completing a task is an update
 * with `{ done: true }`, which is why there is no separate complete function.
 * @param {string} taskId
 * @param {object} patch Fields to change: title, notes, due, priority, done.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function updateTask(taskId, patch, options = {}) {
  if (typeof taskId !== 'string' || taskId === '') {
    return failure('TASK_INVALID_ID', 'Which task to save was not given.');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return failure('TASK_INVALID_PATCH', 'Saving a task expects an object of the fields to change.');
  }

  return withTasksLock(async () => {
    const read = await readStore('tasks', options);
    if (!read.ok) return read;

    const tasks = read.data.filter(isTaskEntry);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return failure('TASK_NOT_FOUND', 'That task is no longer in tasks.json. Reload the list.');
    }

    const next = { ...tasks[index] };

    if (Object.hasOwn(patch, 'title')) {
      const title = normaliseTaskTitle(patch.title);
      if (title === '') return failure('TASK_TITLE_REQUIRED', 'A task needs a title before it can be saved.');
      next.title = title;
    }
    if (Object.hasOwn(patch, 'notes')) {
      const notes = normaliseTaskNotes(patch.notes);
      if (notes === undefined) return failure('TASK_INVALID_NOTES', 'The note must be text.');
      next.notes = notes;
    }
    if (Object.hasOwn(patch, 'due')) {
      const due = normaliseTaskDue(patch.due);
      if (due === undefined) return failure('TASK_INVALID_DUE', 'The due date must be a date, or left empty.');
      next.due = due;
    }
    if (Object.hasOwn(patch, 'priority')) {
      const priority = normaliseTaskPriority(patch.priority);
      if (priority === undefined) {
        return failure('TASK_INVALID_PRIORITY', `The priority must be one of ${TASK_PRIORITIES.join(', ')}.`);
      }
      next.priority = priority;
    }
    if (Object.hasOwn(patch, 'done')) {
      if (typeof patch.done !== 'boolean') return failure('TASK_INVALID_DONE', 'done must be true or false.');
      next.done = patch.done;
      // completedAt is what the Done filter sorts on, so it is cleared on reopen.
      next.completedAt = patch.done ? new Date().toISOString() : null;
    }

    next.updatedAt = new Date().toISOString();
    tasks[index] = next;

    const written = await writeStore('tasks', [...tasks].sort(compareTasks), options);
    if (!written.ok) return written;

    return { ok: true, data: next };
  });
}

/**
 * Remove one task from tasks.json and return what was removed, so the view can
 * say which task it deleted.
 * @param {string} taskId
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function deleteTask(taskId, options = {}) {
  if (typeof taskId !== 'string' || taskId === '') {
    return failure('TASK_INVALID_ID', 'Which task to delete was not given.');
  }

  return withTasksLock(async () => {
    const read = await readStore('tasks', options);
    if (!read.ok) return read;

    const tasks = read.data.filter(isTaskEntry);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      return failure('TASK_NOT_FOUND', 'That task is no longer in tasks.json. Reload the list.');
    }

    const [removed] = tasks.splice(index, 1);
    const written = await writeStore('tasks', tasks, options);
    if (!written.ok) return written;

    return { ok: true, data: removed };
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
 * Permanently remove one chat thread and its inline messages.
 * @param {string} threadId
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { id: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function deleteThread(threadId, options = {}) {
  if (typeof threadId !== 'string' || threadId.trim() === '') {
    return failure('CHAT_INVALID_THREAD', 'deleting a chat needs a thread id');
  }

  return withChatLock(async () => {
    const read = await readStore('chats', options);
    if (!read.ok) return read;

    const index = read.data.findIndex((entry) => entry?.id === threadId);
    if (index === -1) return failure('CHAT_NOT_FOUND', `no chat thread with id ${threadId}`);

    read.data.splice(index, 1);
    const written = await writeStore('chats', read.data, options);
    if (!written.ok) return written;

    return { ok: true, data: { id: threadId } };
  });
}

/**
 * Permanently remove every stored chat thread in one locked write. Keeping this
 * as one store operation prevents a new message arriving between per-thread
 * deletes from being lost or recreating an old snapshot.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { count: number } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function clearThreads(options = {}) {
  return withChatLock(async () => {
    const read = await readStore('chats', options);
    if (!read.ok) return read;

    const count = read.data.filter(isThread).length;
    const written = await writeStore('chats', [], options);
    if (!written.ok) return written;

    return { ok: true, data: { count } };
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
    // Only the file path is kept, never the pixels, so chats.json stays small and
    // the image is read from disk again each time the thread is sent.
    const images = (Array.isArray(message.images) ? message.images : [])
      .filter((image) => typeof image?.path === 'string' && image.path !== '')
      .slice(0, 4)
      .map((image) => ({ name: String(image.name ?? ''), path: image.path }));
    // Files Zuri built for this reply (Word, Excel, PowerPoint) ride on the assistant
    // message so the download card is still there when the chat is reopened.
    const files = (Array.isArray(message.files) ? message.files : [])
      .filter((file) => typeof file?.path === 'string' && file.path !== '')
      .slice(0, 8)
      .map((file) => ({
        name: String(file.name ?? ''),
        path: file.path,
        kind: String(file.kind ?? ''),
        bytes: Number.isFinite(file.bytes) ? file.bytes : 0,
      }));
    const stored = {
      id: randomUUID(),
      role,
      content,
      createdAt: now,
      ...(mode ? { mode } : {}),
      ...(role === 'user' && images.length > 0 ? { images } : {}),
      ...(role === 'assistant' && files.length > 0 ? { files } : {}),
    };
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

/* ---------------------------------------------------------------------------
   Reminders

   reminders.json holds one entry per reminder: what to nudge about, when it next
   fires, and how it repeats. `dueAt` is the entire schedule - the tick in
   reminders.js only compares it with the clock - so a reminder that can still
   fire carries one, and a finished one carries null.

   A reminder is `{ id, title, repeat: 'once' | 'interval' | 'daily', dueAt,
   intervalMinutes, timeOfDay, status: 'pending' | 'done', lastFiredAt, createdAt,
   updatedAt, completedAt }`. Only the field the repeat rule names is filled:
   interval keeps `intervalMinutes`, daily keeps `timeOfDay`, once keeps neither,
   so a row cannot read back a rule it is not on.
   ------------------------------------------------------------------------- */

/** Gap used for an interval reminder the caller gave no usable gap for. */
export const REMINDER_INTERVAL_DEFAULT_MINUTES = 60;
/** The repeat rules the Reminders page offers, in the order it lists them. */
export const REMINDER_REPEATS = Object.freeze(['once', 'interval', 'daily']);
export const REMINDER_TITLE_MAX_LENGTH = 200;

/**
 * Serialises reminder writes. A save from the view and a fire from the ten-second
 * tick are both read-modify-write on one file: without this the second would read
 * the list the first is about to replace and drop the change.
 * @type {Promise<void>}
 */
let remindersChain = Promise.resolve();

/**
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
function withRemindersLock(task) {
  const result = remindersChain.then(task, task);
  remindersChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normaliseReminderTitle(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, REMINDER_TITLE_MAX_LENGTH);
}

/**
 * Minutes past midnight for an "HH:MM" string. reminders.js uses the same reader
 * to work out when a daily reminder next fires, so the two agree on what the
 * stored time means.
 * @param {unknown} value
 * @returns {number|null} null when the value is not a 24-hour clock time.
 */
export function parseTimeOfDay(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * @param {number} minutes Minutes past midnight.
 * @returns {string} The same moment as "HH:MM".
 */
function formatTimeOfDay(minutes) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const rest = String(minutes % 60).padStart(2, '0');
  return `${hours}:${rest}`;
}

/**
 * @param {unknown} value
 * @returns {number} Whole minutes, at least one.
 */
function normaliseReminderInterval(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 1) return REMINDER_INTERVAL_DEFAULT_MINUTES;
  return Math.floor(minutes);
}

/**
 * @param {Date} date
 * @returns {string} The wall clock of `date`, local time, as "HH:MM".
 */
function clockOf(date) {
  return formatTimeOfDay(date.getHours() * 60 + date.getMinutes());
}

/**
 * @param {unknown} value
 * @returns {string|undefined} 'once' when nothing was named; undefined when the
 *   value is not one of REMINDER_REPEATS.
 */
function normaliseReminderRepeat(value) {
  if (value === undefined || value === null || value === '') return 'once';
  const candidate = String(value).toLowerCase();
  return REMINDER_REPEATS.includes(candidate) ? candidate : undefined;
}

/**
 * @param {unknown} value
 * @returns {string|null|undefined} null means "no fire time", undefined means
 *   "not a date".
 */
function normaliseReminderDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/**
 * A stored entry is only a reminder if it can name itself; anything else in the
 * file (a hand edit, an older shape) is skipped rather than crashing the list.
 * @param {unknown} value
 * @returns {boolean}
 */
function isReminderEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string'
  );
}

/**
 * Pending before done, then the soonest fire first. A reminder with no `dueAt`
 * has nothing left to fire, so it sorts last whatever its status says.
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareReminders(left, right) {
  const leftDone = left.status === 'done' ? 1 : 0;
  const rightDone = right.status === 'done' ? 1 : 0;
  if (leftDone !== rightDone) return leftDone - rightDone;

  const leftDue = typeof left.dueAt === 'string' ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
  const rightDue = typeof right.dueAt === 'string' ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;

  return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
}

/**
 * The reminders still to come, soonest first. A done reminder is history, so it
 * is not in this list: the Reminders page and the right-hand rail both draw what
 * is left to fire.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listReminders(options = {}) {
  const read = await readStore('reminders', options);
  if (!read.ok) return read;
  return {
    ok: true,
    data: read.data
      .filter(isReminderEntry)
      .filter((reminder) => reminder.status !== 'done')
      .sort(compareReminders),
  };
}

/**
 * Add one reminder and return it. The id, the timestamps and `status: 'pending'`
 * are set here, so a renderer cannot invent a reminder the tick would then skip.
 * @param {{ title?: unknown, repeat?: unknown, dueAt?: unknown, intervalMinutes?: unknown, timeOfDay?: unknown }} input
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function createReminder(input, options = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return failure('REMINDER_INVALID_INPUT', 'Saving a reminder expects the fields to save.');
  }

  const title = normaliseReminderTitle(input.title);
  if (title === '') {
    return failure('REMINDER_TITLE_REQUIRED', 'A reminder needs a title before it can be saved.');
  }

  const repeat = normaliseReminderRepeat(input.repeat);
  if (repeat === undefined) {
    return failure('REMINDER_INVALID_REPEAT', `The repeat must be one of ${REMINDER_REPEATS.join(', ')}.`);
  }

  const due = normaliseReminderDue(input.dueAt);
  if (due === undefined) {
    return failure('REMINDER_INVALID_DUE', 'The reminder needs a date and time, or none at all.');
  }
  // Every rule fires from a moment and the tick only compares that moment with the
  // clock, so a reminder with no dueAt could never fire and never be listed.
  if (due === null) {
    return failure('REMINDER_INVALID_DUE', 'Pick a date and time for the reminder.');
  }

  const intervalMinutes = repeat === 'interval' ? normaliseReminderInterval(input.intervalMinutes) : null;

  let timeOfDay = null;
  if (repeat === 'daily') {
    const named = typeof input.timeOfDay === 'string' && input.timeOfDay.trim() !== '';
    const minutes = parseTimeOfDay(input.timeOfDay);
    if (named && minutes === null) {
      return failure('REMINDER_INVALID_TIME', 'The daily time must be a 24-hour time such as 09:30.');
    }
    // The first fire time is the wall clock the reminder repeats at, so a daily
    // reminder saved without a time repeats at the time it was given.
    timeOfDay = minutes === null ? clockOf(new Date(due)) : formatTimeOfDay(minutes);
  }

  const now = new Date().toISOString();

  return withRemindersLock(async () => {
    const read = await readStore('reminders', options);
    if (!read.ok) return read;

    const reminder = {
      id: randomUUID(),
      title,
      repeat,
      dueAt: due,
      intervalMinutes,
      timeOfDay,
      status: 'pending',
      lastFiredAt: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const next = [...read.data.filter(isReminderEntry), reminder].sort(compareReminders);
    const written = await writeStore('reminders', next, options);
    if (!written.ok) return written;

    return { ok: true, data: reminder };
  });
}

/**
 * Mark one reminder done. A done reminder has no next fire, so clearing `dueAt`
 * is what keeps the tick from picking it up again.
 * @param {string} reminderId
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function completeReminder(reminderId, options = {}) {
  if (typeof reminderId !== 'string' || reminderId === '') {
    return failure('REMINDER_INVALID_ID', 'Which reminder to mark done was not given.');
  }

  return withRemindersLock(async () => {
    const read = await readStore('reminders', options);
    if (!read.ok) return read;

    const reminders = read.data.filter(isReminderEntry);
    const index = reminders.findIndex((reminder) => reminder.id === reminderId);
    if (index === -1) {
      return failure('REMINDER_NOT_FOUND', 'That reminder is no longer in reminders.json. Reload the list.');
    }

    const now = new Date().toISOString();
    const next = {
      ...reminders[index],
      status: 'done',
      dueAt: null,
      completedAt: now,
      updatedAt: now,
    };
    reminders[index] = next;

    const written = await writeStore('reminders', [...reminders].sort(compareReminders), options);
    if (!written.ok) return written;

    return { ok: true, data: next };
  });
}

/**
 * Record that a reminder fired and move it to its next fire. `dueAt: null` means
 * the rule has no next fire, which is how a one-off leaves the pending list.
 * @param {string} reminderId
 * @param {{ dueAt?: unknown, firedAt?: unknown }} patch
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function recordReminderFire(reminderId, patch = {}, options = {}) {
  if (typeof reminderId !== 'string' || reminderId === '') {
    return failure('REMINDER_INVALID_ID', 'Which reminder fired was not given.');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return failure('REMINDER_INVALID_PATCH', 'Recording a reminder fire expects an object of the fields to change.');
  }

  const due = normaliseReminderDue(patch.dueAt);
  if (due === undefined) {
    return failure('REMINDER_INVALID_DUE', 'The next fire time must be a date, or empty for a reminder that is finished.');
  }
  const fired = normaliseReminderDue(patch.firedAt);
  if (fired === undefined) {
    return failure('REMINDER_INVALID_FIRED_AT', 'The moment the reminder fired must be a date.');
  }

  return withRemindersLock(async () => {
    const read = await readStore('reminders', options);
    if (!read.ok) return read;

    const reminders = read.data.filter(isReminderEntry);
    const index = reminders.findIndex((reminder) => reminder.id === reminderId);
    if (index === -1) {
      return failure('REMINDER_NOT_FOUND', 'That reminder is no longer in reminders.json.');
    }

    const firedAt = fired ?? new Date().toISOString();
    const next = { ...reminders[index], dueAt: due, lastFiredAt: firedAt, updatedAt: firedAt };
    if (due === null) {
      next.status = 'done';
      next.completedAt = firedAt;
    }

    reminders[index] = next;
    const written = await writeStore('reminders', [...reminders].sort(compareReminders), options);
    if (!written.ok) return written;

    return { ok: true, data: next };
  });
}

/* ---------------------------------------------------------------------------
   Automations

   schedules.json holds one entry per automation: `{ id, prompt, mode, cadence,
   agentId, allowedTools, lastRunAt }` plus the scheduling bookkeeping the tick
   reads (`enabled`, `nextRunAt`) and the two timestamps. `cadence` is the rule and
   is one of `{ type: 'once', at }`, `{ type: 'interval', minutes }` or
   `{ type: 'daily', timeOfDay }`. `nextRunAt` is that same rule as a moment, kept
   in the file so a run missed while Zuri was closed can be replayed on launch
   (scheduler.js only compares `nextRunAt` with the clock).
   ------------------------------------------------------------------------- */

export const AUTOMATION_MODES = Object.freeze(['ask', 'act', 'autopilot']);
export const AUTOMATION_CADENCE_TYPES = Object.freeze(['once', 'interval', 'daily']);
export const AUTOMATION_PROMPT_MAX_LENGTH = 2000;

/**
 * Serialises schedule writes. Create, edit and delete are each a read-modify-write
 * of the same file, and two of them in one tick would otherwise lose an entry.
 * @type {Promise<void>}
 */
let schedulesChain = Promise.resolve();

/**
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
function withSchedulesLock(task) {
  const result = schedulesChain.then(task, task);
  schedulesChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * @param {unknown} value
 * @returns {string} The prompt without its surrounding whitespace, capped to what
 *   the chat view can hold comfortably.
 */
export function normaliseAutomationPrompt(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, AUTOMATION_PROMPT_MAX_LENGTH);
}

/**
 * @param {unknown} value
 * @returns {string|undefined} 'ask' when nothing was named, because an automation
 *   that only reads is the safe default; undefined when the mode is not one of
 *   AUTOMATION_MODES.
 */
function normaliseAutomationMode(value) {
  if (value === undefined || value === null || value === '') return 'ask';
  const candidate = String(value).toLowerCase();
  return AUTOMATION_MODES.includes(candidate) ? candidate : undefined;
}

/**
 * @param {unknown} value
 * @returns {string} An agent id, or '' for "whoever is active".
 */
function normaliseAutomationAgentId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The allow-list as stored: names only, no repeats, order kept so the same pick
 * reads the same way twice.
 * @param {unknown} value
 * @returns {string[]}
 */
function normaliseAutomationTools(value) {
  if (!Array.isArray(value)) return [];
  const names = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    if (name !== '') names.add(name);
  }
  return [...names];
}

/**
 * @param {unknown} value
 * @returns {string|null} An ISO moment, or null when the value is not a date.
 */
function normaliseAutomationAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * The cadence exactly as schedules.json stores it.
 *
 * The reader is strict rather than forgiving: a cadence the tick cannot read would
 * be stored forever and never fire, so a bad one is refused while the person is
 * still looking at the form.
 * @param {unknown} value
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
export function normaliseAutomationCadence(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'A schedule needs a cadence: once, every few minutes, or daily.' };
  }

  const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : '';
  if (!AUTOMATION_CADENCE_TYPES.includes(type)) {
    return { ok: false, error: `The cadence must be one of ${AUTOMATION_CADENCE_TYPES.join(', ')}.` };
  }

  if (type === 'once') {
    const at = normaliseAutomationAt(value.at);
    if (at === null) {
      return { ok: false, error: 'A one-off automation needs the date and time it runs.' };
    }
    return { ok: true, data: { type, at } };
  }

  if (type === 'interval') {
    const minutes = Number(value.minutes);
    if (!Number.isFinite(minutes) || minutes < 1) {
      return { ok: false, error: 'The gap between runs must be at least one minute.' };
    }
    return { ok: true, data: { type, minutes: Math.floor(minutes) } };
  }

  const clock = parseTimeOfDay(value.timeOfDay);
  if (clock === null) {
    return { ok: false, error: 'The daily time must be a 24-hour time such as 09:30.' };
  }
  return { ok: true, data: { type, timeOfDay: formatTimeOfDay(clock) } };
}

/**
 * The moment a cadence next comes round, in local time.
 *
 * `once` keeps its own moment; `interval` counts from the clock the caller hands
 * in (so an edit or a finished run can move it forward); `daily` is today's time
 * of day if that has not passed yet, otherwise tomorrow's.
 * @param {{ type: string, at?: string, minutes?: number, timeOfDay?: string }} cadence
 * @param {number} [from] Clock in milliseconds.
 * @returns {string|null} An ISO moment, or null when the cadence cannot be read.
 */
export function nextRunAtFor(cadence, from = Date.now()) {
  if (cadence === null || typeof cadence !== 'object') return null;
  if (!Number.isFinite(from)) return null;

  if (cadence.type === 'once') {
    return normaliseAutomationAt(cadence.at);
  }

  if (cadence.type === 'interval') {
    const minutes = Number(cadence.minutes);
    if (!Number.isFinite(minutes) || minutes < 1) return null;
    return new Date(from + Math.floor(minutes) * 60_000).toISOString();
  }

  if (cadence.type === 'daily') {
    const clock = parseTimeOfDay(cadence.timeOfDay);
    if (clock === null) return null;
    const now = new Date(from);
    const next = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Math.floor(clock / 60),
      clock % 60,
      0,
      0,
    );
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  return null;
}

/**
 * A stored entry is only an automation if it can name itself and state its rule;
 * anything else in the file is skipped rather than crashing the list.
 * @param {unknown} value
 * @returns {boolean}
 */
function isAutomationEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.prompt === 'string' &&
    value.cadence !== null &&
    typeof value.cadence === 'object'
  );
}

/**
 * Soonest run first, paused ones last: the automations page is a schedule, not an
 * archive, so what fires next is what the person needs at the top.
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareAutomations(left, right) {
  const leftPaused = left.enabled === false ? 1 : 0;
  const rightPaused = right.enabled === false ? 1 : 0;
  if (leftPaused !== rightPaused) return leftPaused - rightPaused;

  const leftNext =
    typeof left.nextRunAt === 'string' ? Date.parse(left.nextRunAt) : Number.POSITIVE_INFINITY;
  const rightNext =
    typeof right.nextRunAt === 'string' ? Date.parse(right.nextRunAt) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(leftNext) && Number.isFinite(rightNext) && leftNext !== rightNext) {
    return leftNext - rightNext;
  }

  return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
}

/**
 * Every automation in schedules.json, in the order the page draws them.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listAutomations(options = {}) {
  const read = await readStore('schedules', options);
  if (!read.ok) return read;
  return {
    ok: true,
    data: read.data.filter(isAutomationEntry).sort(compareAutomations),
  };
}

/**
 * Add one automation and return it. The id, `lastRunAt: null` and `nextRunAt` are
 * set here rather than accepted from the caller, so a renderer cannot hand the
 * tick an automation it would then skip forever.
 * @param {{ prompt?: unknown, mode?: unknown, cadence?: unknown, agentId?: unknown, allowedTools?: unknown }} input
 * @param {{ root?: string, now?: number }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function createAutomation(input, options = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return failure('AUTOMATION_INVALID_INPUT', 'Saving an automation expects the fields to save.');
  }

  const prompt = normaliseAutomationPrompt(input.prompt);
  if (prompt === '') {
    return failure('AUTOMATION_PROMPT_REQUIRED', 'An automation needs a prompt to run.');
  }

  const mode = normaliseAutomationMode(input.mode);
  if (mode === undefined) {
    return failure(
      'AUTOMATION_INVALID_MODE',
      `The mode must be one of ${AUTOMATION_MODES.join(', ')}.`,
    );
  }

  const cadence = normaliseAutomationCadence(input.cadence);
  if (!cadence.ok) {
    return failure('AUTOMATION_INVALID_CADENCE', cadence.error);
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const nowIso = new Date(now).toISOString();
  const entry = {
    id: randomUUID(),
    prompt,
    mode,
    cadence: cadence.data,
    agentId: normaliseAutomationAgentId(input.agentId),
    allowedTools: normaliseAutomationTools(input.allowedTools),
    lastRunAt: null,
    enabled: true,
    // Kept alongside the rule so the tick only has to compare one moment with the
    // clock, and so a run missed while Zuri was closed is visible after a restart.
    nextRunAt: nextRunAtFor(cadence.data, now),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return withSchedulesLock(async () => {
    const read = await readStore('schedules', options);
    if (!read.ok) return read;

    const schedules = read.data.filter(isAutomationEntry);
    const written = await writeStore(
      'schedules',
      [...schedules, entry].sort(compareAutomations),
      options,
    );
    if (!written.ok) return written;

    return { ok: true, data: entry };
  });
}

/**
 * Change the named fields of one automation. Only the fields in `patch` change, so
 * the page can save a new prompt without resending the cadence, and the next run
 * moves only when the rule or the pause state does.
 * @param {string} automationId
 * @param {{ prompt?: unknown, mode?: unknown, cadence?: unknown, agentId?: unknown, allowedTools?: unknown, enabled?: unknown, lastRunAt?: unknown }} patch
 * @param {{ root?: string, now?: number }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function updateAutomation(automationId, patch = {}, options = {}) {
  if (typeof automationId !== 'string' || automationId === '') {
    return failure('AUTOMATION_INVALID_ID', 'Which automation to change was not given.');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return failure(
      'AUTOMATION_INVALID_PATCH',
      'Changing an automation expects an object of the fields to change.',
    );
  }

  const next = {};
  if (Object.hasOwn(patch, 'prompt')) {
    const prompt = normaliseAutomationPrompt(patch.prompt);
    if (prompt === '') {
      return failure('AUTOMATION_PROMPT_REQUIRED', 'An automation needs a prompt to run.');
    }
    next.prompt = prompt;
  }
  if (Object.hasOwn(patch, 'mode')) {
    const mode = normaliseAutomationMode(patch.mode);
    if (mode === undefined) {
      return failure(
        'AUTOMATION_INVALID_MODE',
        `The mode must be one of ${AUTOMATION_MODES.join(', ')}.`,
      );
    }
    next.mode = mode;
  }
  if (Object.hasOwn(patch, 'cadence')) {
    const cadence = normaliseAutomationCadence(patch.cadence);
    if (!cadence.ok) {
      return failure('AUTOMATION_INVALID_CADENCE', cadence.error);
    }
    next.cadence = cadence.data;
  }
  if (Object.hasOwn(patch, 'agentId')) {
    next.agentId = normaliseAutomationAgentId(patch.agentId);
  }
  if (Object.hasOwn(patch, 'allowedTools')) {
    next.allowedTools = normaliseAutomationTools(patch.allowedTools);
  }
  if (Object.hasOwn(patch, 'enabled')) {
    next.enabled = patch.enabled !== false;
  }
  if (Object.hasOwn(patch, 'lastRunAt')) {
    const lastRunAt = normaliseAutomationAt(patch.lastRunAt);
    if (lastRunAt === null && patch.lastRunAt !== null) {
      return failure('AUTOMATION_INVALID_LAST_RUN', 'The last run must be a date, or empty.');
    }
    next.lastRunAt = lastRunAt;
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();

  return withSchedulesLock(async () => {
    const read = await readStore('schedules', options);
    if (!read.ok) return read;

    const schedules = read.data.filter(isAutomationEntry);
    const index = schedules.findIndex((schedule) => schedule.id === automationId);
    if (index === -1) {
      return failure('AUTOMATION_NOT_FOUND', 'That automation is no longer in schedules.json.');
    }

    const current = schedules[index];
    const updated = { ...current, ...next, updatedAt: new Date(now).toISOString() };
    // The tick fires on `nextRunAt` alone, so it is recomputed whenever the rule or
    // the pause state changes: a paused automation keeps its moment, and resuming
    // picks the next one up from now rather than replaying the whole pause.
    if (Object.hasOwn(next, 'cadence') || (Object.hasOwn(next, 'enabled') && updated.enabled)) {
      updated.nextRunAt = nextRunAtFor(updated.cadence, now);
    }

    schedules[index] = updated;
    const written = await writeStore('schedules', [...schedules].sort(compareAutomations), options);
    if (!written.ok) return written;

    return { ok: true, data: updated };
  });
}

/**
 * Remove one automation from schedules.json.
 * @param {string} automationId
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { id: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function deleteAutomation(automationId, options = {}) {
  if (typeof automationId !== 'string' || automationId === '') {
    return failure('AUTOMATION_INVALID_ID', 'Which automation to delete was not given.');
  }

  return withSchedulesLock(async () => {
    const read = await readStore('schedules', options);
    if (!read.ok) return read;

    const schedules = read.data.filter(isAutomationEntry);
    const remaining = schedules.filter((schedule) => schedule.id !== automationId);
    if (remaining.length === schedules.length) {
      return failure('AUTOMATION_NOT_FOUND', 'That automation is no longer in schedules.json.');
    }

    const written = await writeStore('schedules', remaining, options);
    if (!written.ok) return written;

    return { ok: true, data: { id: automationId } };
  });
}


/* ---------------------------------------------------------------------------
   Runs

   runs.json is the scheduler's log: one entry per automation that fired, written
   before the first step runs and updated when the last one finishes, so a crash
   mid-run leaves a `running` row rather than no trace of it. An entry is
   `{ id, automationId, title, mode, status, startedAt, finishedAt, stepsDone,
   stepsTotal, needsAttention, resultPath, error }`.

   The order is newest first: the run card in the Context panel reads the top of
   the file, and the runs page pages backwards from it.
   ------------------------------------------------------------------------- */

/** The three states a run can be in; `running` is the one written at the start. */
export const RUN_STATUSES = Object.freeze(['running', 'completed', 'failed']);

/** The log is capped so a minute-by-minute automation cannot grow it without end. */
export const RUNS_MAX_ENTRIES = 500;

/**
 * Serialises run writes. Start and finish are each a read-modify-write of the same
 * file, and two automations due on one tick would otherwise lose a row.
 * @type {Promise<void>}
 */
let runsChain = Promise.resolve();

/**
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
function withRunsLock(task) {
  const result = runsChain.then(task, task);
  runsChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * A stored row is only a run if it can name itself and say where it got to;
 * anything else in the file is skipped rather than crashing the list.
 * @param {unknown} value
 * @returns {boolean}
 */
function isRunEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.status === 'string'
  );
}

/**
 * Newest start first. Ties fall back to id so two runs starting in the same
 * millisecond keep a stable order across reads.
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareRuns(left, right) {
  const byStart = Date.parse(right.startedAt) - Date.parse(left.startedAt);
  if (Number.isFinite(byStart) && byStart !== 0) return byStart;
  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

/**
 * The run log, newest first.
 * @param {{ root?: string, limit?: number }} [options]
 * @returns {Promise<{ ok: true, data: object[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listRuns(options = {}) {
  const read = await readStore('runs', options);
  if (!read.ok) return read;

  const runs = read.data.filter(isRunEntry).sort(compareRuns);
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 0;
  return { ok: true, data: limit > 0 ? runs.slice(0, limit) : runs };
}

/**
 * Write the opening row of a run. The id, status and `finishedAt: null` are set
 * here rather than accepted from the caller, so a row on disk always reads as a
 * run that started and has not finished yet.
 * @param {{ automationId?: unknown, title?: unknown, mode?: unknown, stepsTotal?: unknown, startedAt?: unknown }} entry
 * @param {{ root?: string, now?: number, id?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function startRun(entry, options = {}) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return failure('RUN_INVALID_INPUT', 'Starting a run expects the run fields.');
  }

  const startedAt = normaliseAutomationAt(entry.startedAt) ?? new Date(Date.now()).toISOString();
  const run = {
    id: typeof options.id === 'string' && options.id !== '' ? options.id : randomUUID(),
    automationId: typeof entry.automationId === 'string' ? entry.automationId : null,
    title: typeof entry.title === 'string' ? entry.title.slice(0, AUTOMATION_PROMPT_MAX_LENGTH) : '',
    mode: typeof entry.mode === 'string' ? entry.mode : 'autopilot',
    status: 'running',
    startedAt,
    finishedAt: null,
    stepsDone: 0,
    stepsTotal: Number.isFinite(Number(entry.stepsTotal)) ? Math.max(0, Math.floor(Number(entry.stepsTotal))) : 0,
    needsAttention: false,
    resultPath: null,
    error: null,
  };

  return withRunsLock(async () => {
    const read = await readStore('runs', options);
    if (!read.ok) return read;

    const next = [...read.data.filter(isRunEntry), run].sort(compareRuns).slice(0, RUNS_MAX_ENTRIES);
    const written = await writeStore('runs', next, options);
    if (!written.ok) return written;

    return { ok: true, data: run };
  });
}

/**
 * Close a run: set its status, end time and how far it got. Only the fields in
 * `patch` change, and `finishedAt` is stamped here so the caller cannot leave a
 * `completed` row without an end time.
 * @param {string} runId
 * @param {{ status?: unknown, stepsDone?: unknown, needsAttention?: unknown, resultPath?: unknown, error?: unknown, finishedAt?: unknown }} patch
 * @param {{ root?: string, now?: number }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function finishRun(runId, patch = {}, options = {}) {
  if (typeof runId !== 'string' || runId === '') {
    return failure('RUN_INVALID_ID', 'Which run to close was not given.');
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return failure('RUN_INVALID_PATCH', 'Closing a run expects an object of the fields to change.');
  }

  const status = typeof patch.status === 'string' ? patch.status : undefined;
  if (status !== undefined && !RUN_STATUSES.includes(status)) {
    return failure('RUN_INVALID_STATUS', `A run status must be one of ${RUN_STATUSES.join(', ')}.`);
  }

  const now = Number.isFinite(options.now) ? options.now : Date.now();

  return withRunsLock(async () => {
    const read = await readStore('runs', options);
    if (!read.ok) return read;

    const runs = read.data.filter(isRunEntry);
    const index = runs.findIndex((run) => run.id === runId);
    if (index === -1) {
      return failure('RUN_NOT_FOUND', 'That run is no longer in runs.json.');
    }

    const updated = {
      ...runs[index],
      ...(status === undefined ? {} : { status }),
      ...(Number.isFinite(Number(patch.stepsDone)) ? { stepsDone: Math.max(0, Math.floor(Number(patch.stepsDone))) } : {}),
      ...(typeof patch.needsAttention === 'boolean' ? { needsAttention: patch.needsAttention } : {}),
      ...(typeof patch.resultPath === 'string' ? { resultPath: patch.resultPath } : {}),
      ...(patch.error === null || typeof patch.error === 'string' ? { error: patch.error } : {}),
      // An explicit end time is honoured so a run is stamped with the clock the
      // tick started from; otherwise the log records the moment of this write.
      finishedAt: normaliseAutomationAt(patch.finishedAt) ?? new Date(now).toISOString(),
    };

    runs[index] = updated;
    const written = await writeStore('runs', [...runs].sort(compareRuns), options);
    if (!written.ok) return written;

    return { ok: true, data: updated };
  });
}

/* ---------------------------------------------------------------------------
   Notifications

   notifications.json is the bell's history: one entry per reminder that fired.
   `read` is what the unread count counts, so the file keeps every entry and the
   badge stays a filter over them rather than a counter that has to be kept in
   step with the list. An entry is `{ id, reminderId, title, body, read,
   createdAt }`.
   ------------------------------------------------------------------------- */

export const NOTIFICATION_TITLE_MAX_LENGTH = 120;
export const NOTIFICATION_BODY_MAX_LENGTH = 500;

/**
 * Serialises notification writes. The tick records one entry per due reminder in
 * a loop, and each one is a read-modify-write of the same file.
 * @type {Promise<void>}
 */
let notificationsChain = Promise.resolve();

/**
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
function withNotificationsLock(task) {
  const result = notificationsChain.then(task, task);
  notificationsChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNotificationEntry(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string'
  );
}

/**
 * Newest first, with ISO strings compared directly. The id breaks a tie, so two
 * reminders that fired in the same millisecond still have a stable order.
 * @param {{ createdAt?: string, id?: string }} left
 * @param {{ createdAt?: string, id?: string }} right
 * @returns {number}
 */
function compareNotifications(left, right) {
  const byNewest = String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
  if (byNewest !== 0) return byNewest;
  return String(right.id ?? '').localeCompare(String(left.id ?? ''));
}

/**
 * Add one notification and return it. `read: false` is set here, so the entry the
 * tick raises is the entry the badge counts.
 * @param {{ reminderId?: unknown, title?: unknown, body?: unknown }} entry
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function appendNotification(entry, options = {}) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return failure('NOTIFICATION_INVALID_INPUT', 'Recording a notification expects a title and a body.');
  }

  const body = typeof entry.body === 'string' ? entry.body.trim().slice(0, NOTIFICATION_BODY_MAX_LENGTH) : '';
  if (body === '') {
    return failure('NOTIFICATION_BODY_REQUIRED', 'A notification needs something to say.');
  }

  const title =
    typeof entry.title === 'string' && entry.title.trim() !== ''
      ? entry.title.trim().slice(0, NOTIFICATION_TITLE_MAX_LENGTH)
      : 'Zuri';

  return withNotificationsLock(async () => {
    const read = await readStore('notifications', options);
    if (!read.ok) return read;

    const notification = {
      id: randomUUID(),
      reminderId: typeof entry.reminderId === 'string' && entry.reminderId !== '' ? entry.reminderId : null,
      title,
      body,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const written = await writeStore(
      'notifications',
      [...read.data.filter(isNotificationEntry), notification],
      options,
    );
    if (!written.ok) return written;

    return { ok: true, data: notification };
  });
}

/**
 * The bell's history, newest first, with the unread count beside it. `limit` caps
 * the list only: the count is taken before it is applied, so a caller asking for
 * one row cannot understate the badge.
 * @param {{ root?: string, limit?: number }} [options]
 * @returns {Promise<{ ok: true, data: { items: object[], unread: number } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function listNotifications(options = {}) {
  const read = await readStore('notifications', options);
  if (!read.ok) return read;

  const entries = read.data.filter(isNotificationEntry);
  const unread = entries.filter((entry) => entry.read !== true).length;
  const newestFirst = [...entries].sort(compareNotifications);
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.trunc(options.limit)) : null;

  return {
    ok: true,
    data: { items: limit === null ? newestFirst : newestFirst.slice(0, limit), unread },
  };
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
