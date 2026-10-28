import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, session, shell, Tray } from 'electron';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { CHAT_STREAM_CHANNEL, askForAddin, runPrompt, sendChatMessage, summarizeText } from './providers/chat.js';
import { lastQuestion, replyThroughAccount, webSearchContext } from './providers/cloud-chat.js';
import { readChatStream } from './providers/sse.js';
import { formatSummaryMarkdown, summaryFileName } from './documents.js';
import { IMAGE_MODELS, defaultImageModel, generateImage } from './providers/images.js';
import { runOnboardingSetup } from './onboarding.js';
import {
  closeOverlay,
  hideOverlay,
  isOverlayOpen,
  moveOverlayBy,
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
import { PROVIDERS, clearKey, getKey, keyStatus, setKey } from './secrets.js';
import { clearCloudSession, readCloudSession, writeCloudSession } from './cloud-session.js';
import { createChatSync } from './chat-sync.js';
import { addinStatus, installAddin, removeAddin, resumeAddin } from './addin.js';
import {
  appendMessage,
  clearThreads,
  completeReminder,
  createAutomation,
  createReminder,
  createTask,
  createThread,
  deleteThread,
  deleteAutomation,
  deleteTask,
  getStoreRoot,
  listNotifications,
  listReminders,
  listTasks,
  listThreads,
  readSettings,
  readStore,
  renameThread,
  saveSettings,
  updateAutomation,
  updateTask,
} from './store.js';
import { cancelToolStep, ensureWorkspace, listWorkspaceFiles, registerChosenFile, resolveWorkspaceFile, resolveWorkspacePath, runTool, toolCatalogue } from './tools/index.js';

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
// Windows shell APIs cannot read an icon path inside app.asar. The packaged
// executable embeds the same ICO, so it is the real on-disk source for taskbar metadata.
const WINDOWS_SHELL_ICON = app.isPackaged ? process.execPath : ICO_ENTRY;
/**
 * How long after launch the first cloud sync runs. Long enough that the window, the
 * tray and the automation catch-up are not competing with it for the network.
 */
const STARTUP_SYNC_DELAY_MS = 4000;

const CANVAS_DARK = '#040130'; // matches --background in dark mode, so the window does not flash white before first paint

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
const APP_USER_MODEL_ID = 'com.zuri.desktop.Zuri';
// A source or test launch runs through electron.exe. Giving that process the
// production id makes Windows recreate Electron.lnk under Zuri's taskbar group.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId(APP_USER_MODEL_ID);

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
  // Source and smoke-test processes run as electron.exe and must never register
  // shortcuts under the installed app's production taskbar identity.
  if (process.platform !== 'win32' || !app.isPackaged) return;

  const startMenuPrograms = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const staleElectronLink = path.join(startMenuPrograms, 'Electron.lnk');
  try {
    if (existsSync(staleElectronLink)) {
      const details = shell.readShortcutLink(staleElectronLink);
      const targetsElectron = path.basename(details.target ?? '').toLowerCase() === 'electron.exe';
      if (targetsElectron) {
        // Explorer can cache Zuri's AUMID on this generic link even when Electron's
        // reader reports its original id. The exact filename and target keep this
        // cleanup scoped to the stale development launcher.
        unlinkSync(staleElectronLink);
      }
    }
  } catch (error) {
    console.warn('[zuri:taskbar] stale Electron shortcut cleanup failed', error.message);
  }

  const links = [
    path.join(startMenuPrograms, 'Zuri.lnk'),
    path.join(app.getPath('desktop'), 'Zuri.lnk'),
  ];
  try {
    for (const link of links) {
      const operation = existsSync(link) ? 'update' : 'create';
      const written = shell.writeShortcutLink(link, operation, {
        target: process.execPath,
        args: '',
        icon: process.execPath,
        iconIndex: 0,
        description: 'Zuri',
        appUserModelId: APP_USER_MODEL_ID,
      });
      if (!written) {
        console.warn(`[zuri:taskbar] Windows refused shortcut refresh: ${link}`);
      }
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
    // Shown below once the first paint is ready, so Windows never shows the
    // 1200x800 default and then jumps to the maximised size.
    show: false,
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

  if (process.platform === 'win32' && app.isPackaged) {
    // The process AUMID identifies the app, but Windows can still derive the
    // running taskbar button from the window unless its icon is assigned too.
    window.setIcon(ICO_ENTRY);
    window.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: WINDOWS_SHELL_ICON,
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: 'Zuri',
    });
  }

  // Zuri is a workspace, not a dialog: it opens filling the screen width instead
  // of a fixed 1200x800 box with dead space beside every column. minWidth still
  // governs the size after the user restores it.
  window.maximize();

  // Reveal on the first paint. did-fail-load also reveals it: a renderer that
  // cannot load must still produce a window, or the app looks like it never ran.
  let revealed = false;
  const revealWindow = () => {
    if (revealed || window.isDestroyed()) return;
    revealed = true;
    window.show();
  };
  window.once('ready-to-show', revealWindow);
  window.webContents.once('did-fail-load', revealWindow);

  window.loadFile(RENDERER_ENTRY);

  // Answers can contain links. Electron would otherwise open one in a new
  // BrowserWindow, which looks like a second Zuri with none of the app around it.
  // Send http(s) links to the default browser instead and refuse everything else.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A link without target=_blank must not replace Zuri's own window either.
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

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
 * SpeechRecognition asks Chromium for audio permission even though the renderer
 * does not call getUserMedia directly. Allow only audio from Zuri's local file
 * renderer, never camera access or requests from another origin.
 * @returns {void}
 */
function configureMediaPermissions() {
  const isTrustedRenderer = (webContents) => webContents?.getURL?.().startsWith('file://') === true;
  const isAudioOnly = (details) => (
    Array.isArray(details?.mediaTypes) &&
    details.mediaTypes.includes('audio') &&
    !details.mediaTypes.includes('video')
  );

  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => (
    permission === 'media' && isTrustedRenderer(webContents) && isAudioOnly(details)
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === 'media' && isTrustedRenderer(webContents) && isAudioOnly(details));
  });
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
  ['zuri:chats:delete', handleChatDelete],
  ['zuri:chats:rename', handleChatRename],
  ['zuri:chats:clear', handleChatClear],
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
  ['zuri:settings:addin-status', handleSettingsAddinStatus],
  ['zuri:settings:addin-install', handleSettingsAddinInstall],
  ['zuri:settings:addin-remove', handleSettingsAddinRemove],
  ['zuri:cloud:config', handleCloudConfig],
  ['zuri:cloud:sign-in', handleCloudSignIn],
  ['zuri:cloud:sign-up', handleCloudSignUp],
  ['zuri:cloud:sign-in-password', handleCloudSignInPassword],
  ['zuri:cloud:forgot-password', handleCloudForgotPassword],
  ['zuri:cloud:reset-password', handleCloudResetPassword],
  ['zuri:cloud:set-password', handleCloudSetPassword],
  ['zuri:cloud:account', handleCloudAccount],
  ['zuri:cloud:plans', handleCloudPlans],
  ['zuri:cloud:topups', handleCloudTopups],
  ['zuri:cloud:topup', handleCloudTopup],
  ['zuri:cloud:checkout', handleCloudCheckout],
  ['zuri:cloud:sign-out', handleCloudSignOut],
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
  ['zuri:files:saveAs', handleFilesSaveAs],
  ['zuri:files:choose', handleFilesChoose],
  ['zuri:files:summarize', handleFilesSummarize],
  ['zuri:images:generate', handleImagesGenerate],
  ['zuri:images:models', handleImagesModels],
  ['zuri:tools:list', handleToolsList],
  ['zuri:tools:run', handleToolsRun],
  ['zuri:tools:cancel', handleToolsCancel],
  ['zuri:overlay:open', handleOverlayOpen],
  ['zuri:overlay:hide', handleOverlayHide],
  ['zuri:overlay:open-main', handleOverlayOpenMain],
  ['zuri:overlay:move-by', handleOverlayMoveBy],
]);

