/**
 * Chat threads in the shell: the sidebar conversation list and the transcript for
 * the active thread. The composer and the reply it asks for live in
 * `ui/composer.js`.
 *
 * Persistence belongs to the main process, so everything here goes through
 * `window.zuri.chats` and renders what comes back. Threads are held in memory in
 * the order the sidebar shows them (newest `updatedAt` first), which is the order
 * store.js returns, so a reload restores exactly what was saved.
 */

import { createComposer, createMessageElement, renderComposerControls, setComposerModel } from './composer.js';
import { createLoadingSkeleton } from './skeleton.js';

/** Placeholder title a thread carries until its first message names it. */
const UNTITLED_THREAD = 'New chat';

/** Text the context panel's empty block puts in the composer, ready to finish. */
const TASK_PROMPT = 'Create a task: ';

/**
 * Asked by the Tasks destination (views/tasks.js) when its one action is pressed.
 * A task is written by asking Zuri, so both entry points start the same request and
 * this module owns the composer that types it.
 */
export const TASK_REQUEST_EVENT = 'zuri:task-request';

/** Why the composer is inert in a plain browser preview: there is no route to main. */
const NO_BRIDGE_HINT = 'Replies need the desktop app.';

/**
 * The shape of a conversation that is being read (node 0:1221, loading state):
 * a reader turn, a reply with its mark, then what is being waited for.
 * Exported so the acceptance check can put this state on screen without waiting
 * for a cold start.
 * @returns {HTMLElement}
 */
export function createTranscriptSkeleton() {
  const skeleton = document.createElement('div');
  skeleton.className = 'transcript-skeleton';
  skeleton.setAttribute('role', 'status');

  const bar = (size) => {
    const element = document.createElement('span');
    element.className = 'transcript-skeleton-bar';
    element.dataset.size = size;
    return element;
  };

  const userTurn = document.createElement('div');
  userTurn.className = 'transcript-skeleton-turn';
  userTurn.dataset.role = 'user';
  userTurn.append(bar('meta'), bar('wide'), bar('short'));

  const assistantTurn = document.createElement('div');
  assistantTurn.className = 'transcript-skeleton-turn';
  assistantTurn.dataset.role = 'assistant';

  const avatar = document.createElement('span');
  avatar.className = 'transcript-skeleton-avatar';

  const lines = document.createElement('span');
  lines.className = 'transcript-skeleton-lines';
  lines.append(bar('name'), bar('wide'), bar('wide'), bar('short'));

  assistantTurn.append(avatar, lines);

  const note = document.createElement('p');
  note.className = 'transcript-skeleton-note';

  // The node's note carries a small still loader ahead of the words.
  const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spinner.setAttribute('class', 'transcript-skeleton-spinner');
  spinner.setAttribute('viewBox', '0 0 24 24');
  spinner.setAttribute('width', '14');
  spinner.setAttribute('height', '14');
  spinner.setAttribute('fill', 'none');
  spinner.setAttribute('stroke', 'currentColor');
  spinner.setAttribute('stroke-width', '2');
  spinner.setAttribute('stroke-linecap', 'round');
  spinner.setAttribute('aria-hidden', 'true');
  spinner.innerHTML = '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>';

  const words = document.createElement('span');
  words.textContent = 'Loading this conversation and its attachments...';
  note.append(spinner, words);

  skeleton.append(userTurn, assistantTurn, note);
  return skeleton;
}

/** Element ids the chat column and sidebar are wired by. */
const IDS = Object.freeze({
  list: 'thread-list',
  listEmpty: 'conversations-empty-state',
  newChat: 'new-chat-button',
  title: 'chat-title',
  meta: 'chat-meta',
  transcript: 'chat-transcript',
  hero: 'chat-empty-hero',
  stream: 'chat-stream-status',
  streamLabel: 'chat-stream-label',
  streamStop: 'chat-stream-stop',
  composer: 'composer-shell',
  input: 'composer-input',
  send: 'composer-send',
  hint: 'composer-hint',
  emptyAction: 'reminders-empty-action',
  errorBlock: 'chat-error-block',
  errorRetry: 'chat-error-retry',
});

/**
 * Find every element this module owns, or throw naming the one that is missing.
 * A missing node is a markup bug and must be loud: a silent no-op here would look
 * like working chat that never saves anything.
 * @returns {Record<string, HTMLElement>}
 */
function collectElements() {
  /** @type {Record<string, HTMLElement>} */
  const elements = {};
  const missing = [];

  for (const [name, id] of Object.entries(IDS)) {
    const element = document.getElementById(id);
    if (element) elements[name] = element;
    else missing.push(`#${id}`);
  }

  if (missing.length > 0) {
    throw new Error(`index.html is missing ${missing.join(', ')}`);
  }
  return elements;
}

