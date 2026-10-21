import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CHAT_STREAM_CHANNEL, sendChatMessage, summarizeText } from './providers/chat.js';
import { formatSummaryMarkdown, summaryFileName } from './documents.js';
import { runOnboardingSetup } from './onboarding.js';
import { clearKey, keyStatus, setKey } from './secrets.js';
import {
  appendMessage,
  createTask,
  createThread,
  deleteTask,
  getStoreRoot,
  listTasks,
  listThreads,
  readSettings,
  saveSettings,
  updateTask,
} from './store.js';
import { ensureWorkspace, listWorkspaceFiles, resolveWorkspaceFile, runTool } from './tools/index.js';

// ESM main process (package.json sets "type": "module"), so __dirname is built here.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_ENTRY = path.join(moduleDir, '..', 'renderer', 'index.html');
const PRELOAD_ENTRY = path.join(moduleDir, 'preload.js');
// The window and taskbar icon. Electron cannot read an SVG here, so this is the PNG
// rasterised from renderer/assets/zuri-logo.svg by scripts/make-icon.js, which keeps
// the icon and the logo in the app one drawing rather than two that can drift.
export const ICON_ENTRY = path.join(moduleDir, 'assets', 'zuri-icon.png');
const CANVAS_DARK = '#0B0B0F'; // matches --zuri-bg-canvas dark, so the window does not flash white before first paint

/**
 * Abort handles for replies in flight, keyed by thread. Stop (node 0:944) is the
 * only writer, and a thread has at most one reply on its way at a time.
 * @type {Map<string, AbortController>}
 */
const activeReplies = new Map();

// Pin the name before anything reads userData. A script launched as
// `electron scripts/x.js` would otherwise resolve userData to AppData/Roaming/Electron,
// which is not where the shipped app keeps its data.
app.setName('Zuri');

/**
 * Create the single main window and load the renderer entry.
 * contextIsolation on, nodeIntegration off and sandbox on are load-bearing: the
 * renderer only ever reaches the main process through the preload bridge.
 * @returns {BrowserWindow}
 */
function createMainWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    title: 'Zuri',
    // Without this the window and the taskbar show Electron's own logo.
    icon: ICON_ENTRY,
    backgroundColor: CANVAS_DARK,
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.ZURI_DEVTOOLS === '1',
    },
  });

  window.loadFile(RENDERER_ENTRY);
  return window;
}

/**
 * What main answers, keyed by channel. Together with CHANNELS in preload.js this
 * is one contract in two processes; scripts/selftest.js asserts the lists match.
 * @type {ReadonlyMap<string, Function>}
 */
const HANDLERS = new Map([
  ['zuri:app:info', handleAppInfo],
  ['zuri:app:channels', handleChannelList],
  ['zuri:chats:list', handleChatList],
  ['zuri:chats:create', handleChatCreate],
  ['zuri:chats:append-message', handleChatAppendMessage],
  ['zuri:chat:send', handleChatSend],
  ['zuri:chat:stop', handleChatStop],
  ['zuri:settings:get', handleSettingsGet],
  ['zuri:settings:save', handleSettingsSave],
  ['zuri:settings:setKey', handleSettingsSetKey],
  ['zuri:settings:clearKey', handleSettingsClearKey],
  ['zuri:onboarding:complete', handleOnboardingComplete],
  ['zuri:settings:keyStatus', handleSettingsKeyStatus],
  ['zuri:settings:open-data-folder', handleSettingsOpenDataFolder],
  ['zuri:tasks:list', handleTasksList],
  ['zuri:tasks:create', handleTasksCreate],
  ['zuri:tasks:update', handleTasksUpdate],
  ['zuri:tasks:delete', handleTasksDelete],
  ['zuri:files:list', handleFilesList],
  ['zuri:files:open', handleFilesOpen],
  ['zuri:files:reveal', handleFilesReveal],
  ['zuri:files:choose', handleFilesChoose],
  ['zuri:files:summarize', handleFilesSummarize],
]);

/**
 * Identity and paths a view may show. Deliberately no secrets: the API key never
 * leaves src/main/secrets.js.
 * @returns {{ name: string, version: string, platform: string, userData: string, versions: Record<string, string> }}
 */
function handleAppInfo() {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  };
}

/**
 * The channels main actually answers. Diagnostics, and the check that the
 * bridge and the registrations agree.
 * @returns {string[]}
 */
function handleChannelList() {
  return [...HANDLERS.keys()];
}

/**
 * Every stored chat thread, newest first, so the sidebar can list them on launch.
 * @returns {Promise<object>}
 */
function handleChatList() {
  return listThreads();
}

