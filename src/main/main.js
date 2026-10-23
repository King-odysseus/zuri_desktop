import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, Tray } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CHAT_STREAM_CHANNEL, sendChatMessage, summarizeText } from './providers/chat.js';
import { formatSummaryMarkdown, summaryFileName } from './documents.js';
import { runOnboardingSetup } from './onboarding.js';
import {
  closeOverlay,
  hideOverlay,
  isOverlayOpen,
  openOverlay,
  setOverlayEnabled,
  startOverlayFromSettings,
} from './overlay.js';
import { startReminderTicker, stopReminderTicker } from './reminders.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import {
  TRAY_ITEM_IDS,
  TRAY_TOOLTIP,
  backgroundBalloon,
  balloonContent,
  earliestDueAt,
  trayMenuTemplate,
} from './tray-menu.js';
import { bringToFront } from './second-launch.js';
import { clearKey, keyStatus, setKey } from './secrets.js';
import {
  appendMessage,
  completeReminder,
  createAutomation,
  createReminder,
  createTask,
  createThread,
  deleteAutomation,
  deleteTask,
  getStoreRoot,
  listNotifications,
  listReminders,
  listTasks,
  listThreads,
  readSettings,
  readStore,
  saveSettings,
  updateAutomation,
  updateTask,
} from './store.js';
import { cancelToolStep, ensureWorkspace, listWorkspaceFiles, resolveWorkspaceFile, runTool, toolCatalogue } from './tools/index.js';

// ESM main process (package.json sets "type": "module"), so __dirname is built here.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// The React build is generated before tests and packaging. Keeping one entry here
// prevents the installed app from silently falling back to a retired renderer.
const RENDERER_ENTRY = path.join(moduleDir, '..', '..', 'dist-react', 'index.html');
const PRELOAD_ENTRY = path.join(moduleDir, 'preload.js');
// The window and taskbar icon. Electron cannot read an SVG here, so this is the PNG
// rasterised from renderer/assets/zuri-logo.svg by scripts/make-icon.js, which keeps
// the window and the logo in the app one drawing rather than two that can drift.
export const ICON_ENTRY = path.join(moduleDir, 'assets', 'zuri-icon.png');
// Windows draws the taskbar and Alt-Tab buttons from a real ICO and picks the frame
// that matches the size it is drawing; the PNG above stays the source the other
// platforms and the smoke check read. Both come from the same capture.
export const ICO_ENTRY = path.join(moduleDir, 'assets', 'zuri-icon.ico');
const CANVAS_DARK = '#0B0B0F'; // matches --zuri-bg-canvas dark, so the window does not flash white before first paint

/**
 * Abort handles for replies in flight, keyed by thread. Stop (node 0:944) is the
 * only writer, and a thread has at most one reply on its way at a time.
 * @type {Map<string, AbortController>}
 */
const activeReplies = new Map();

/**
 * The notification-area icon, or null when it could not be created. Created once the
 * app is ready, because a Tray cannot exist before then.
 * @type {Tray | null}
 */
let tray = null;

/**
 * True from the moment the person asks to quit. The window's close handler hides
 * the window instead of closing it, so quitting has to be able to say "for real".
 */
let quitting = false;

/** Whether the "running in the background" balloon has been shown this session. */
let balloonShown = false;

/**
 * What the tray reports: the rows follow the overlay, and the status line counts the
 * same unread reminders the bell does (set by the ten-second tick).
 * @type {{ overlayOpen: boolean, remindersDue: number }}
 */
const trayState = { overlayOpen: false, remindersDue: 0 };

// Pin the name before anything reads userData. A script launched as
// `electron scripts/x.js` would otherwise resolve userData to AppData/Roaming/Electron,
// which is not where the shipped app keeps its data.
app.setName('Zuri');

/** The id Windows groups this app's taskbar buttons under. */
const APP_USER_MODEL_ID = 'com.zuri.desktop';
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

