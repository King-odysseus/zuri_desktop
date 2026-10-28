/**
 * chat-sync.js - keeps a desktop thread and the account's cloud conversation the
 * same chat.
 *
 * The desktop keeps chats.json; the account keeps conversations. Without this the
 * two drift apart the moment somebody opens Zuri in a browser, and a question asked
 * on one side is invisible on the other. The rule here is deliberately blunt and
 * repeatable:
 *
 * 1. Push: upload the thread if the cloud has never seen it, then upload every
 *    message that carries no server id yet.
 * 2. Pull: append every server message whose id no local message already carries.
 * 3. Push once more, so a message that failed above, or one the pull brought in, is
 *    caught without a second pass.
 *
 * Every id the server hands out is written back onto the local record, which is what
 * makes a repeat run a no-op instead of a duplicate.
 *
 * Two things are true of every function here. Nothing throws into the caller: a
 * sync that cannot run (signed out, offline, account on its conversation limit) is a
 * result plus at most one log line, because it is called from the chat path and from
 * startup and neither may inherit a network error. And nothing here ever sees the
 * session token: the signed request is injected as `request`, which in the app is
 * main.js' cloudFetch, so one place keeps the base URL, the bearer header and the
 * abort timeout, and this module cannot leak a token into a log line.
 */

import { DEFAULT_CLOUD_MODEL, zuriModelCode } from './providers/cloud-chat.js';
import {
  UNTITLED_THREAD,
  appendSyncedMessage,
  listThreads,
  setMessageCloudId,
  setThreadCloudId,
} from './store.js';

/** Threads one run looks at, newest first, so a first sync is never a stampede. */
export const SYNC_THREAD_LIMIT = 5;

/**
 * Pause before the single retry. Long enough to cover a server restart or a machine
 * coming back from sleep, short enough that the run is still in the background.
 */
const RETRY_DELAY_MS = 400;

/** The code the cloud answers with when the conversation is not there any more. */
const NOT_FOUND_CODE = 'CONVERSATION_NOT_FOUND';

/**
 * Codes that mean "nothing to do right now" rather than "the sync is broken". Being
 * signed out or offline is the ordinary state of a laptop, so it is not logged: a
 * line per reply while travelling would bury every real error.
 */
const QUIET_CODES = new Set(['CLOUD_AUTH_REQUIRED', 'CLOUD_UNAVAILABLE']);

/** Codes that make the rest of this run pointless, so it stops after the first push. */
const STOP_CODES = new Set(['CLOUD_AUTH_REQUIRED', 'CLOUD_UNAVAILABLE', 'CLOUD_URL_INVALID', 'CONVERSATION_LIMIT']);

/**
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {unknown} value
 * @returns {string} The value when it is a non-blank string, otherwise ''.
 */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The conversation id a thread is linked to, or '' when it has never been uploaded.
 * @param {any} thread
 * @returns {string}
 */
function cloudIdOf(thread) {
  return textOf(thread?.cloud?.id);
}

/**
 * The objects in a thread's message list. A record that is not an object is skipped
 * rather than crashing the run: one corrupt entry must not stop the rest of the sync.
 * @param {any} thread
 * @returns {any[]}
 */
