/**
 * Preload bridge: the renderer's only route into the main process.
 *
 * CommonJS on purpose. A sandboxed preload cannot use ESM imports, and
 * package.json marks the rest of the project as ESM, so this one file stays
 * `require`-based and Electron loads it as CommonJS.
 *
 * Adding a channel means adding it to CHANNELS here and to HANDLERS in
 * main.js. scripts/selftest.js asserts the two lists are identical, so a
 * channel cannot be exposed without a handler or answered without being
 * exposed.
 *
 * A streaming reply and a workspace change are the two exceptions: tokens arrive
 * on the push channel `chat:stream` (`window.zuri.chat.onStream`) and a saved
 * file is announced on `state:changed` (`window.zuri.state.onChanged`). Neither
 * is invoked, so neither joins CHANNELS.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Every channel the renderer may reach. Nothing outside this list is exposed,
 * and `invoke` rejects before the call leaves the renderer.
 * @type {readonly string[]}
 */
const CHANNELS = Object.freeze([
  'zuri:app:info',
  'zuri:app:channels',
  'zuri:chats:list',
  'zuri:chats:create',
  'zuri:chats:delete',
  'zuri:chats:rename',
  'zuri:chats:move',
  'zuri:projects:list',
  'zuri:projects:create',
  'zuri:projects:update',
  'zuri:projects:delete',
  'zuri:chats:clear',
  'zuri:chats:append-message',
  'zuri:chat:send',
  'zuri:chat:stop',
  // The person's yes or no to a step the model wants to take in Act mode.
  'zuri:chat:approve',
  'zuri:skills:list',
  'zuri:skills:create',
  'zuri:skills:update',
  'zuri:skills:delete',
  'zuri:settings:get',
  'zuri:settings:save',
  'zuri:onboarding:complete',
  'zuri:settings:open-data-folder',
  'zuri:settings:addin-status',
  'zuri:settings:addin-install',
  'zuri:settings:addin-remove',
  'zuri:cloud:config',
  'zuri:cloud:sign-in',
  'zuri:cloud:sign-up',
  'zuri:cloud:sign-in-password',
  'zuri:cloud:forgot-password',
  'zuri:cloud:reset-password',
  'zuri:cloud:set-password',
  'zuri:cloud:account',
  'zuri:cloud:update-account',
  'zuri:cloud:plans',
  // Extra-usage packs and one-off purchases. A top-up adds tokens to the current
  // allowance without changing plan, so it is a separate channel from checkout.
  'zuri:cloud:topups',
  'zuri:cloud:topup',
  'zuri:cloud:checkout',
  'zuri:cloud:sign-out',
  'zuri:tasks:list',
  'zuri:tasks:create',
  'zuri:tasks:update',
  'zuri:tasks:delete',
  // The run card in the Context panel sums up the stored schedules and the runs
  // on record, so it reads the same files the scheduler writes.
  'zuri:automations:list',
  'zuri:automations:create',
  'zuri:automations:update',
  'zuri:automations:delete',
  'zuri:reminders:list',
  'zuri:reminders:create',
  'zuri:reminders:complete',
  'zuri:notifications:list',
  'zuri:files:list',
  'zuri:files:open',
  'zuri:files:reveal',
  'zuri:files:saveAs',
  'zuri:files:choose',
  'zuri:files:summarize',
  // The picture ladder the composer menu lists, and one picture drawn with a name
  // from it. Both are ordinary channels, so a typo here would leave the menu
  // empty rather than break the bridge.
  'zuri:images:models',
  // Asking for a picture: the renderer sends a prompt and a model code, never a
  // key; main calls the provider with the saved key and writes the file itself.
  'zuri:images:generate',
  // The image library: everything drawn on this computer, one picture read on
  // demand, and one deleted. Pictures are never kept in the cloud.
  'zuri:images:library',
  'zuri:images:read',
  'zuri:images:remove',
  // The tool registry, so the agents page ticks the tools that really exist rather
  // than trusting a copy kept in the renderer.
  'zuri:tools:list',
  // Running and stopping one Act step. A destructive tool still needs the
  // confirmed flag in its payload, so the renderer cannot start one on its own.
  'zuri:tools:run',
  'zuri:tools:cancel',
  // The quick-ask card is opened from the main window, and closed or handed back to
  // the main window from the card itself.
  'zuri:overlay:open',
  'zuri:overlay:hide',
  'zuri:overlay:open-main',
  // Dragging the card by its header: the renderer sends the pointer's travel and
  // main moves the window, because a transparent frameless window has no title bar
  // to drag and Chromium's app-region drag does not move one on Windows.
  'zuri:overlay:move-by',
]);