/**
 * Give the app a taskbar identity that carries the Zuri mark.
 *
 * Windows draws a grouped taskbar button from the Start Menu shortcut registered
 * for the window's AppUserModelID, not from the window's own icon. Running from
 * source there is no such shortcut, so the id resolves to nothing and Windows
 * falls back to electron.exe: the Electron atom stays on the taskbar no matter what
 * the window draws. Refreshing the shortcut also repairs installs created before
 * the Zuri icon was configured.
 * @returns {void}
 */
function adoptTaskbarIdentity() {
  if (process.platform !== 'win32') return;
  if (app.isPackaged) return;

  // The shortcut must point at the app, so it is only written when this process
  // really is the app: a check script launched as `electron scripts/x.js` reports
  // that folder as its app path, and a shortcut to it would open nothing.
  const appRoot = path.join(moduleDir, '..', '..');
  if (path.resolve(app.getAppPath()) !== path.resolve(appRoot)) return;

  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Zuri.lnk');
  try {
    const operation = existsSync(link) ? 'update' : 'create';
    const written = shell.writeShortcutLink(link, operation, {
      target: process.execPath,
      args: `"${appRoot}"`,
      icon: ICO_ENTRY,
      iconIndex: 0,
      description: 'Zuri',
      appUserModelId: APP_USER_MODEL_ID,
    });
    if (!written) {
      console.warn("[zuri:taskbar] Windows refused the shortcut, so the taskbar keeps Electron's icon");
    }
  } catch (error) {
    // A read-only or redirected Start Menu must never stop the app from opening.
    console.warn('[zuri:taskbar]', error.message);
  }
}

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
    // Without this the window and Alt-Tab show Electron's own logo. Windows reads
    // an ICO here; the other platforms take the PNG.
    icon: process.platform === 'win32' ? ICO_ENTRY : ICON_ENTRY,
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

  // The icon is the way back in (0:13683), so closing the window hides Zuri instead
  // of ending the session: reminders and scheduled runs keep going while it is out of
  // sight. The Quit row of the tray menu, and quitting from anywhere else, sets
  // `quitting`, which is what lets this close through.
  window.on('close', (event) => {
    if (quitting === true || tray === null) return;
    event.preventDefault();
    window.hide();
    void showBackgroundBalloon();
  });

  // The overlay is a helper for the main window, not an app of its own. Letting it
  // outlive the main window would keep the process alive on `window-all-closed`, so
  // closing Zuri takes the floating card with it.
  window.on('closed', () => {
    closeOverlay();
  });

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
  ['zuri:automations:list', handleAutomationsList],
  ['zuri:automations:create', handleAutomationsCreate],
  ['zuri:automations:update', handleAutomationsUpdate],
  ['zuri:automations:delete', handleAutomationsDelete],
  ['zuri:reminders:list', handleRemindersList],
  ['zuri:reminders:create', handleRemindersCreate],
  ['zuri:reminders:complete', handleRemindersComplete],
  ['zuri:notifications:list', handleNotificationsList],
  ['zuri:files:list', handleFilesList],
  ['zuri:files:open', handleFilesOpen],
  ['zuri:files:reveal', handleFilesReveal],
  ['zuri:files:choose', handleFilesChoose],
  ['zuri:files:summarize', handleFilesSummarize],
  ['zuri:tools:list', handleToolsList],
  ['zuri:tools:run', handleToolsRun],
  ['zuri:tools:cancel', handleToolsCancel],
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
 * Every tool the app can run, so the agents page ticks boxes for tools that exist.
 * Names and labels only: the handlers stay in the main process.
 * @returns {{ ok: true, data: { name: string, label: string, description: string }[] }}
 */
function handleToolsList() {
  return { ok: true, data: toolCatalogue() };
}

/**
 * Run one Act step the renderer held back. The confirmed flag is the renderer's
 * Confirm press and the only thing that lets a destructive tool through: the tool
 * layer refuses one without it, so a stray call cannot write a file or start an
 * app on its own. The step id is what lets a run that arrives after its Cancel be
 * refused.
 * @param {{ id?: string, name?: string, args?: Record<string, any>, confirmed?: boolean }} [payload]
 * @returns {Promise<object>}
 */