/**
 * Newest first, mirroring store.js. Sorting again here keeps the list correct when
 * a thread is updated locally without a round trip to main.
 * @param {{ updatedAt?: string, createdAt?: string }} left
 * @param {{ updatedAt?: string, createdAt?: string }} right
 * @returns {number}
 */
function byNewest(left, right) {
  const byUpdate = String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''));
  if (byUpdate !== 0) return byUpdate;
  return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''));
}

/**
 * Short label for how long ago something happened, in the sidebar's space.
 * @param {string} iso ISO 8601 timestamp from the store.
 * @returns {string}
 */
function formatWhen(iso) {
  const then = Date.parse(iso ?? '');
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;

  return new Date(then).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Build the chat workspace over the markup in index.html.
 * @param {Record<string, HTMLElement>} elements
 * @param {Record<string, Function>} api The `window.zuri.chats` namespace.
 * @param {Record<string, Function>} [chatApi] The `window.zuri.chat` namespace.
 * @param {Record<string, Function>} [settingsApi] The `window.zuri.settings` namespace.
 * @returns {{ selectThread: Function, createNewChat: Function, send: Function, reload: Function }}
 */
function createWorkspace(elements, api, chatApi, settingsApi = null) {
  /** @type {{ threads: any[], activeId: string | null }} */
  const state = { threads: [], activeId: null };

  /** The hint line as index.html ships it, restored after a transient error. */
  const defaultHint = elements.hint.textContent;

  /**
   * Call one bridge method and turn a rejected call into the same failed-result
   * shape main uses. A channel error must mark the UI, not take the window down.
   * @param {() => Promise<any>} thunk
   * @returns {Promise<{ ok: boolean, data?: any, error?: { code?: string, message?: string } }>}
   */
  async function call(thunk) {
    try {
      return await thunk();
    } catch (error) {
      return { ok: false, error: { message: String(error?.message ?? error) } };
    }
  }

  /**
   * @param {string} id
   * @returns {any | undefined}
   */
  const threadById = (id) => state.threads.find((thread) => thread?.id === id);

  /**
   * The thread the transcript is showing, if any.
   * @returns {any | null}
   */
  function activeThread() {
    return threadById(state.activeId) ?? null;
  }

  /**
   * One line of feedback under the composer. Used for store failures, so the user
   * learns the message was not saved instead of watching it disappear.
   * @param {string} message
   */
  function report(message) {
    elements.hint.textContent = message;
    elements.hint.dataset.state = 'error';
  }

  /** @returns {void} */
  function clearReport() {
    if (elements.hint.dataset.state !== 'error') return;
    elements.hint.textContent = defaultHint;
    delete elements.hint.dataset.state;
  }

  /**
   * @param {any} thread
   * @returns {HTMLButtonElement}
   */
  function threadRow(thread) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'thread-row';
    row.dataset.threadId = thread.id;

    if (thread.id === state.activeId) {
      row.dataset.active = 'true';
      row.setAttribute('aria-current', 'true');
    }

    const title = document.createElement('span');
    title.className = 'thread-row-title';
    title.textContent = thread.title || UNTITLED_THREAD;
    // The row truncates; the tooltip carries the whole title.
    title.title = title.textContent;

    const when = document.createElement('span');
    when.className = 'thread-row-time';
    when.textContent = formatWhen(thread.updatedAt);

    row.append(title, when);
    row.addEventListener('click', () => selectThread(thread.id));
    return row;
  }

  /** Draw the conversation list from `state.threads`. */
  function renderSidebar() {
    state.threads.sort(byNewest);
    elements.list.replaceChildren(...state.threads.map(threadRow));

    const isEmpty = state.threads.length === 0;
    elements.list.dataset.state = isEmpty ? 'empty' : 'filled';
    elements.listEmpty.hidden = !isEmpty;
  }

  /**
   * Show one thread's messages. The empty hero stays in the document so the chat
   * column never loses its blank state; it is only hidden.
   * @param {any | null} thread
   */
  function renderTranscript(thread) {
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];

    for (const node of elements.transcript.querySelectorAll('.message')) {
      node.remove();
    }
    elements.transcript.querySelector('.transcript-skeleton')?.remove();
    elements.transcript.append(...messages.map((message) => createMessageElement(message)));
    // The streaming row belongs after the last message, whatever the order the
    // transcript was last in; leaving it parked mid-thread would read as a turn.
    elements.transcript.append(elements.stream);

    const isEmpty = messages.length === 0;
    elements.hero.hidden = !isEmpty;
    elements.transcript.dataset.state = isEmpty ? 'empty' : 'filled';
    syncTranscriptMeta();
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }

  /**
   * Whether Zuri's newest turn is a failure, which is when the node offers its
   * retry prompt in the composer ("Try again, or switch model…"). Counted from the
   * newest assistant row, so a person's follow-up turn does not hide the failure.
   * @returns {boolean}
   */
  function lastReplyFailed() {
    const replies = elements.transcript.querySelectorAll(".message[data-role='assistant']");
    const last = replies[replies.length - 1];
    return last?.dataset.state === 'failed';
  }

  /**
   * The line beside the title (node 0:1221): how many turns are here, and what
   * the last one is doing. Counted from the transcript itself so it cannot drift
   * from the rows on screen while a reply streams.
   * @returns {void}
   */
  function syncTranscriptMeta() {
    const rows = elements.transcript.querySelectorAll('.message');
    const count = rows.length;
    if (count === 0) {
      elements.meta.textContent = 'No messages yet';
      return;
    }

    const last = rows[count - 1];
    let text = `${count} ${count === 1 ? 'message' : 'messages'}`;
    if (elements.transcript.querySelector(".message[data-state='streaming']")) text += ' · streaming';
    else if (last?.dataset.state === 'failed') text += ' · reply failed';
    elements.meta.textContent = text;
  }

  /**
   * Stand the transcript's loading state in until the first list() answers, so a
   * cold start never looks like an empty conversation that lost its history.
   * @returns {void}
   */
  function showTranscriptSkeleton() {
    // Only the first read needs it: once turns are on screen a reload keeps them
    // there rather than blanking the column under the person's eyes.
    if (elements.transcript.querySelector('.message, .transcript-skeleton')) return;
    elements.hero.hidden = true;
    elements.transcript.dataset.state = 'filled';
    elements.meta.textContent = 'Loading conversation…';
    elements.transcript.append(createTranscriptSkeleton());
  }

  /**
   * Take the thread main just returned as the current copy of it: the store owns
   * `updatedAt` and the title it derives from the first message.
   * @param {any} thread
   */
  function applyThread(thread) {
    if (!thread || typeof thread.id !== 'string') return;

    const index = state.threads.findIndex((entry) => entry?.id === thread.id);
    if (index === -1) state.threads.push(thread);
    else state.threads[index] = thread;

    if (thread.id === state.activeId) {
      elements.title.textContent = thread.title || UNTITLED_THREAD;
    }
    renderSidebar();
  }

  /**
   * Show one thread in the transcript and highlight its row.
   * @param {string} id
   */
  function selectThread(id) {
    const thread = threadById(id);
    if (!thread) return;

    state.activeId = id;
    elements.title.textContent = thread.title || UNTITLED_THREAD;
    renderSidebar();
    renderTranscript(thread);
    elements.input.focus();
  }

  /**
   * Create a thread in main and select it. Creating here rather than on the first
   * send is what puts the record in chats.json the moment the user asks for a chat.
   * @returns {Promise<any | null>}
   */
  async function createNewChat() {
    const active = activeThread();
    // Already sitting in a chat with nothing in it: selecting it again is what the
    // user asked for, and a second empty record would only clutter the sidebar.
    if (active && Array.isArray(active.messages) && active.messages.length === 0) {
      selectThread(active.id);
      return active;
    }

    const created = await call(() => api.create({}));
    if (!created?.ok) {
      report(created?.error?.message ?? 'A new chat could not be saved.');
      return null;
    }

    state.threads.push(created.data);
    selectThread(created.data.id);
    clearReport();
    return created.data;
  }

  /**
   * The thread to append to, creating one when the window opened with none.
   * @returns {Promise<any | null>}
   */
  async function ensureThread() {
    const active = activeThread();
    if (active) return active;

    const created = await call(() => api.create({}));
    if (!created?.ok) {
      report(created?.error?.message ?? 'A new chat could not be saved.');
      return null;
    }

    state.threads.push(created.data);
    selectThread(created.data.id);
    return created.data;
  }

  /**
   * Stand the design's loading skeleton in for the thread list until list()
   * answers, so a cold start shows the panel filling rather than a blank sidebar.
   * One block, because the node is a single placeholder card; renderSidebar()
   * replaces it outright once the threads are known.
   */
  function showSidebarSkeleton() {
    elements.list.dataset.state = 'loading';
    elements.listEmpty.hidden = true;
    elements.list.replaceChildren(createLoadingSkeleton('Loading conversations'));
  }

  /**
   * Read every stored thread and restore the most recent one, which is the chat the
   * user was last in. A read failure leaves the empty states alone and says so.
   * @returns {Promise<void>}
   */
  async function reload() {
    showSidebarSkeleton();
    showTranscriptSkeleton();

    const listed = await call(() => api.list());
    if (!listed?.ok) {
      // The skeletons would otherwise stand there for good, pretending the read is
      // still running: put both columns back to their empty states and report.
      renderSidebar();
      renderTranscript(null);
      report(listed?.error?.message ?? 'Your chats could not be read.');
      return;
    }

    state.threads = Array.isArray(listed.data) ? listed.data.slice() : [];
    const newest = state.threads.slice().sort(byNewest)[0];
    if (newest) {
      selectThread(newest.id);
      return;
    }
    renderSidebar();
    // Nothing to open, so the transcript has to leave its loading state for the
    // empty one; otherwise a first launch sits on a skeleton that never resolves.
    renderTranscript(null);
  }

  const composer = createComposer({
    elements,
    chats: api,
    chat: chatApi,
    ensureThread,
    currentThread: activeThread,
    applyThread,
    report,
    clearReport,
    refreshMeta: syncTranscriptMeta,
    lastReplyFailed,
  });

  // The model chip is the composer's to draw, but the choice belongs in settings, and
  // this is where a failed write can be reported under the pill like every other one.
  elements.composer.addEventListener('composer-model', async (event) => {
    if (typeof settingsApi?.save !== 'function') return;
    const model = event.detail?.value ?? '';
    const saved = await call(() => settingsApi.save({ model }));
    if (!saved?.ok) {
      report(saved?.error?.message ?? 'That model choice was not saved.');
      return;
    }
    // The bar names the model in use, so it has to move with the pill or the two
    // would disagree about what the next send is going to ask.
    const chip = document.querySelector('.top-bar-model-name');
    if (chip && model !== '') chip.textContent = model;
  });

  // The pill starts on the saved model. A failed read leaves the adapter's default
  // showing, which is what a send would use anyway.
  if (typeof settingsApi?.get === 'function') {
    call(() => settingsApi.get()).then((settings) => {
      if (settings?.ok) setComposerModel(elements, settings.data?.model);
    });
  }

  elements.newChat.addEventListener('click', () => {
    createNewChat();
  });

  // The empty block's action is a task request, and tasks are written by asking
  // Zuri: it opens a chat with the request begun rather than a dead control.
  // The Tasks view asks for the same thing through TASK_REQUEST_EVENT, so a task
  // request behaves one way wherever it is started.
  async function startTaskRequest() {
    const thread = await createNewChat();
    // A failed create is already reported under the composer; do not type into a
    // transcript that has nothing to save to.
    if (!thread) return;
    elements.input.value = TASK_PROMPT;
    composer.sync();
    elements.input.focus();
  }

  elements.emptyAction.addEventListener('click', startTaskRequest);
  window.document.addEventListener(TASK_REQUEST_EVENT, startTaskRequest);

  elements.send.addEventListener('click', () => {
    composer.send();
  });

  // Stop ends the reply that is arriving (node 0:823). It only means anything while
  // the streaming row is up, and the composer owns that state.
  elements.streamStop.addEventListener('click', () => {
    composer.stop();
  });

  // The error block's Retry repeats the request that did not come back. It lives
  // outside the composer, so it drives the same send path rather than a second one.
  elements.errorRetry.addEventListener('click', () => {
    composer.retry();
  });

  // A failed reply carries its own Retry inside the transcript (node 0:1221), so
  // one listener on the column covers every failure card, including old ones.
  elements.transcript.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.message-retry')) {
      composer.retry();
    }
  });

  // The empty state's four openings are real prompts: pressing one puts it in the
  // composer rather than sending it, so it can be edited first.
  for (const suggestion of elements.hero.querySelectorAll('[data-suggestion]')) {
    suggestion.addEventListener('click', () => {
      elements.input.value = suggestion.dataset.suggestion ?? '';
      composer.sync();
      elements.input.focus();
    });
  }

  elements.input.addEventListener('input', composer.sync);
  elements.input.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter keeps a line break: the composer stays a textarea so
    // a multi-line prompt is still possible.
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    composer.send();
  });

  renderSidebar();
  // The header must not open blank: the node names the count from the first paint,
  // before any thread has been rendered into the column.
  syncTranscriptMeta();
  composer.sync();

  return { selectThread, createNewChat, send: () => composer.send(), reload };
}