/** Show the quick-ask card from a button in the main window. */
function handleOverlayOpen() {
  openOverlay();
  refreshTray();
  return { ok: true };
}

/**
 * Drag the quick-ask card. The renderer reports the pointer's travel while its header
 * is held down, and overlay.js moves the window by that much.
 * @param {import('electron').IpcMainInvokeEvent} _event
 * @param {{ dx?: unknown, dy?: unknown } | undefined} payload
 */
function handleOverlayMoveBy(_event, payload) {
  return moveOverlayBy(payload?.dx, payload?.dy);
}

/** The card's close button: hide it, keeping any unsent text for the next open. */
function handleOverlayHide() {
  hideOverlay();
  refreshTray();
  return { ok: true };
}

/** The card's "back to Zuri" button: hide the card and raise the main window. */
function handleOverlayOpenMain() {
  hideOverlay();
  bringMainWindowForward();
  refreshTray();
  return { ok: true };
}

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
 * Permanently remove one stored thread. The renderer must send the id explicitly
 * so an accidental empty action can never delete the first history row.
 * @param {{ threadId?: string }} [payload]
 * @returns {Promise<object>}
 */
async function handleChatDelete(payload) {
  // Read first: the link to the cloud copy lives on the thread itself, and the
  // delete below is what removes it.
  const cloudId = await cloudIdOfThread(payload?.threadId);
  const result = await deleteThread(payload?.threadId);
  // Best effort and not awaited. The chat is already gone from this machine, so a
  // cloud delete that fails must not become an error in front of the person who
  // asked for it. A copy left behind in the account is the cheaper mistake of the
  // two: an error dialog over a chat already deleted is worse than a stray record.
  if (result?.ok === true && cloudId !== '') backgroundSync(chatSync.deleteConversation(cloudId));
  if (result?.ok === true) announceState({ area: 'chats' });
  return result;
}