function handleToolsRun(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (name === '') {
    return Promise.resolve({ ok: false, error: { code: 'TOOLS_NAME_REQUIRED', message: 'A step needs a tool name to run.' } });
  }
  const args = payload?.args && typeof payload.args === 'object' ? payload.args : {};
  return runTool(name, args, {
    confirmed: payload?.confirmed === true,
    stepId: typeof payload?.id === 'string' ? payload.id : '',
  });
}

/**
 * Stop one Act step. On a pending step this is what keeps it from ever running;
 * on a running one it records the id, so the run arriving late is refused.
 * @param {{ id?: string }} [payload]
 * @returns {object}
 */
function handleToolsCancel(payload) {
  return cancelToolStep(payload?.id);
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
 * Announce a task write so the Context panel and the Tasks page both re-read.
 * Main owns the store, so a handler is the only place that knows a write landed.
 * @param {{ ok?: boolean }} result The store's reply.
 * @returns {{ ok?: boolean }} The same reply, so a handler can still return it.
 */
function afterTaskWrite(result) {
  if (result?.ok === true) announceState({ area: 'tasks' });
  return result;
}

/**
 * Save one task. The store sets the id, timestamps and done: false itself, so
 * the renderer only sends what the person typed.
 * @param {{ title?: string, notes?: string, due?: string|null, priority?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleTasksCreate(payload) {
  return afterTaskWrite(await createTask(payload ?? {}));
}

/**
 * Change the fields the view names on one task, done included: ticking a task
 * off is an update, not a separate action. The id rides in the same object the
 * view already builds and is split off here so it cannot land in the patch.
 * @param {{ id?: string, title?: string, notes?: string, due?: string|null, priority?: string, done?: boolean }} [payload]
 * @returns {Promise<object>}
 */
async function handleTasksUpdate(payload) {
  const { id, ...patch } = payload ?? {};
  return afterTaskWrite(await updateTask(id, patch));
}

/**
 * Remove one task and return what was removed, so the view can name it.
 * @param {{ id?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleTasksDelete(payload) {
  return afterTaskWrite(await deleteTask(payload?.id));
}

/**
 * The automations the Context panel summarises: the stored schedules and the runs
 * already recorded, so its card can say what is next and how far a run in flight
 * has got. The scheduler owns the timer and the writing; this only reads.
 * @returns {Promise<{ ok: true, data: { automations: object[], runs: object[] } } | { ok: false, error: object }>}
 */
async function handleAutomationsList() {
  const schedules = await readStore('schedules');
  if (schedules.ok !== true) return schedules;

  const runs = await readStore('runs');
  if (runs.ok !== true) return runs;

  return {
    ok: true,
    data: {
      automations: Array.isArray(schedules.data) ? schedules.data : [],
      runs: Array.isArray(runs.data) ? runs.data : [],
    },
  }
}
/**
 * Tell every open window that the schedules changed. The page is the writer and
 * the Context panel is the reader, so a push is how the two stay on one list.
 * @param {object} result What the store answered.
 * @returns {object} The same answer, so a handler can return it unchanged.
 */
function afterAutomationWrite(result) {
  if (result?.ok === true) announceState({ area: 'automations' });
  return result;
}

/**
 * Save a new automation from the Automations page.
 * @param {object} [payload] prompt, mode, cadence, agentId and allowedTools.
 * @returns {Promise<object>}
 */
async function handleAutomationsCreate(payload) {
  return afterAutomationWrite(await createAutomation(payload));
}

/**
 * Save an edit to one automation. The id travels separately from the fields so a
 * payload without one cannot be read as a change to "the first schedule".
 * @param {{ id?: string } & object} [payload]
 * @returns {Promise<object>}
 */
async function handleAutomationsUpdate(payload) {
  const { id, ...patch } = payload ?? {};
  return afterAutomationWrite(await updateAutomation(id, patch));
}

/**
 * Remove one automation and answer with what went, so the view can name it.
 * @param {{ id?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleAutomationsDelete(payload) {
  return afterAutomationWrite(await deleteAutomation(payload?.id));
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
    // The composer sends the agent it has picked; without one the reply falls back to
    // settings.activeAgentId, which is the same id in the normal case.
    agentId: typeof payload?.agentId === 'string' ? payload.agentId : undefined,
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
async function handleSettingsSave(payload) {
  const saved = await saveSettings(payload ?? {});
  // The overlay toggle has to act now, not after a restart: launch and this save both
  // go through setOverlayEnabled(), so one flag turns into one window the same way
  // wherever it is changed.
  if (saved.ok === true && Object.hasOwn(payload ?? {}, 'overlayEnabled')) {
    try {
      setOverlayEnabled(saved.data?.overlayEnabled === true);
    } catch (error) {
      console.error('[zuri:overlay]', error);
    }
  }
  return saved;
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
 * A chosen file's size in bytes, for the attachment chip's "2.4 MB" column. A file
 * that cannot be measured is not a failed pick, so it comes back undefined and the
 * chip simply has no size to show.
 * @param {string} filePath
 * @returns {Promise<number | undefined>}
 */
async function measureFile(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile() ? stats.size : undefined;
  } catch (error) {
    console.warn('[zuri:files] size', error?.message ?? error);
    return undefined;
  }
}