// `zuri:<area>:<action>`, per the project naming convention.
const CHANNEL_PATTERN = /^zuri:([a-z][a-z0-9]*):([a-zA-Z][a-zA-Z0-9-]*)$/;

// One-way channel main pushes reply tokens on. Deliberately not `zuri:`-prefixed:
// nothing invokes it, so it must not look like an entry in CHANNELS.
const STREAM_CHANNEL = 'chat:stream';

// One-way channel main pushes after it changes stored state, so a view can refresh
// without polling. Not `zuri:`-prefixed for the same reason as STREAM_CHANNEL.
const STATE_CHANGED_CHANNEL = 'state:changed';

// Generated namespaces must not overwrite keys the bridge already publishes.
const RESERVED_AREAS = new Set(['channels', 'invoke']);

/**
 * Call one channel in main. Anything outside CHANNELS never reaches main: the
 * returned promise rejects with an "Unknown IPC channel" error instead.
 * @param {string} channel
 * @param {unknown} [payload]
 * @returns {Promise<unknown>}
 */
async function invoke(channel, payload) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`Unknown IPC channel: ${channel}`);
  }
  return ipcRenderer.invoke(channel, payload);
}

/**
 * Turn a kebab action into a callable name: `mark-done` becomes `markDone`,
 * which stays a valid dot-accessed property on window.zuri.
 * @param {string} action
 * @returns {string}
 */
function toMethodName(action) {
  return action.replace(/-([a-zA-Z0-9])/g, (_match, next) => next.toUpperCase());
}

/**
 * Build `window.zuri`: the declared channel list, the guarded `invoke`, and one
 * namespace per channel area, so views call `window.zuri.app.info()`.
 * @returns {Record<string, unknown>}
 */
function createBridge() {
  const bridge = {
    channels: CHANNELS.slice(),
    invoke,
  };

  for (const channel of CHANNELS) {
    const match = CHANNEL_PATTERN.exec(channel);
    if (!match) throw new Error(`Channel does not match zuri:<area>:<action>: ${channel}`);
    const [, area, action] = match;
    if (RESERVED_AREAS.has(area)) throw new Error(`Channel area "${area}" collides with the bridge API`);
    bridge[area] ??= {};
    bridge[area][toMethodName(action)] = (payload) => invoke(channel, payload);
  }

  if (typeof bridge.chat?.send !== 'function') {
    throw new Error('chat:stream needs a zuri:chat:* channel in CHANNELS');
  }

  /**
   * Subscribe to reply tokens. Returns the unsubscribe function, so a view can
   * detach when it goes away instead of piling up listeners.
   * @param {(event: { threadId?: string, delta?: string, done?: boolean }) => void} listener
   * @returns {() => void}
   */
  bridge.chat.onStream = (listener) => {
    if (typeof listener !== 'function') throw new TypeError('chat.onStream expects a function');
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(STREAM_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(STREAM_CHANNEL, wrapped);
  };

  /**
   * Subscribe to changes main made to stored state, such as a file saved in the
   * workspace. Returns the unsubscribe function, like chat.onStream.
   * @param {(event: { area?: string, path?: string }) => void} listener
   * @returns {() => void}
   */
  bridge.state ??= {};
  bridge.state.onChanged = (listener) => {
    if (typeof listener !== 'function') throw new TypeError('state.onChanged expects a function');
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(STATE_CHANGED_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(STATE_CHANGED_CHANNEL, wrapped);
  };

  return bridge;
}

contextBridge.exposeInMainWorld('zuri', createBridge());