/**
 * Create an empty thread. The title is optional: store.js names the thread from
 * its first user message when nothing else has.
 * @param {{ title?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleChatCreate(payload) {
  return createThread({ title: payload?.title });
}

/**
 * Append one message to a thread and return the updated thread plus the stored
 * message, so the renderer never has to guess the id or timestamp it was given.
 * @param {{ threadId?: string, message?: { role?: string, content?: string } }} [payload]
 * @returns {Promise<object>}
 */
function handleChatAppendMessage(payload) {
  return appendMessage(payload?.threadId, payload?.message);
}

/**
 * Every task in tasks.json, in the order the Tasks view draws them.
 * @returns {Promise<object>}
 */
function handleTasksList() {
  return listTasks();
}

/**
 * Save one task. The store sets the id, timestamps and done: false itself, so
 * the renderer only sends what the person typed.
 * @param {{ title?: string, notes?: string, due?: string|null, priority?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleTasksCreate(payload) {
  return createTask(payload ?? {});
}

/**
 * Change the fields the view names on one task, done included: ticking a task
 * off is an update, not a separate action. The id rides in the same object the
 * view already builds and is split off here so it cannot land in the patch.
 * @param {{ id?: string, title?: string, notes?: string, due?: string|null, priority?: string, done?: boolean }} [payload]
 * @returns {Promise<object>}
 */
function handleTasksUpdate(payload) {
  const { id, ...patch } = payload ?? {};
  return updateTask(id, patch);
}

/**
 * Remove one task and return what was removed, so the view can name it.
 * @param {{ id?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleTasksDelete(payload) {
  return deleteTask(payload?.id);
}

/**
 * Ask the provider for a reply and stream it back to the window that asked.
 *
 * Tokens go out on CHAT_STREAM_CHANNEL as they arrive, addressed to the sender only,
 * so a second window can never see another window's reply. The final answer holds
 * the thread with the reply already saved in chats.json.
 * @param {{ threadId?: string }} [payload]
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
function handleChatSend(payload, event) {
  const sender = event?.sender;
  const threadId = payload?.threadId;

  // One abort handle per thread, so Stop can end a reply the person no longer wants
  // without waiting for the provider to finish writing it.
  const controller = new AbortController();
  if (typeof threadId === 'string') activeReplies.set(threadId, controller);

  const settle = () => {
    if (typeof threadId !== 'string') return;
    // A newer request for the same thread owns the slot now; leave it alone.
    if (activeReplies.get(threadId) === controller) activeReplies.delete(threadId);
  };

  return sendChatMessage(threadId, {
    signal: controller.signal,
    emit: (streamEvent) => {
      // The window can close mid-stream; sending to a destroyed webContents throws.
      if (sender && !sender.isDestroyed()) sender.send(CHAT_STREAM_CHANNEL, streamEvent);
    },
  }).finally(settle);
}

/**
 * Stop the reply in flight for one thread (the shell's streaming row, node 0:944).
 *
 * Aborting the request means the provider's answer is never written to chats.json,
 * so nothing half-finished is left behind for the next window to read. Stopping a
 * thread with no reply in flight is not an error: the answer says nothing happened.
 * @param {{ threadId?: string }} [payload]
 * @returns {{ ok: boolean, data: { stopped: boolean } }}
 */
function handleChatStop(payload) {
  const threadId = payload?.threadId;
  const controller = typeof threadId === 'string' ? activeReplies.get(threadId) : null;
  if (!controller) return { ok: true, data: { stopped: false } };

  controller.abort();
  activeReplies.delete(threadId);
  return { ok: true, data: { stopped: true } };
}

/**
 * The settings object the renderer may read: name, theme, model and the Act
 * allow-lists. Provider keys are not settings and never appear here; they live in
 * secrets.js behind their own channels.
 * @returns {Promise<object>}
 */
function handleSettingsGet() {
  return readSettings();
}

/**
 * Merge a patch into settings.json. The renderer sends only the field it changed,
 * so a theme toggle cannot blank the model or the allow-lists.
 * @param {object} [payload]
 * @returns {Promise<object>}
 */
function handleSettingsSave(payload) {
  return saveSettings(payload ?? {});
}

/**
 * Finish first-run setup in one call: name, theme and provider key.
 * One channel rather than three saves, because the card treats setup as a single
 * step, and half of it (a name stored, no key) is a state it must report as an
 * error rather than leave behind silently.
 * @param {{ name?: string, theme?: string, provider?: string, key?: string, model?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleOnboardingComplete(payload) {
  return runOnboardingSetup(payload ?? {});
}

/**
 * Store one provider key. The key crosses the IPC boundary exactly once, in this
 * payload, and nothing sends it back: secrets.setKey answers with the provider and
 * a boolean, so the key cannot reach renderer state or a log line from here.
 * @param {{ provider?: string, key?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleSettingsSetKey(payload) {
  return setKey(payload?.provider, payload?.key);
}

/**
 * Forget a provider key, for the Settings view's Remove key button. Like setKey it
 * answers with a boolean, never with the key it just deleted.
 * @param {{ provider?: string }} [payload]
 * @returns {Promise<object>}
 */