/**
 * The native picker behind the Files view's Open action and behind the composer's
 * paperclip. Only the path, name and size are returned; the renderer never gets
 * the dialog's Electron object.
 * @param {{ purpose?: string }} [payload] 'attach' for the composer's dialog
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
async function handleFilesChoose(payload, event) {
  const owner = BrowserWindow.fromWebContents(event?.sender) ?? BrowserWindow.getFocusedWindow();
  // One picker, two jobs: the composer asks for a file to attach to a message, the
  // Files view for a document to summarize. The title and the filter list say which.
  const options = payload?.purpose === 'attach'
    ? {
        title: 'Attach a file',
        buttonLabel: 'Attach',
        properties: ['openFile'],
        filters: [
          { name: 'Documents and text', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
    : {
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
    return {
      ok: true,
      data: { cancelled: false, path: chosenPath, name: path.basename(chosenPath), size: await measureFile(chosenPath) },
    };
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

/* --------------------------------------------------------------- reminders */

/**
 * Tell every open window that the reminder list changed. The bell takes `unread`
 * from this payload rather than counting for itself, so the badge, the Reminders
 * page and the Context panel all read one number written by one process.
 * @param {number} unread
 * @returns {void}
 */
function announceReminders(unread) {
  const count = Number.isFinite(unread) ? unread : 0;
  announceState({ area: 'reminders', unread: count });
}

/**
 * Tell every open window that stored state changed. One listener in the renderer
 * serves every area, so a push is a reason to re-read rather than a diff.
 * @param {object} change What changed: `area` plus whatever that area's views need.
 * @returns {void}
 */
function announceState(change) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(STATE_CHANGED_CHANNEL, change);
  }
}

/**
 * Tell the renderer how many runs the launch catch-up replayed.
 *
 * The sweep starts while the page is still loading, and a push sent then would land
 * before the renderer's listener exists, so a window that is still loading gets the
 * push on `did-finish-load` instead. Nothing is sent when nothing was caught up: the
 * toast only ever appears for a launch that owed a run.
 * @param {{ caughtUp?: number }} report The scheduler's catch-up report.
 * @returns {void}
 */
function announceCatchUp(report) {
  const caughtUp = Number.isFinite(report?.caughtUp) ? report.caughtUp : 0;
  if (caughtUp <= 0) return;

  const change = { area: 'automations', caughtUp };
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        if (!window.isDestroyed()) window.webContents.send(STATE_CHANGED_CHANNEL, change);
      });
      continue;
    }
    window.webContents.send(STATE_CHANGED_CHANNEL, change);
  }
}