function messagesOf(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  return messages.filter((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
}

/**
 * Whether one stored message belongs in the account.
 *
 * A message marked `localOnly` carries an attachment: the file's own wording was
 * folded into its text when it was written, and so was the path it came from. That
 * stays on this machine. The reply to such a turn is marked the same way by the
 * store, because it quotes the file back, so a private document cannot reach the
 * account through the answer either.
 * @param {any} message
 * @returns {boolean}
 */
function isUploadable(message) {
  if (message?.localOnly === true) return false;
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  // A message with no local id could never be marked as uploaded, and one that is
  // already marked must not be sent twice.
  if (textOf(message.id) === '' || textOf(message.cloudId) !== '') return false;
  const content = typeof message.content === 'string' ? message.content : '';
  return content.trim() !== '';
}

/**
 * The endpoint for one conversation, or the collection when `cloudId` is ''.
 * @param {string} cloudId
 * @param {string} [suffix] Such as '/messages'.
 * @returns {string}
 */
function conversationPath(cloudId, suffix = '') {
  return cloudId === '' ? `/api/me/conversations${suffix}` : `/api/me/conversations/${encodeURIComponent(cloudId)}${suffix}`;
}

/**
 * Wait without keeping a reference that outlives the run.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The title the cloud copy carries. A thread nobody has named yet travels as the
 * same "New chat" the sidebar shows, so the browser lists it the way the desktop does.
 * @param {any} thread
 * @returns {string}
 */
function titleOf(thread) {
  return textOf(thread?.title) || UNTITLED_THREAD;
}

/**
 * The model code the cloud copy is filed under: the last reply that named one, read
 * from the end so a trailing user turn does not lose it, translated to a Zuri code
 * because the account answers in those and an older thread may name a supplier id.
 * @param {any} thread
 * @returns {string}
 */
function modelOf(thread) {
  const messages = messagesOf(thread);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const claimed = textOf(messages[index]?.model?.model);
    if (claimed !== '') return zuriModelCode({ model: claimed });
  }
  return DEFAULT_CLOUD_MODEL;
}

/**
 * Build a sync bound to one signed request function.
 *
 * @param {{
 *   request: (pathname: string, options?: object, requireSession?: boolean) => Promise<object>,
 *   log?: (line: string) => void,
 * }} options `request` has the shape of main.js' cloudFetch.
 * @returns {{
 *   syncThread: (threadId: string) => Promise<object>,
 *   syncAllThreads: (options?: { limit?: number }) => Promise<object>,
 *   deleteConversation: (cloudId: string) => Promise<object>,
 * }}
 */
export function createChatSync({ request, log = defaultLog } = {}) {
  if (typeof request !== 'function') throw new TypeError('createChatSync needs a request function like cloudFetch');

  /**
   * Threads with a sync already in flight. Two triggers (a reply landing and the
   * startup sweep) would otherwise both see the same message as unmarked and post it
   * twice, which is the one duplicate this design can still make on its own.
   * @type {Set<string>}
   */
  const inFlight = new Set();

  /** @param {string} line */
  function note(line) {
    log(`[zuri-cloud] ${line}`);
  }

  /**
   * One signed JSON call, retried once when the network itself was the problem.
   * @param {string} pathname
   * @param {{ method?: string, body?: string }} [options]
   * @returns {Promise<object>}
   */
  async function call(pathname, options = {}) {
    // The accept header and the bearer token are added by `request` itself, so only
    // what this call adds is named here.
    const signed = {
      method: options.method ?? 'GET',
      ...(options.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: options.body }),
    };

    const first = await request(pathname, signed, true);
    if (first?.ok === true) return first;
    // Only a call that never reached the server is worth repeating. A refusal is the
    // server's answer and would be the same answer a moment later.
    if (first?.error?.code !== 'CLOUD_UNAVAILABLE') return first;
    await pause(RETRY_DELAY_MS);
    return request(pathname, signed, true);
  }

  /**
   * @param {string} pathname
   * @param {object} body
   * @returns {Promise<object>}
   */
  function post(pathname, body) {
    return call(pathname, { method: 'POST', body: JSON.stringify(body) });
  }

  /**
   * Whether the app holds a cloud session at all.
   *
   * The token is read but never used here: cloudFetch attaches it, so this module has
   * nothing secret to leak. cloud-session.js is imported lazily because it reads
   * Electron's safeStorage as it loads, and this module has to be importable by a
   * plain node check as well (the same reason store.js requires Electron lazily).
   * @returns {Promise<boolean>}
   */
  async function signedIn() {
    try {
      const { readCloudSession } = await import('./cloud-session.js');
      const session = await readCloudSession();
      return session?.ok === true && textOf(session.data?.token) !== '';
    } catch {
      // Treating an unreadable session as "signed out" is the safe reading: the sync
      // does nothing rather than reporting a failure nobody can act on.
      return false;
    }
  }

  /**
   * Run one action so that no failure escapes this module.
   * @param {string} label What the log line is about.
   * @param {() => Promise<object>} action
   * @returns {Promise<object>} The action's own result, or a contained failure.
   */
  async function guarded(label, action) {
    try {
      const result = await action();
      if (result?.ok !== true && QUIET_CODES.has(result?.error?.code) === false) {
        note(`${label}: ${result?.error?.message ?? 'failed'}`);
      }
      return result;
    } catch (error) {
      note(`${label}: ${error?.message ?? 'unexpected failure'}`);
      return failure('CLOUD_SYNC_FAILED', 'The cloud sync could not run.');
    }
  }

  /**
   * Upload the conversation record if needed, then every message with no cloud id.
   * @param {any} thread
   * @param {{ created: boolean, pushed: number }} outcome Counted into the run report.
   * @returns {Promise<object>}
   */
  async function pushThread(thread, outcome) {
    let cloudId = cloudIdOf(thread);
    const uploadable = messagesOf(thread).filter(isUploadable);

    // A thread whose every message carries an attachment has nothing the account may
    // hold. Creating a conversation for it would spend one of the account's slots on
    // a chat the browser could never fill in, and would say "New chat" and nothing else.
    if (cloudId === '' && uploadable.length === 0) {
      return { ok: true, data: { cloudId: '', skipped: 'local-only' } };
    }

    if (cloudId === '') {
      const created = await post(conversationPath(''), {
        title: titleOf(thread),
        model: modelOf(thread),
        origin: 'desktop',
      });
      if (created.ok !== true) return created;

      cloudId = textOf(created.data?.conversation?.id);
      if (cloudId === '') return failure('CLOUD_CONVERSATION_INVALID', 'Zuri Cloud did not name the new conversation.');

      const linked = await setThreadCloudId(thread.id, cloudId);
      if (linked.ok !== true) return linked;
      // Kept in step in memory so the rest of this run uses the id without re-reading
      // chats.json, and a failed write above has already stopped us.
      thread.cloud = { id: cloudId };
      outcome.created = true;
    }

    for (const message of uploadable) {
      const content = typeof message.content === 'string' ? message.content : '';

      const pushed = await post(conversationPath(cloudId, '/messages'), { role: message.role, content });
      if (pushed.ok !== true) return pushed;

      const messageCloudId = textOf(pushed.data?.message?.id);
      // Without the id the server gave this message there is no way to recognise it
      // next run, so it would be uploaded again every time. Stop and say so.
      if (messageCloudId === '') return failure('CLOUD_MESSAGE_INVALID', 'Zuri Cloud did not name the saved message.');

      const marked = await setMessageCloudId(thread.id, message.id, messageCloudId);
      if (marked.ok !== true) return marked;
      message.cloudId = messageCloudId;
      outcome.pushed += 1;
    }

    return { ok: true, data: { cloudId } };
  }

  /**
   * Append whatever the account has that this machine has not seen yet.
   * @param {any} thread
   * @param {{ appended: number, forgotten: boolean }} outcome Counted into the run report.
   * @returns {Promise<object>}
   */
  async function pullThread(thread, outcome) {
    const cloudId = cloudIdOf(thread);
    const fetched = await call(conversationPath(cloudId));

    if (fetched.ok !== true) {
      // The conversation was deleted from another device. Forgetting the link is the
      // whole recovery: the next run uploads this thread as a new conversation,
      // instead of failing for ever against an id that no longer exists.
      if (fetched.error?.code === NOT_FOUND_CODE || fetched.status === 404) {
        const forgotten = await setThreadCloudId(thread.id, '');
        if (forgotten.ok !== true) return forgotten;
        // setThreadCloudId cleared the stored cloud ids; the in-memory copy is what
        // the rest of this run reads, so it is cleared here too.
        delete thread.cloud;
        for (const message of messagesOf(thread)) delete message.cloudId;
        outcome.forgotten = true;
        return { ok: true, data: { forgotten: true } };
      }
      return fetched;
    }

    const known = new Set();
    for (const message of messagesOf(thread)) {
      const id = textOf(message.cloudId);
      if (id !== '') known.add(id);
    }
    // A reply replaced by Regenerate is gone here but still in the account, which has
    // no way to delete one message. Counting it as known keeps it from coming back.
    for (const id of Array.isArray(thread.droppedCloudIds) ? thread.droppedCloudIds : []) {
      if (textOf(id) !== '') known.add(textOf(id));
    }

    const remote = Array.isArray(fetched.data?.messages) ? fetched.data.messages : [];
    for (const entry of remote) {
      const id = textOf(entry?.id);
      if (id === '' || known.has(id)) continue;
      if (entry.role !== 'user' && entry.role !== 'assistant') continue;
      const content = typeof entry.content === 'string' ? entry.content : '';
      // A blank turn would draw an empty bubble and the store refuses it anyway.
      if (content.trim() === '') continue;

      const appended = await appendSyncedMessage(thread.id, {
        role: entry.role,
        content,
        createdAt: entry.createdAt,
        cloudId: id,
      });
      if (appended.ok !== true) return appended;

      known.add(id);
      if (!Array.isArray(thread.messages)) thread.messages = [];
      thread.messages.push(appended.data.message);
      outcome.appended += 1;
    }

    return { ok: true, data: { forgotten: false } };
  }

  /**
   * Push, pull, push for one thread already read from the store.
   * @param {any} thread
   * @returns {Promise<object>}
   */
  async function syncOne(thread) {
    const outcome = {
      threadId: thread.id,
      created: false,
      pushed: 0,
      appended: 0,
      forgotten: false,
    };

    const first = await pushThread(thread, outcome);
    if (first.ok !== true && STOP_CODES.has(first.error?.code)) return first;

    // Nothing to pull until the thread has a conversation to read.
    if (cloudIdOf(thread) !== '') {
      const pulled = await pullThread(thread, outcome);
      if (pulled.ok !== true) return pulled;
    }

    // The conversation is gone and the thread has just been unlinked. Uploading the
    // whole thread again is the next run's job, not this one's.
    if (outcome.forgotten === true) return { ok: true, data: outcome };

    // A push that failed above is not returned here: the second push below retries the
    // very same unmarked messages, and its result describes where the thread actually
    // stands rather than where the first attempt stopped.

    const second = await pushThread(thread, outcome);
    // Offline is not worth a failure: the messages stay unmarked and go up on the next
    // trigger. Any other answer from the server is.
    if (second.ok !== true) return QUIET_CODES.has(second.error?.code) === true ? { ok: true, data: outcome } : second;

    return { ok: true, data: outcome };
  }

  /**
   * Sync one thread by id. Safe to call after every reply: a thread that is already
   * up to date costs one GET and no writes.
   * @param {string} threadId
   * @returns {Promise<object>}
   */
  async function syncThread(threadId) {
    return guarded('thread sync', async () => {
      if (typeof threadId !== 'string' || threadId === '') {
        return failure('CHAT_INVALID_THREAD', 'Which chat to sync was not given.');
      }
      // Signed out is not a failure, it is nothing to do: an unsigned-in desktop owns
      // no account to keep in step.
      if (!(await signedIn())) return { ok: true, data: { threadId, skipped: 'signed-out', pushed: 0, appended: 0 } };
      if (inFlight.has(threadId)) return { ok: true, data: { threadId, skipped: 'in-flight', pushed: 0, appended: 0 } };

      inFlight.add(threadId);
      try {
        const listed = await listThreads();
        if (listed.ok !== true) return listed;
        const thread = listed.data.find((entry) => entry?.id === threadId);
        // Deleted while this run was queued: there is nothing left to upload, and
        // saying so is not an error.
        if (!thread) return { ok: true, data: { threadId, skipped: 'missing', pushed: 0, appended: 0 } };
        return await syncOne(thread);
      } finally {
        inFlight.delete(threadId);
      }
    });
  }

  /**
   * Catch every stored thread up, a few at a time. Used at launch and after a sign-in,
   * where the person is not waiting for a particular chat.
   * @param {{ limit?: number }} [options]
   * @returns {Promise<object>}
   */
  async function syncAllThreads({ limit = SYNC_THREAD_LIMIT } = {}) {
    return guarded('thread sweep', async () => {
      const cap = Number.isInteger(limit) && limit > 0 ? limit : SYNC_THREAD_LIMIT;
      if (!(await signedIn())) return { ok: true, data: { threads: 0, pushed: 0, appended: 0, failed: 0, skipped: 'signed-out' } };

      const listed = await listThreads();
      if (listed.ok !== true) return listed;

      // Newest first, so the chat the person was last in is the first one caught up, but
      // a thread that has never been uploaded comes before one that is already in the
      // account: each launch then works through the backlog instead of spending every
      // run on the same handful of chats.
      // An empty thread is left out: it has nothing to send and would spend one of the
      // account's conversations saying so.
      const pending = listed.data
        .filter((thread) => Array.isArray(thread?.messages) && thread.messages.length > 0)
        // A stable sort, so each group keeps the newest-first order listThreads gave it.
        .sort((left, right) => (cloudIdOf(right) === '' ? 0 : 1) - (cloudIdOf(left) === '' ? 0 : 1))
        .slice(0, cap);

      const totals = { threads: 0, pushed: 0, appended: 0, failed: 0 };
      // One thread at a time on purpose: this runs behind the window, and sequential
      // calls keep the network and the store writes to a trickle on first launch.
      for (const thread of pending) {
        const result = await syncThread(thread.id);
        if (result.ok !== true) {
          // Nothing will work while the account is unreachable or signed out, so the
          // rest of the sweep is pointless; a bad answer from the server costs only the
          // thread it happened on.
          if (QUIET_CODES.has(result.error?.code) === true) break;
          totals.failed += 1;
          continue;
        }
        totals.threads += 1;
        totals.pushed += result.data?.pushed ?? 0;
        totals.appended += result.data?.appended ?? 0;
      }

      return { ok: true, data: totals };
    });
  }

  /**
   * Delete the cloud copy of a thread that has just been deleted here. Best effort:
   * the local chat is already gone, so a failure is one log line and nothing else.
   * @param {string} cloudId
   * @returns {Promise<object>}
   */
  async function deleteConversation(cloudId) {
    return guarded('conversation delete', async () => {
      const id = textOf(cloudId);
      if (id === '') return { ok: true, data: { deleted: false } };
      if (!(await signedIn())) return { ok: true, data: { deleted: false } };

      const deleted = await call(conversationPath(id), { method: 'DELETE' });
      if (deleted.ok !== true) {
        // Already gone is exactly what this call wanted to achieve.
        if (deleted.error?.code === NOT_FOUND_CODE || deleted.status === 404) return { ok: true, data: { deleted: false } };
        return deleted;
      }
      return { ok: true, data: { deleted: true } };
    });
  }

  return { syncThread, syncAllThreads, deleteConversation };
}

/**
 * One short line on the main process console, matching the [zuri-...] prefixes the
 * rest of main uses.
 * @param {string} line
 * @returns {void}
 */
function defaultLog(line) {
  console.error(line);
}