/**
 * Paint the composer's disabled state for a window that cannot send at all.
 *
 * A plain browser preview has no preload bridge, so the honest shell is one that
 * says so up front (design node 0:823: the inert composer) rather than an input
 * that swallows every message.
 * @param {Record<string, HTMLElement>} elements
 * @returns {void}
 */
function markComposerUnavailable(elements) {
  elements.composer.dataset.state = 'disabled';
  elements.input.disabled = true;
  elements.input.setAttribute('aria-disabled', 'true');
  elements.send.disabled = true;
  elements.send.setAttribute('aria-disabled', 'true');
  // Nothing has been typed yet, so the line names why rather than what was lost.
  elements.hint.textContent = NO_BRIDGE_HINT;
}

/**
 * The states the chat page draws (pages.md: empty, loading, streaming, error,
 * disabled). Streaming is the reply in flight, drawn inside the transcript, so the
 * four a reviewer can hold still are named here.
 */
export const CHAT_STATES = Object.freeze(['empty', 'loading', 'error', 'disabled']);

/**
 * Hold one of the page's states on screen, for ?state= in the query string.
 *
 * Loading is a real state of the page, but it lasts only as long as the disk read
 * that fills it in, so a reviewer opening the page after boot would never see it.
 * Naming it here keeps the skeleton up until the next navigation. The states are
 * painted from the markup nodes, so this works with or without the preload bridge.
 * @param {Record<string, HTMLElement>} elements
 * @param {string} name
 * @returns {boolean} whether the name is one of this page's states
 */