/** Rename a saved conversation and announce it to the sidebar. */
async function handleChatRename(payload) {
  const result = await renameThread(payload?.threadId, payload?.title);
  if (result?.ok === true) announceState({ area: 'chats' });
  return result;
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
 * @param {{ threadId?: string, model?: { provider?: string, model?: string } }} [payload]
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

  const answered = sendChatMessage(threadId, {
    // The composer sends the agent it has picked; without one the reply falls back to
    // settings.activeAgentId, which is the same id in the normal case.
    agentId: typeof payload?.agentId === 'string' ? payload.agentId : undefined,
    webSearch: payload?.webSearch === true,
    // The composer's model chip pins a model for this chat. Without one the reply
    // uses the model chosen in Settings, so an older window keeps working.
    model: payload?.model !== null && typeof payload?.model === 'object'
      ? { provider: payload.model.provider, model: payload.model.model }
      : undefined,
    // Every reply in the window goes through the account, so no supplier key is
    // read and a signed-out window is told to sign in instead.
    cloudReply: (request) => cloudChatReply(request),
    signal: controller.signal,
    emit: (streamEvent) => {
      // The window can close mid-stream; sending to a destroyed webContents throws.
      if (sender && !sender.isDestroyed()) sender.send(CHAT_STREAM_CHANNEL, streamEvent);
    },
  });

  // The account's copy of this chat catches up once the reply is saved. Started and
  // forgotten rather than awaited: the window already has its answer, and a sync that
  // cannot run (signed out, offline, account full) must never surface as a chat error.
  answered.then(
    (result) => {
      if (result?.ok === true && typeof threadId === 'string') backgroundSync(chatSync.syncThread(threadId));
    },
    // The renderer still sees this rejection through the return below; this branch is
    // here only so the sync hook does not become a second report of it.
    () => {},
  );

  return answered.finally(settle);
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
  if (saved.ok === true && Object.hasOwn(payload ?? {}, 'theme')) {
    applyNativeTheme(saved.data?.theme);
  }
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

/** Keep the native title bar and application menu in step with the renderer theme. */
function applyNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
}

function cloudBaseUrl(settings) {
  const raw = typeof settings?.cloudUrl === 'string' ? settings.cloudUrl.trim() : '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.hash !== '') return null;
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
  return url.toString().replace(/\/$/, '');
}

/**
 * Send one signed request to Zuri Cloud and hand back the open response.
 *
 * Split out from cloudFetch because a streamed reply has to be read as it
 * arrives, while every other call wants the parsed JSON. Both need the same base
 * URL, the same session header and the same timeout handling, so this is the one
 * place those live.
 *
 * @param {string} pathname
 * @param {{ method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number, signal?: AbortSignal | null }} [options]
 * @param {boolean} [requireSession]
 * @returns {Promise<{ ok: true, data: { response: Response } } | { ok: false, error: { code: string, message: string }, status?: number }>}
 */