/**
 * Bring Zuri forward on the Reminders page. This is what the toast's "Open
 * reminders" button does (open-pencil 0:11015): the window is restored and focused,
 * and the push names the route so the column lands where the button pointed.
 * @returns {Promise<void>}
 */
async function showRemindersPage() {
  const candidates = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
  const window = candidates.find((candidate) => !candidate.webContents.getURL().includes('overlay=1')) ?? candidates[0];
  if (window === undefined) return;

  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();

  // The count travels with the route so the bell keeps the number it earned; a failed
  // read sends the route alone rather than clearing it.
  const push = { area: 'reminders', view: 'reminders' };
  const history = await listNotifications({ limit: 1 });
  if (history.ok === true) push.unread = history.data.unread;
  window.webContents.send(STATE_CHANGED_CHANNEL, push);
}

/**
 * Bring the main window back to the front. The tray's Open Zuri, its New chat and a
 * left-click on the icon all land here. The overlay is deliberately not a candidate:
 * it is a helper above other applications' windows, not the app's own screen.
 * @returns {BrowserWindow | null}
 */
function bringMainWindowForward() {
  const candidates = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
  const window = candidates.find((candidate) => !candidate.webContents.getURL().includes('overlay=1')) ?? null;
  if (window === null) return null;

  bringToFront(window);
  return window;
}

/**
 * The tray's Open Zuri row (0:13581): show the window and ask it for nothing.
 * @returns {void}
 */
function openZuriFromTray() {
  bringMainWindowForward();
}

/**
 * The tray's New chat row (0:13586). It does not create a thread in the main process:
 * the page's own New chat button is the single place a chat is started, so the tray
 * asks it to press that button rather than keeping a second copy of the behaviour.
 * @returns {void}
 */
function newChatFromTray() {
  const window = bringMainWindowForward();
  if (window === null) return;
  window.webContents.send(STATE_CHANGED_CHANNEL, { area: 'chats', view: 'chats', action: 'new-chat' });
}

/**
 * The tray's overlay row (0:13591, 0:13658): show the floating card or hide it, then
 * redraw the menu so the row names the action it will take next time.
 * @returns {void}
 */
function toggleOverlayFromTray() {
  if (isOverlayOpen()) hideOverlay();
  else openOverlay();
  refreshTray();
}

/**
 * The tray's Quit row (0:13598): end the session rather than hide the window.
 * @returns {void}
 */
function quitFromTray() {
  quitting = true;
  app.quit();
}

/**
 * The handler for each row that does something, keyed by the id tray-menu.js gives
 * it. A row the design draws but nothing answers is left out of the menu instead of
 * being drawn as a dead click.
 * @type {ReadonlyMap<string, Function>}
 */
const TRAY_HANDLERS = new Map([
  [TRAY_ITEM_IDS.open, openZuriFromTray],
  [TRAY_ITEM_IDS.newChat, newChatFromTray],
  [TRAY_ITEM_IDS.overlay, toggleOverlayFromTray],
  [TRAY_ITEM_IDS.quit, quitFromTray],
]);

/**
 * Rebuild the tray's menu from the state the app is in. Rebuilt rather than mutated,
 * so the overlay row and the status line always describe the app as it is now.
 * @returns {void}
 */