function handleSettingsClearKey(payload) {
  return clearKey(payload?.provider);
}

/**
 * Whether a key is stored, for the Settings view's status line. The renderer
 * learns a boolean and nothing else.
 * @param {{ provider?: string }} [payload]
 * @returns {object}
 */
function handleSettingsKeyStatus(payload) {
  return keyStatus(payload?.provider);
}

/**
 * Open the local data folder in the OS file manager, for the Account view's
 * "Open folder". It hands back only the path it opened: the JSON files inside
 * (and secrets.json) stay in main.
 * @returns {Promise<object>}
 */
async function handleSettingsOpenDataFolder() {
  try {
    const folder = getStoreRoot();
    // The folder is created on first write, so a fresh install would otherwise
    // open nothing. Creating it here is what makes the button honest.
    await mkdir(folder, { recursive: true });
    const problem = await shell.openPath(folder);
    if (problem !== '') {
      return { ok: false, error: { code: 'SETTINGS_OPEN_FOLDER_FAILED', message: problem } };
    }
    return { ok: true, data: { path: folder } };
  } catch (error) {
    console.error('[zuri:settings] open-data-folder', error);
    return filesFailure(error, 'SETTINGS_OPEN_FOLDER_FAILED');
  }
}

/* ------------------------------------------------------------------- files */

/**
 * Turn a thrown workspace or file-system error into the failed-result shape the
 * Files view reports. Codes from tools/index.js (`TOOL_PATH_OUTSIDE_WORKSPACE`,
 * `TOOL_FILE_MISSING`) pass through so the view can tell a refusal from a crash.
 * @param {any} error
 * @param {string} code
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function filesFailure(error, code) {
  return {
    ok: false,
    error: { code: typeof error?.code === 'string' ? error.code : code, message: String(error?.message ?? error) },
  };
}

/**
 * Saved Act results, newest first, for the Files view. The workspace folder is
 * created on first run, so the first call answers with an empty list.
 * @returns {Promise<object>}
 */
async function handleFilesList() {
  try {
    return { ok: true, data: await listWorkspaceFiles() };
  } catch (error) {
    console.error('[zuri:files] list', error);
    return filesFailure(error, 'FILES_LIST_FAILED');
  }
}

/**
 * Open one workspace file in whatever app owns its type. `shell.openPath` answers
 * with an empty string on success and a message on failure, so that message is
 * what the view shows when Windows has no handler for the extension.
 * @param {{ path?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleFilesOpen(payload) {
  try {
    const target = await resolveWorkspaceFile(payload?.path);
    const problem = await shell.openPath(target);
    if (problem !== '') {
      return { ok: false, error: { code: 'FILES_OPEN_FAILED', message: problem } };
    }
    return { ok: true, data: { path: target } };
  } catch (error) {
    // A workspace guard refusal is an answer for the view, not a fault to log.
    if (!String(error?.code ?? '').startsWith('TOOL_')) console.error('[zuri:files] open', error);
    return filesFailure(error, 'FILES_OPEN_FAILED');
  }
}

/**
 * Show the file selected in File Explorer. The path is resolved through the same
 * workspace guard as open, so the view cannot ask Explorer to select something
 * outside the folder.
 * @param {{ path?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleFilesReveal(payload) {
  try {
    const target = await resolveWorkspaceFile(payload?.path);
    shell.showItemInFolder(target);
    return { ok: true, data: { path: target } };
  } catch (error) {
    if (!String(error?.code ?? '').startsWith('TOOL_')) console.error('[zuri:files] reveal', error);
    return filesFailure(error, 'FILES_REVEAL_FAILED');
  }
}

/**
 * Channel main pushes after it writes a workspace file. It is a one-way push, so
 * it stays out of the HANDLERS map and the preload CHANNELS list.
 */
const STATE_CHANGED_CHANNEL = 'state:changed';