async function cloudRequest(pathname, options = {}, requireSession = false) {
  const settings = await readSettings();
  if (!settings.ok) return settings;
  const base = cloudBaseUrl(settings.data);
  if (!base) return { ok: false, error: { code: 'CLOUD_URL_INVALID', message: 'Set a valid Zuri Cloud server URL in Settings.' } };
  const headers = { accept: 'application/json', ...(options.headers ?? {}) };
  if (requireSession) {
    const saved = await readCloudSession();
    if (!saved.ok) return saved;
    if (!saved.data?.token) return { ok: false, error: { code: 'CLOUD_AUTH_REQUIRED', message: 'Sign in to Zuri Cloud first.' } };
    headers.authorization = `Bearer ${saved.data.token}`;
  }
  // A chat reply can take far longer than any other call, so the caller says how
  // long it will wait and may pass its own signal, which is how Stop ends a reply
  // that is still being written.
  const { timeoutMs = 20_000, signal = null, ...fetchOptions } = options;
  try {
    const response = await fetch(`${base}${pathname}`, {
      ...fetchOptions,
      headers,
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
    return { ok: true, data: { response } };
  } catch {
    return { ok: false, error: { code: 'CLOUD_UNAVAILABLE', message: 'Zuri Cloud could not be reached.' } };
  }
}

/**
 * Run one JSON call and return the body the cloud answered with.
 * @param {string} pathname
 * @param {object} [options]
 * @param {boolean} [requireSession]
 * @returns {Promise<object>}
 */
async function cloudFetch(pathname, options = {}, requireSession = false) {
  const reached = await cloudRequest(pathname, options, requireSession);
  if (!reached.ok) return reached;
  const response = reached.data.response;
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok || body?.ok !== true) return { ok: false, error: body?.error ?? { code: 'CLOUD_REQUEST_FAILED', message: 'Zuri Cloud rejected the request.' }, status: response.status };
  return body;
}

/**
 * The cloud sync, bound to the one function that knows how to reach the account.
 * Every request it makes goes out through cloudFetch, so the bearer token never
 * passes through chat-sync.js and a sync cannot be sent up as the wrong person.
 */
const chatSync = createChatSync({ request: cloudFetch });

/**
 * Start a cloud sync and let it finish on its own.
 *
 * Nothing a person does waits on one: the reply is already on screen and the window
 * is already open, so a slow or failed sync has to cost nothing anyone can see. Every
 * entry point in chat-sync.js reports a failure instead of throwing, and the catch
 * here only makes sure an unexpected throw cannot become an unhandled rejection.
 * @param {Promise<object>} started
 * @returns {void}
 */
function backgroundSync(started) {
  started.then(
    (result) => {
      // Messages that arrived from the account were written into chats.json behind
      // the window's back, so the window is told to re-read them. Without this, a
      // chat continued in the browser appears in Recents only after a restart.
      if (result?.ok === true && (Number(result.data?.appended) || 0) > 0) announceState({ area: 'chats' });
    },
    (error) => console.error('[zuri-cloud] sync', error?.message ?? error),
  );
}

/**
 * Catch every stored chat up with the account that has just signed in. Not awaited:
 * the sign-in reply has to reach the window at once, and the person is looking at
 * the account page rather than at this work.
 * @returns {void}
 */
function afterCloudSignIn() {
  backgroundSync(chatSync.syncAllThreads());
}

/**
 * The cloud conversation a stored thread is linked to, or '' when it has none.
 *
 * Read before the thread is deleted, because deleteThread takes away the only copy
 * of the link and the cloud copy is deleted afterwards.
 * @param {string} threadId
 * @returns {Promise<string>}
 */
async function cloudIdOfThread(threadId) {
  if (typeof threadId !== 'string' || threadId === '') return '';
  const listed = await listThreads();
  if (listed.ok !== true) return '';
  const thread = listed.data.find((entry) => entry?.id === threadId);
  const cloudId = thread?.cloud?.id;
  return typeof cloudId === 'string' ? cloudId.trim() : '';
}

async function handleCloudConfig() {
  const settings = await readSettings();
  if (!settings.ok) return settings;
  const base = cloudBaseUrl(settings.data);
  if (!base) return { ok: false, error: { code: 'CLOUD_URL_INVALID', message: 'Set a valid Zuri Cloud server URL in Settings.' } };
  const config = await cloudFetch('/api/public-config');
  if (!config.ok) return config;
  return { ok: true, data: { cloudUrl: base, googleClientId: config.data?.googleClientId ?? '' } };
}

async function handleCloudSignIn(payload) {
  if (typeof payload?.credential !== 'string' || payload.credential.trim() === '') return { ok: false, error: { code: 'CLOUD_CREDENTIAL_REQUIRED', message: 'Google sign-in did not return a credential.' } };
  const result = await cloudFetch('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: payload.credential }) });
  if (!result.ok) return result;
  const stored = await writeCloudSession(result.data?.token, result.data?.expiresAt);
  if (!stored.ok) return stored;
  afterCloudSignIn();
  return { ok: true, data: { user: result.data?.user, usage: result.data?.usage, expiresAt: result.data?.expiresAt } };
}

/**
 * Ask the Zuri account for one reply.
 *
 * This is the app's only chat route: the desktop no longer needs a supplier key to
 * answer, because the account pays for the request out of the plan. The request
 * shape lives in providers/cloud-chat.js so the checks can prove it without a
 * network, and this function supplies the signed POST it needs.
 * @param {{ conversation: object, settings: object, signal?: AbortSignal, emit?: (event: object) => void }} request
 * @returns {Promise<object>}
 */
/**
 * Run the web search the person switched on, before the reply is asked for.
 *
 * The cloud route has no tool loop, so the search cannot be offered to the model as
 * a call it makes. The app already owns a working search, so it runs here and the
 * results travel with the question. A failed search is reported to the model rather
 * than failing the message: a person who asked a question still deserves the best
 * answer available without the web.
 *
 * @param {object} conversation
 * @param {(event: object) => void} [emit]
 * @returns {Promise<string>} The instruction block, empty when there was nothing to search.
 */
async function searchForReply(conversation, emit) {
  const query = lastQuestion(conversation);
  if (query === '') return '';

  // Said out loud, because a search adds a wait and silence reads as a freeze.
  emit?.({ status: 'Searching the web...' });
  try {
    const found = await runTool('webSearch', { query });
    if (!found?.ok) return webSearchContext(query, []);
    const results = Array.isArray(found.data?.results) ? found.data.results : [];
    return webSearchContext(query, results);
  } catch (error) {
    console.error('[zuri] web search', error?.message ?? error);
    return webSearchContext(query, []);
  } finally {
    emit?.({ status: '' });
  }
}

async function cloudChatReply({ conversation, settings, signal, emit, webSearch, tools }) {
  // Only when the person switched it on for this message; the direct route makes
  // the same choice, so the toggle means one thing.
  const searchContext = webSearch === true ? await searchForReply(conversation, emit) : '';
  return replyThroughAccount({
    conversation,
    settings,
    // The search results are instruction for this request only, never stored with
    // the chat, so a later reply cannot cite a page nobody searched for.
    context: searchContext,
    tools: Array.isArray(tools) ? tools : [],
    signal,
    emit: (event) => emit?.(event),
    postChat: async (body, chatOptions) => {
      const reached = await cloudRequest('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // A long answer can outlast any short timeout, and Stop has to be able to
        // end one that is still being written.
        timeoutMs: 120_000,
        signal: chatOptions?.signal,
      }, true);

      /** The sentence a signed-out or expired session deserves. */
      const signIn = {
        ok: false,
        error: { code: 'CLOUD_AUTH_REQUIRED', message: 'Sign in to Zuri to get replies. Open Zuri Cloud in the sidebar.' },
      };

      if (!reached.ok) {
        // The session check happens before any request goes out, so this is the
        // everyday signed-out case rather than a server answer.
        if (reached.error?.code === 'CLOUD_AUTH_REQUIRED') return signIn;
        return reached;
      }

      const response = reached.data.response;
      const contentType = response.headers.get('content-type') ?? '';

      // A server that has not been updated answers one plain JSON body. Reading it
      // here means an older deploy still works, just without the typing effect.
      if (!contentType.includes('text/event-stream')) {
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (response.status === 401 || payload?.error?.code === 'AUTH_REQUIRED') return signIn;
        if (!response.ok || payload?.ok !== true) {
          return { ok: false, error: payload?.error ?? { code: 'CLOUD_REQUEST_FAILED', message: 'Zuri Cloud rejected the request.' } };
        }
        return payload;
      }

      // An event stream always answers 200; a refusal arrives as an error frame or
      // as a JSON body before the stream starts.
      if (!response.ok) {
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (response.status === 401) return signIn;
        return { ok: false, error: payload?.error ?? { code: 'CLOUD_REQUEST_FAILED', message: 'Zuri Cloud rejected the request.' } };
      }

      return readChatStream(response, (text) => chatOptions?.onDelta?.(text));
    },
  });
}

/**
 * Sign-up and sign-in differ only in the path and the fields, and both hand back
 * a new session, so one function keeps the two from drifting apart.
 * @param {string} pathname
 * @param {object} body
 * @returns {Promise<object>}
 */
async function cloudCreateSession(pathname, body) {
  const result = await cloudFetch(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!result.ok) return result;
  const stored = await writeCloudSession(result.data?.token, result.data?.expiresAt);
  if (!stored.ok) return stored;
  afterCloudSignIn();
  return { ok: true, data: { user: result.data?.user, subscription: result.data?.subscription, expiresAt: result.data?.expiresAt } };
}

/** @param {unknown} value @returns {string} */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function handleCloudSignUp(payload) {
  const email = textOf(payload?.email);
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (email === '') return { ok: false, error: { code: 'CLOUD_EMAIL_REQUIRED', message: 'Enter your email address.' } };
  if (password === '') return { ok: false, error: { code: 'CLOUD_PASSWORD_REQUIRED', message: 'Choose a password.' } };
  return cloudCreateSession('/api/auth/sign-up', { email, password, displayName: textOf(payload?.displayName) });
}

async function handleCloudSignInPassword(payload) {
  const email = textOf(payload?.email);
  const password = typeof payload?.password === 'string' ? payload.password : '';
  // One message for both missing fields: the form asks for them side by side.
  if (email === '' || password === '') {
    return { ok: false, error: { code: 'CLOUD_CREDENTIALS_REQUIRED', message: 'Enter your email address and password.' } };
  }
  return cloudCreateSession('/api/auth/sign-in', { email, password });
}

async function handleCloudForgotPassword(payload) {
  const email = textOf(payload?.email);
  if (email === '') return { ok: false, error: { code: 'CLOUD_EMAIL_REQUIRED', message: 'Enter your email address.' } };
  const result = await cloudFetch('/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!result.ok) {
    // No mail provider on the server is a setup gap, not a mistake the person
    // made, so it is spelled out as something they can act on.
    if (result.error?.code === 'MAIL_NOT_CONFIGURED') {
      return { ok: false, error: { code: 'MAIL_NOT_CONFIGURED', message: 'This Zuri Cloud server cannot send email yet. Ask support to reset your password for you.' } };
    }
    return result;
  }
  return { ok: true, data: { sent: result.data?.sent === true } };
}

async function handleCloudResetPassword(payload) {
  const token = textOf(payload?.token);
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (token === '') return { ok: false, error: { code: 'CLOUD_RESET_TOKEN_REQUIRED', message: 'Paste the reset code from your email.' } };
  if (password === '') return { ok: false, error: { code: 'CLOUD_PASSWORD_REQUIRED', message: 'Choose a new password.' } };
  const result = await cloudFetch('/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password }) });
  if (!result.ok) return result;
  return { ok: true, data: { reset: result.data?.reset === true } };
}

async function handleCloudSetPassword(payload) {
  const password = typeof payload?.password === 'string' ? payload.password : '';
  if (password === '') return { ok: false, error: { code: 'CLOUD_PASSWORD_REQUIRED', message: 'Choose a password.' } };
  const body = { password };
  // Only sent when the account already has a password to confirm; a Google-only
  // account has nothing to re-enter.
  const currentPassword = typeof payload?.currentPassword === 'string' ? payload.currentPassword : '';
  if (currentPassword !== '') body.currentPassword = currentPassword;
  const result = await cloudFetch('/api/auth/set-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, true);
  if (!result.ok) return result;
  // The server answers { updated: true }; whether the account now has a password
  // comes back from /api/me, so nothing is inferred from this reply.
  return { ok: true, data: { hasPassword: result.data?.updated === true } };
}

async function handleCloudAccount() {
  const [account, limits, billing] = await Promise.all([
    cloudFetch('/api/me', {}, true),
    cloudFetch('/api/me/limits', {}, true),
    cloudFetch('/api/me/billing', {}, true),
  ]);
  if (!account.ok) {
    if (account.status === 401 || account.error?.code === 'CLOUD_AUTH_REQUIRED') await clearCloudSession();
    return account;
  }
  if (!limits.ok) return limits;
  if (!billing.ok) return billing;
  return { ok: true, data: { user: account.data?.user, subscription: account.data?.subscription, usage: limits.data?.usage, limits: limits.data?.limits, billing: billing.data } };
}

async function handleCloudPlans() {
  return cloudFetch('/api/plans');
}

async function handleCloudTopups() {
  return cloudFetch('/api/topups');
}

async function handleCloudTopup(payload) {
  return openPaystackCheckout('/api/billing/topup', { packCode: payload?.packCode }, 'packCode');
}

async function handleCloudCheckout(payload) {
  return openPaystackCheckout('/api/billing/checkout', { planCode: payload?.planCode }, 'planCode');
}

/**
 * Start a Paystack charge in the browser and hand the person there. Both a plan
 * change and a top-up end in the same place, so the link is only opened after it
 * is confirmed to be Paystack's own origin: a tampered reply cannot send someone
 * to a look-alike checkout page.
 * @param {string} path API route that returns { authorizationUrl }
 * @param {Record<string, unknown>} body
 * @param {string} echoKey field of the reply to echo back to the renderer
 */
async function openPaystackCheckout(path, body, echoKey) {
  const result = await cloudFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, true);
  if (!result.ok) return result;
  let checkout;
  try { checkout = new URL(result.data?.authorizationUrl); } catch { return { ok: false, error: { code: 'CLOUD_CHECKOUT_INVALID', message: 'The checkout link was invalid.' } }; }
  if (checkout.origin !== 'https://checkout.paystack.com') return { ok: false, error: { code: 'CLOUD_CHECKOUT_INVALID', message: 'The checkout link was not trusted.' } };
  const problem = await shell.openExternal(checkout.toString());
  if (problem) return { ok: false, error: { code: 'CLOUD_CHECKOUT_OPEN_FAILED', message: problem } };
  return { ok: true, data: { opened: true, [echoKey]: result.data?.[echoKey] ?? body[echoKey] } };
}

async function handleCloudSignOut() {
  const saved = await readCloudSession();
  if (saved.ok && saved.data?.token) await cloudFetch('/api/auth/sign-out', { method: 'POST' }, true);
  return clearCloudSession();
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

/** Remove all stored chat threads after the history page confirms the action. */
async function handleChatClear() {
  const result = await clearThreads();
  if (result?.ok === true) announceState({ area: 'chats' });
  return result;
}

async function handleSettingsAddinStatus() {
  try {
    return { ok: true, data: await addinStatus(getStoreRoot()) };
  } catch (error) {
    console.error('[zuri:addin] status', error);
    return { ok: false, error: { code: 'ADDIN_STATUS_FAILED', message: error?.message ?? 'Word add-in status is unavailable.' } };
  }
}

async function handleSettingsAddinInstall() {
  try {
    await installAddin(getStoreRoot(), (request) => askForAddin(request));
    return { ok: true, data: await addinStatus(getStoreRoot()) };
  } catch (error) {
    console.error('[zuri:addin] install', error);
    return { ok: false, error: { code: 'ADDIN_INSTALL_FAILED', message: error?.message ?? 'The Word add-in could not be installed.' } };
  }
}

async function handleSettingsAddinRemove() {
  try {
    await removeAddin(getStoreRoot());
    return { ok: true, data: await addinStatus(getStoreRoot()) };
  } catch (error) {
    console.error('[zuri:addin] remove', error);
    return { ok: false, error: { code: 'ADDIN_REMOVE_FAILED', message: error?.message ?? 'The Word add-in could not be removed.' } };
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
 * Copy a workspace file to a place the person picks, so a generated Word, Excel or
 * PowerPoint file can be saved outside the app. The source goes through the same
 * workspace guard as open and reveal; the destination is whatever the person chose
 * in the system dialog, never a path the renderer supplied.
 * @param {{ path?: string }} [payload]
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
async function handleFilesSaveAs(payload, event) {
  try {
    const source = await resolveWorkspaceFile(payload?.path);
    const owner = BrowserWindow.fromWebContents(event?.sender) ?? BrowserWindow.getFocusedWindow();
    const options = { title: 'Save a copy', defaultPath: path.join(app.getPath('documents'), path.basename(source)) };
    const picked = owner === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(owner, options);
    if (picked.canceled || typeof picked.filePath !== 'string' || picked.filePath === '') {
      return { ok: true, data: { cancelled: true } };
    }
    await copyFile(source, picked.filePath);
    return { ok: true, data: { cancelled: false, path: picked.filePath } };
  } catch (error) {
    if (!String(error?.code ?? '').startsWith('TOOL_')) console.error('[zuri:files] saveAs', error);
    return filesFailure(error, 'FILES_SAVE_FAILED');
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

// Folder reads are capped because every character is sent to the provider and billed.
const FOLDER_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log']);
const FOLDER_MAX_FILES = 20;
const FOLDER_MAX_FILE_BYTES = 100 * 1024;
const FOLDER_MAX_TOTAL_CHARS = 200_000;

/**
 * Let the person pick a folder and read its top-level text files in this process, so
 * the renderer never supplies a path to read. Sub-folders and hidden files are
 * skipped on purpose: the cap, not recursion, keeps the cost predictable.
 * @param {Electron.BrowserWindow | null} owner
 * @returns {Promise<object>}
 */
async function chooseFolderForChat(owner) {
  const options = { title: 'Add a folder', buttonLabel: 'Add folder', properties: ['openDirectory'] };
  try {
    const picked = owner === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(owner, options);
    const folderPath = Array.isArray(picked.filePaths) ? picked.filePaths[0] : undefined;
    if (picked.canceled || typeof folderPath !== 'string' || folderPath === '') {
      return { ok: true, data: { cancelled: true } };
    }

    const entries = await readdir(folderPath, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && FOLDER_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name));

    const sections = [];
    let totalChars = 0;
    let skipped = Math.max(entries.length - candidates.length, 0);
    for (const entry of candidates) {
      const filePath = path.join(folderPath, entry.name);
      const size = await measureFile(filePath);
      if (sections.length >= FOLDER_MAX_FILES || totalChars >= FOLDER_MAX_TOTAL_CHARS || !Number.isFinite(size) || size > FOLDER_MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      const text = (await readFile(filePath, 'utf8')).slice(0, FOLDER_MAX_TOTAL_CHARS - totalChars);
      totalChars += text.length;
      sections.push(`--- ${entry.name} ---\n${text}`);
    }

    return {
      ok: true,
      data: {
        cancelled: false,
        name: path.basename(folderPath),
        fileCount: sections.length,
        skipped,
        text: sections.join('\n\n'),
      },
    };
  } catch (error) {
    console.error('[zuri:files] folder', error);
    return filesFailure(error, 'FILES_CHOOSE_FAILED');
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
  if (payload?.purpose === 'folder') return chooseFolderForChat(owner);

  // One picker, two jobs: the composer asks for a file to attach to a message, the
  // Files view for a document to summarize. The title and the filter list say which.
  const options = payload?.purpose === 'attach'
    ? {
        title: 'Attach a file',
        buttonLabel: 'Attach',
        properties: ['openFile'],
        filters: [
          { name: 'Documents, text and images', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
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
    // Picking a file in the dialog is the person's consent to let a reply edit a copy of it.
    registerChosenFile(chosenPath);
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

/* ------------------------------------------------------------------ images */

// Pictures get their own workspace folder so the Files list stays readable and a
// person can find what was drawn without hunting through documents.
const IMAGES_DIR_NAME = 'images';

/**
 * The picture ladder as the composer menu shows it: name, one-line hint, the
 * price a person pays, and whether they hold a key for the supplier behind it.
 * `available` is a boolean rather than a key check in the view, so the renderer
 * never has to ask which providers exist or guess at the mapping.
 * @returns {object}
 */
function handleImagesModels() {
  const providers = PROVIDERS.filter((provider) => getKey(provider) !== null);
  return {
    ok: true,
    data: IMAGE_MODELS.map((model) => ({
      code: model.code,
      name: model.name,
      hint: model.hint,
      minPlan: model.minPlan,
      nairaPerImage: model.nairaPerImage,
      available: providers.includes(model.provider),
    })),
  };
}

/**
 * The name a generated picture is saved under: the model, then the moment it was
 * made. The timestamp is what keeps two pictures asked for in the same second
 * from overwriting each other, and it keeps the list sorted by newest.
 * @param {string} modelCode
 * @param {string} extension
 * @returns {string}
 */
function imageFileName(modelCode, extension) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  // The code arrives from the renderer, so only the characters a model code can
  // hold survive: nothing from that string reaches a path unchanged.
  const safeCode = String(modelCode).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  return `zuri-${safeCode}-${stamp}.${extension}`;
}

/**
 * Write one generated picture into the workspace. The path goes through the tool
 * layer's own guard, so a name that tried to leave the folder is refused there
 * rather than by a second copy of the check in this file.
 * @param {Buffer} bytes
 * @param {string} extension
 * @param {string} modelCode
 * @returns {Promise<object>}
 */
async function saveGeneratedImage(bytes, extension, modelCode) {
  try {
    const relative = `${IMAGES_DIR_NAME}/${imageFileName(modelCode, extension)}`;
    const target = resolveWorkspacePath(relative);
    // The images folder does not exist before the first picture, so creating it is
    // part of saving rather than a separate onboarding step.
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return { ok: true, data: { name: path.basename(target), path: target, relative, bytes: bytes.length } };
  } catch (error) {
    // A workspace refusal carries a TOOL_ code and is an answer for the view; a real
    // write error is worth a log line for whoever reads this next.
    if (!String(error?.code ?? '').startsWith('TOOL_')) console.error('[zuri:images] save', error);
    return { ok: false, error: { code: 'IMAGE_SAVE_FAILED', message: String(error?.message ?? error) } };
  }
}

/**
 * Ask a provider for a picture and save it in the workspace.
 *
 * Only providers with a key saved are offered, so the default picture model is the
 * best one the person can actually pay for. The renderer can name a model, never a
 * key or an endpoint. The API key itself is read inside providers/images.js and
 * only ever reaches that request's Authorization header, so nothing here logs it.
 * @param {{ prompt?: string, modelCode?: string }} [payload]
 * @param {Electron.IpcMainInvokeEvent} [event]
 * @returns {Promise<object>}
 */
async function handleImagesGenerate(payload, event) {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (prompt === '') {
    return { ok: false, error: { code: 'IMAGE_PROMPT_REQUIRED', message: 'Describe the picture you want first.' } };
  }

  const providers = PROVIDERS.filter((provider) => getKey(provider) !== null);
  const requested = typeof payload?.modelCode === 'string' ? payload.modelCode.trim() : '';
  // The file name carries the model code and generateImage owns the choice, so the
  // code is resolved once here and passed down. A wrong code or a missing key fails
  // before save is ever called, so the empty fallback cannot reach a file name.
  const modelCode = requested !== '' ? requested : (defaultImageModel(providers)?.code ?? '');

  try {
    const result = await generateImage({
      prompt,
      modelCode,
      providers,
      save: (bytes, extension) => saveGeneratedImage(bytes, extension, modelCode),
    });
    if (result?.ok !== true) return result;

    // The same push handleFilesSummarize sends: a view that did not start this flow
    // still needs to know the workspace changed, and Files re-lists on it.
    const sender = event?.sender;
    const relative = result.data?.image?.relative;
    if (sender && sender.isDestroyed?.() !== true && typeof relative === 'string') {
      sender.send(STATE_CHANGED_CHANNEL, { area: 'files', path: relative });
    }

    return result;
  } catch (error) {
    // generateImage is built not to throw; this is the last line that keeps a fault
    // from reaching the renderer as a rejected IPC call with no shape to show.
    console.error('[zuri:images] generate', error);
    return { ok: false, error: { code: 'IMAGE_PROVIDER_FAILED', message: 'Zuri could not make that picture. Try again.' } };
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
  configureMediaPermissions();
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

  let settings = null;
  try {
    settings = await readSettings();
    if (settings.ok === true) applyNativeTheme(settings.data?.theme);
  } catch (error) {
    console.error('[zuri:theme]', error);
  }

  createMainWindow();
  // The icon in the notification area is how a hidden window is brought back, so it
  // is created straight after the window it belongs to.
  createTray();

  // The overlay is opt-in, so it opens at launch only when the stored setting says so.
  // A failed read leaves it closed, which is the safe half of the toggle.
  try {
    if (settings?.ok === true) startOverlayFromSettings(settings.data);
    else console.error('[zuri:overlay]', settings?.error?.message ?? 'settings could not be read');
  } catch (error) {
    console.error('[zuri:overlay]', error);
  }

  try {
    await resumeAddin(getStoreRoot(), (request) => askForAddin(request));
  } catch (error) {
    console.error('[zuri:addin] resume', error);
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
    // Without this the scheduler would fall back to picking one tool from the prompt
    // text, so an automation asking for a judgement would run a web search instead.
    // With it, the prompt goes through the same pipeline a chat message does.
    runPrompt: (request) => runPrompt(request),
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

  // Anything asked in a browser, or typed here before the last shutdown, is caught up
  // once the window is up. Delayed a few seconds and capped inside chat-sync.js, so
  // the first frame, the tray and the automation catch-up all get there first.
  const startupSync = setTimeout(() => {
    backgroundSync(chatSync.syncAllThreads());
  }, STARTUP_SYNC_DELAY_MS);
  // A quit inside that window must not keep the process alive just for a sync.
  startupSync.unref();

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