export function showState(elements, name) {
  if (!CHAT_STATES.includes(name)) return false;

  if (name === 'loading') {
    // One state on screen at a time: the always-on error card would read as a failed
    // load rather than a load in progress.
    if (elements.errorBlock) elements.errorBlock.hidden = true;
    elements.list.dataset.state = 'loading';
    elements.listEmpty.hidden = true;
    elements.list.replaceChildren(createLoadingSkeleton('Loading conversations'));
    elements.hero.hidden = true;
    elements.transcript.dataset.state = 'loading';
    elements.transcript.querySelector('.transcript-skeleton')?.remove();
    elements.transcript.append(createTranscriptSkeleton());
    return true;
  }

  if (name === 'empty') {
    if (elements.errorBlock) elements.errorBlock.hidden = true;
    elements.list.replaceChildren();
    elements.list.dataset.state = 'empty';
    elements.listEmpty.hidden = false;
    elements.hero.hidden = false;
    elements.transcript.dataset.state = 'empty';
    for (const node of elements.transcript.querySelectorAll('.message')) node.remove();
    elements.transcript.querySelector('.transcript-skeleton')?.remove();
    return true;
  }

  if (name === 'error') {
    // The block above the composer is the drawn error state; the hero has to step
    // back so two invitations are not talking over each other.
    if (elements.errorBlock) elements.errorBlock.hidden = false;
    elements.hero.hidden = true;
    elements.transcript.dataset.state = 'filled';
    return true;
  }

  // disabled: the design's inert composer and status row while a reply is in flight.
  if (elements.errorBlock) elements.errorBlock.hidden = true;
  elements.composer.dataset.state = 'disabled';
  elements.input.disabled = true;
  elements.input.setAttribute('aria-disabled', 'true');
  elements.send.disabled = true;
  elements.send.setAttribute('aria-disabled', 'true');
  elements.hint.textContent = 'Zuri is working, wait for it to finish…';
  elements.stream.hidden = false;
  elements.transcript.append(elements.stream);
  return true;
}

/**
 * Start the chat workspace. Safe to call in a plain browser preview, where the
 * preload bridge does not exist: the markup keeps its empty states, the composer
 * shows its disabled state, and nothing is wired.
 * @param {any} [bridge] Defaults to `window.zuri`.
 * @returns {Promise<ReturnType<typeof createWorkspace> | null>}
 */
export async function initChats(bridge = window.zuri) {
  const elements = collectElements();
  // The pill's model and mode selectors are markup-level, so they are mounted even
  // with no bridge: the preview then shows the composer the app actually uses.
  renderComposerControls(elements);

  const api = bridge?.chats;
  let workspace = null;

  if (!api) {
    markComposerUnavailable(elements);
  } else {
    workspace = createWorkspace(elements, api, bridge?.chat, bridge?.settings);
    await workspace.reload();
  }

  // KAI reads this to know which states the page draws; ?state= then holds one on
  // screen, so the loading skeleton is there to be reviewed instead of gone.
  window.__KAI_STATES__ = [...CHAT_STATES];
  const wanted = new URLSearchParams(window.location.search).get('state');
  if (wanted !== null) showState(elements, wanted);

  return workspace;
}