function refreshTray() {
  if (tray === null || tray.isDestroyed()) return;

  trayState.overlayOpen = isOverlayOpen();
  const template = trayMenuTemplate(trayState).map((item) => {
    const handler = TRAY_HANDLERS.get(item.id);
    return handler === undefined ? item : { ...item, click: handler };
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

/**
 * The balloon Windows shows once the window is hidden (0:13684). Shown once per
 * session: its job is to say where Zuri went the first time, not to interrupt every
 * time the window is closed.
 * @returns {Promise<void>}
 */
async function showBackgroundBalloon() {
  if (tray === null || tray.isDestroyed() || balloonShown) return;
  balloonShown = true;

  // A failed read costs the balloon its third line and nothing else, so it is not
  // worth holding the balloon back for.
  const pending = await listReminders();
  const balloon = backgroundBalloon({ nextReminderAt: pending.ok ? earliestDueAt(pending.data) : null });

  try {
    tray.displayBalloon({ title: balloon.title, content: balloonContent(balloon) });
  } catch (error) {
    console.error('[zuri:tray] balloon', error);
  }
}

/**
 * Put the icon in the notification area. A tray that cannot be created is logged and
 * left null, and closing the window then quits as it always did, so a missing icon
 * can never leave a hidden window with no way back to it.
 * @returns {void}
 */
function createTray() {
  try {
    // Windows reads the ICO, which holds the small frames the notification area
    // draws; the other platforms take the PNG.
    tray = new Tray(process.platform === 'win32' ? ICO_ENTRY : ICON_ENTRY);
  } catch (error) {
    console.error('[zuri:tray] icon', error);
    tray = null;
    return;
  }

  tray.setToolTip(TRAY_TOOLTIP);
  // Left-click brings the window back, which is what the design tells people to do
  // (0:13568). The right-click menu is set by refreshTray below.
  tray.on('click', openZuriFromTray);
  refreshTray();
}

/**
 * Re-read the unread count and push it. Called after a save, so the views follow
 * the file instead of each keeping its own copy.
 * @returns {Promise<void>}
 */
async function announceReminderChange() {
  const history = await listNotifications({ limit: 1 });
  if (!history.ok) {
    // A failed read must not push a zero: that would clear a badge that is still
    // earned. The next tick tries again.
    console.error('[zuri:reminders] unread', history.error.message);
    return;
  }
  announceReminders(history.data.unread);
}

/**
 * The pending reminders, soonest first, for the Reminders page and the rail.
 * @returns {Promise<object>}
 */
function handleRemindersList() {
  return listReminders();
}

/**
 * Save one reminder and push the new list. The store sets the id and the repeat
 * bookkeeping, so the view only sends what the person filled in.
 * @param {{ title?: string, repeat?: string, dueAt?: string, intervalMinutes?: number, timeOfDay?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleRemindersCreate(payload) {
  const created = await createReminder(payload ?? {});
  if (created.ok) await announceReminderChange();
  return created;
}

/**
 * Mark one reminder done, the Reminders page's Done button.
 * @param {{ id?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleRemindersComplete(payload) {
  const completed = await completeReminder(payload?.id);
  if (completed.ok) await announceReminderChange();
  return completed;
}

/**
 * The bell's history plus its unread count. `limit` caps the list only, never the
 * count, so a badge cannot be understated by asking for one row.
 * @param {{ limit?: number }} [payload]
 * @returns {Promise<object>}
 */
function handleNotificationsList(payload) {
  return listNotifications(Number.isFinite(payload?.limit) ? { limit: payload.limit } : {});
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

/**
 * Whether this process really is Zuri, rather than a check script launched as
 * `electron scripts/smoke.js`, which reports the scripts folder as its app path.
 * @returns {boolean}
 */
function runsAsApp() {
  // ZURI_PREVIEW marks the window `npm run dev` opens beside the preview server:
  // a second window on purpose, so it must not take the single-instance lock.
  // Taking it would make the preview quit on launch whenever Zuri is already
  // open, and the server it runs under closes with it, leaving a screen check
  // with nothing to load.
  if (process.env.ZURI_PREVIEW === '1') return false;
  const appRoot = path.join(moduleDir, '..', '..');
  return path.resolve(app.getAppPath()) === path.resolve(appRoot);
}

// One Zuri at a time (0:13705). A second launch takes the single-instance lock, finds
// it already held, hands its request over and leaves: there is never a second window
// to focus, and no second ticker writing the same JSON files. The check scripts boot
// this module as an Electron app of their own, so the lock is only taken when this
// process really is Zuri (the test the taskbar shortcut uses); otherwise opening Zuri
// would turn a running check away, and two overlapping checks would lock each other out.
const ownsSingleInstance = runsAsApp() ? app.requestSingleInstanceLock() : true;
if (!ownsSingleInstance) app.quit();

// The instance that owns the window does the work: the window it already has comes back
// to the front, restored and focused, and the overlay, if it is up, is left as it is
// (0:13705, states 01 to 03). Deliberately no createMainWindow() here: a second launch
// is never drawn, so there is no second window to focus.
app.on('second-instance', () => {
  bringMainWindowForward();
});

app.whenReady().then(async () => {
  // A launch that arrived second has already quit above, and builds nothing.
  if (!ownsSingleInstance) return;
  registerIpc();
  // First run: the folder exists before Act can write to it, and the Files view
  // can list an empty workspace instead of reporting a missing folder.
  try {
    await ensureWorkspace();
  } catch (error) {
    console.error('[zuri:workspace]', error);
  }
  // In development the dock icon comes from the Electron binary, so macOS is told
  // about the Zuri logo here. A packaged build reads it from the app bundle.
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON_ENTRY);
  // Must run before the first window is shown, or the window is already grouped.
  if (process.env.ZURI_NO_AUMID !== '1') adoptTaskbarIdentity();

  createMainWindow();
  // The icon in the notification area is how a hidden window is brought back, so it
  // is created straight after the window it belongs to.
  createTray();

  // The overlay is opt-in, so it opens at launch only when the stored setting says so.
  // A failed read leaves it closed, which is the safe half of the toggle.
  try {
    const settings = await readSettings();
    if (settings.ok === true) startOverlayFromSettings(settings.data);
    else console.error('[zuri:overlay]', settings.error?.message ?? 'settings could not be read');
  } catch (error) {
    console.error('[zuri:overlay]', error);
  }

  // Reminders tick every ten seconds for as long as Zuri is open. The ticker's
  // first run is the catch-up sweep for anything that came due while it was shut,
  // and each tick pushes the unread count so the bell needs no timer of its own.
  startReminderTicker({
    onTick: (report) => {
      announceReminders(report?.unread);
      // The tray's status line counts the same unread reminders the bell does.
      if (Number.isFinite(report?.unread)) trayState.remindersDue = report.unread;
      refreshTray();
    },
    // The reminder toast's buttons: snooze re-arms it (reminders.js owns the write),
    // and "Open reminders" brings Zuri forward on the Reminders page.
    onOpen: () => void showRemindersPage(),
  });

  // Scheduled automations tick every thirty seconds for as long as Zuri is open.
  // The first thing the scheduler does is the catch-up sweep: every automation whose
  // last run is a whole cadence behind the clock is replayed once, and that run writes
  // its own lastRunAt, so opening Zuri again straight after does not replay it. The
  // count goes to the window as the "caught up N runs" toast. Each run reports on the
  // same push the rest of the app uses, so the Context panel and the runs page follow
  // it without a timer of their own.
  startScheduler({
    onProgress: (change) => announceState(change),
    onCatchUp: (report) => {
      announceCatchUp(report);
      if (report.ok !== true) {
        console.error('[zuri:scheduler]', report.error?.message ?? 'the catch-up could not read schedules.json');
      }
    },
    onTick: (report) => {
      if (report.ok !== true) {
        console.error('[zuri:scheduler]', report.error?.message ?? 'the tick could not read schedules.json');
      }
    },
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Quitting is the one thing the window's close handler must not swallow: the tray's
// Quit row sets this too, and this catches every other route out (the OS, a crash
// handler, a second instance handing over).
app.on('before-quit', () => {
  quitting = true;
});

// A pending tick must not write to a store that is already closing.
app.on('will-quit', () => {
  stopReminderTicker();
  stopScheduler();
  closeOverlay();
  // An icon left behind in the notification area would outlive the process.
  if (tray !== null) {
    tray.destroy();
    tray = null;
  }
});

// A closed window is normally hidden rather than closed, so this is the path for a
// window that was destroyed for real: a crash, or a build where the tray could not be
// created. Quitting is the honest response, because nothing would be left to reopen.
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