/**
 * The native picker behind the Files view's Open action. Only the path is
 * returned; the renderer never gets the dialog's Electron object.
 * @param {unknown} _payload
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
async function handleFilesChoose(_payload, event) {
  const owner = BrowserWindow.fromWebContents(event?.sender) ?? BrowserWindow.getFocusedWindow();
  const options = {
    title: 'Summarize a document',
    buttonLabel: 'Summarize',
    properties: ['openFile'],
    filters: [
      {
        name: 'Documents',
        extensions: ['md', 'markdown', 'txt', 'csv', 'json', 'html', 'htm', 'log', 'docx', 'xlsx', 'pptx'],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  };

  try {
    const picked = owner === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(owner, options);
    const chosenPath = Array.isArray(picked.filePaths) ? picked.filePaths[0] : undefined;
    if (picked.canceled || typeof chosenPath !== 'string' || chosenPath === '') {
      return { ok: true, data: { cancelled: true } };
    }
    return { ok: true, data: { cancelled: false, path: chosenPath, name: path.basename(chosenPath) } };
  } catch (error) {
    console.error('[zuri:files] choose', error);
    return filesFailure(error, 'FILES_CHOOSE_FAILED');
  }
}

/**
 * The whole Summarize flow: read the chosen file, ask the provider for a summary,
 * save the Markdown in the workspace, then tell the Files view to re-list.
 *
 * The tool layer holds the guards (the workspace boundary on write, the file
 * size and extension checks on read); this handler only sequences the three
 * tools. writeFile is confirmed here because saving the result is the action the
 * person just chose, not a separate decision.
 * @param {{ path?: string, instruction?: string }} [payload]
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
async function handleFilesSummarize(payload, event) {
  if (typeof payload?.path !== 'string' || payload.path.trim() === '') {
    return { ok: false, error: { code: 'FILES_PATH_REQUIRED', message: 'Choose a document to summarize first.' } };
  }

  try {
    const read = await runTool('readFile', { path: payload.path });
    if (!read.ok) return read;

    const summary = await runTool(
      'summarizeDocument',
      {
        path: read.data.path,
        name: read.data.name,
        text: read.data.text,
        truncated: read.data.truncated,
        instruction: typeof payload.instruction === 'string' ? payload.instruction : '',
      },
      // The tool layer stays provider-free: main injects the one function that
      // reaches the chat provider, as it does for every other summarise caller.
      { dependencies: { summarize: summarizeText } },
    );
    if (!summary.ok) return summary;

    const content = formatSummaryMarkdown({
      sourceName: summary.data.name,
      sourcePath: summary.data.source,
      summary: summary.data.summary,
      model: String(summary.data.label ?? summary.data.model ?? ''),
      truncated: summary.data.truncated === true,
    });
    const saved = await runTool(
      'writeFile',
      { path: summaryFileName(summary.data.name), content },
      { confirmed: true },
    );
    if (!saved.ok) return saved;

    // A view that did not start this flow (Open was pressed elsewhere) still
    // needs to know the workspace changed; Files re-lists on this push.
    const sender = event?.sender;
    if (sender && sender.isDestroyed?.() !== true) {
      sender.send(STATE_CHANGED_CHANNEL, { area: 'files', path: saved.data.relative });
    }

    return {
      ok: true,
      data: {
        file: saved.data,
        path: saved.data.relative,
        name: path.basename(saved.data.relative),
        source: summary.data.source,
        sourceName: summary.data.name,
        summary: summary.data.summary,
        model: String(summary.data.label ?? summary.data.model ?? ''),
        truncated: summary.data.truncated === true,
      },
    };
  } catch (error) {
    console.error('[zuri:files] summarize', error);
    return filesFailure(error, 'FILES_SUMMARIZE_FAILED');
  }
}

/**
 * Register one handler. Only channels declared in HANDLERS may be registered,
 * and Electron itself rejects an invoke for any channel without a handler, so
 * an undeclared channel can never reach main-process code.
 * @param {string} channel
 * @param {Function} handler
 */
function registerChannel(channel, handler) {
  if (!HANDLERS.has(channel)) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }

  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(payload, event);
    } catch (error) {
      // Log the raw error here; the renderer gets the short version.
      console.error(`[zuri:ipc] ${channel}`, error);
      throw new Error(`${channel} failed: ${error.message}`);
    }
  });
}

/** Register every declared channel, before any window can call one. */
function registerIpc() {
  for (const [channel, handler] of HANDLERS) {
    registerChannel(channel, handler);
  }
}

app.whenReady().then(async () => {
  registerIpc();
  // First run: the folder exists before Act can write to it, and the Files view
  // can list an empty workspace instead of reporting a missing folder.
  try {
    await ensureWorkspace();
  } catch (error) {
    console.error('[zuri:workspace]', error);
  }
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// A failure in one task must not take the assistant down with it, so log and keep
// running. Notifications can only fire once the app is ready.
function reportUncaught(label, error) {
  console.error(`[zuri:${label}]`, error);
  if (!app.isReady()) return;
  try {
    new Notification({ title: 'Zuri hit an error', body: String(error?.message ?? error) }).show();
  } catch (notifyError) {
    console.error('[zuri:notify]', notifyError);
  }
}

process.on('uncaughtException', (error) => reportUncaught('uncaught', error));
process.on('unhandledRejection', (reason) => reportUncaught('rejection', reason));
