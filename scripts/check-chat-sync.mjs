/**
 * check-chat-sync.mjs - runs the real desktop sync against a stand-in account.
 *
 * chat-sync.js takes its signed request as an argument, so the sync can be driven
 * without a server, a session or a network. That matters because the parts most
 * likely to break in the field are the ones a live run would only reach by luck:
 * a second sync on an unchanged thread, a reply that arrives from the browser, and
 * a cloud thread that was deleted while the app was closed.
 *
 * Run via: npm run sync:check
 */

import { app } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createChatSync } from '../src/main/chat-sync.js';
import { readCloudSession, writeCloudSession } from '../src/main/cloud-session.js';
import { appendMessage, createThread, deleteThread, listThreads, removeTrailingReply, setStoreRoot } from '../src/main/store.js';

let failures = 0;

/**
 * @param {boolean} condition
 * @param {string} label
 * @param {string} [detail]
 */
function check(condition, label, detail = '') {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${label}${detail === '' ? '' : ` - ${detail}`}`);
}

/**
 * A stand-in for the account: it keeps conversations in memory and answers exactly
 * the shapes the server does, including the 404 a deleted conversation gives.
 */
function fakeAccount() {
  let serial = 0;
  let olderServer = false;
  let deletesRefused = false;
  const conversations = new Map();

  return {
    conversations,
    /** True makes the account answer like a server that predates the delete-message route. */
    setOlderServer(value) {
      olderServer = value === true;
    },
    /** True makes every delete fail, the way an unreachable account would. */
    refuseDeletes(value) {
      deletesRefused = value === true;
    },
    /** @param {string} pathname @param {object} [options] */
    async request(pathname, options = {}) {
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : {};
      const id = (pathname.match(/^\/api\/me\/conversations\/([^/]+)/) ?? [])[1];
      const isMessagePost = pathname.endsWith('/messages') && method === 'POST';

      if (method === 'POST' && !id) {
        if (conversations.size >= 200) {
          return { ok: false, error: { code: 'CONVERSATION_LIMIT', message: 'Too many chats.' } };
        }
        serial += 1;
        const created = { id: `cloud-${serial}`, title: body.title ?? 'New chat', model: body.model, origin: body.origin, messages: [] };
        conversations.set(created.id, created);
        return { ok: true, data: { conversation: created } };
      }

      // The account's own list, which is what the desktop reads to find the chats it has
      // never seen. Shaped as the server shapes it: a count of turns, never the turns.
      if (method === 'GET' && !id) {
        const rows = [...conversations.values()]
          .map((row) => ({
            id: row.id,
            title: row.title,
            model: row.model,
            origin: row.origin,
            messageCount: row.messages.length,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }))
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
        return { ok: true, data: { conversations: rows } };
      }

      const found = id ? conversations.get(id) : null;
      if (!found) {
        return { ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'That chat does not exist.' } };
      }

      if (method === 'GET') {
        return { ok: true, data: { conversation: found, messages: found.messages } };
      }

      const messageId = (pathname.match(/\/messages\/([^/]+)$/) ?? [])[1];
      if (method === 'DELETE' && messageId) {
        // An older server has no such route and answers the generic not-found.
        if (olderServer) return { ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } };
        const at = found.messages.findIndex((message) => message.id === messageId);
        if (at === -1) return { ok: false, error: { code: 'MESSAGE_NOT_FOUND', message: 'That message does not exist.' } };
        found.messages.splice(at, 1);
        return { ok: true, data: { deleted: true } };
      }

      if (isMessagePost) {
        serial += 1;
        const message = { id: `msg-${serial}`, role: body.role, content: body.content, createdAt: new Date().toISOString() };
        found.messages.push(message);
        return { ok: true, data: { message, conversation: found } };
      }

      if (method === 'DELETE') {
        if (deletesRefused) return { ok: false, error: { code: 'CLOUD_UNAVAILABLE', message: 'Zuri Cloud cannot be reached.' } };
        conversations.delete(id);
        return { ok: true, data: { deleted: true } };
      }

      return { ok: true, data: { conversation: found } };
    },

    /** A reply written in the browser, which the desktop has never seen. */
    addFromBrowser(cloudId, content) {
      const found = conversations.get(cloudId);
      serial += 1;
      const message = { id: `msg-${serial}`, role: 'assistant', content, createdAt: new Date().toISOString() };
      found.messages.push(message);
      return message;
    },

    /**
     * A whole conversation written in the browser: in the account, unknown to this
     * machine, which is exactly the chat the desktop used to miss for ever.
     * @param {string} title
     * @param {{ role: string, content: string }[]} [turns]
     */
    startOnWeb(title, turns = []) {
      serial += 1;
      const createdAt = new Date().toISOString();
      const conversation = { id: `cloud-${serial}`, title, model: 'zuri-flash', origin: 'web', messages: [], createdAt, updatedAt: createdAt };
      for (const turn of turns) {
        serial += 1;
        conversation.messages.push({ id: `msg-${serial}`, role: turn.role, content: turn.content, createdAt: new Date().toISOString() });
      }
      conversations.set(conversation.id, conversation);
      return conversation;
    },
  };
}

/** @returns {Promise<any[]>} The stored threads, whatever shape the store answered in. */
async function storedThreads() {
  const listed = await listThreads();
  const rows = Array.isArray(listed) ? listed : listed?.data;
  return Array.isArray(rows) ? rows : [];
}

/** @param {string} root */
async function seedThread(root) {
  const thread = {
    id: 'thread-1',
    title: 'Plan the launch',
    createdAt: '2026-10-25T08:00:00.000Z',
    updatedAt: '2026-10-25T08:01:00.000Z',
    messages: [
      { id: 'local-1', role: 'user', content: 'Plan the launch', createdAt: '2026-10-25T08:00:00.000Z' },
      { id: 'local-2', role: 'assistant', content: 'Start with a date.', createdAt: '2026-10-25T08:01:00.000Z', model: { provider: 'openai', model: 'gpt-4o' } },
    ],
  };
  await fs.writeFile(path.join(root, 'chats.json'), JSON.stringify([thread], null, 2));
}

async function main() {
  // The browser chat is the Android app too, so whatever the desktop offers a chat
  // model has to be offered there. Reading the source is the honest check: the file
  // is not loaded by this harness, but a tool that vanishes from the list is a
  // regression the person would feel as Zuri refusing to do something it can do.
  const chatView = await fs.readFile(path.join('web/src/views/ChatView.jsx'), 'utf8');
  // A tool nobody is told to use goes unused, which is what happened first: the
  // browser had a search tool and still answered from memory. Both apps have to say
  // when to reach for it, and the same sentence has to be in both or they answer
  // differently about the same question.
  const serverResearch = await fs.readFile(path.join('server/src/text.js'), 'utf8');
  const desktopChat = await fs.readFile(path.join('src/main/providers/chat.js'), 'utf8');
  const marker = 'Decide for yourself when to search';
  check(serverResearch.includes(marker), 'the server prompt says to search without being asked');
  check(desktopChat.includes(marker), 'the desktop prompt says to search without being asked');
  check(
    serverResearch.includes('ask one short question'),
    'both apps tell the model when to search, and to ask one question when the ask is vague',
  );

  check(chatView.includes('const CREATE_TASK_TOOL'), 'the browser chat offers the task tool');
  check(chatView.includes('const CREATE_REMINDER_TOOL'), 'the browser chat offers the reminder tool');
  check(chatView.includes('const CREATE_AUTOMATION_TOOL'), 'the browser chat offers the automation tool');
  check(chatView.includes('const CREATE_MEMORY_TOOL'), 'the browser chat offers the memory tool');
  check(chatView.includes('const WEB_SEARCH_TOOL'), 'the browser chat offers the search tool');
  check(
    chatView.includes('[WEB_SEARCH_TOOL, CREATE_TASK_TOOL, CREATE_REMINDER_TOOL, CREATE_AUTOMATION_TOOL, CREATE_MEMORY_TOOL]'),
    'the browser chat offers the same tools to a chat model',
  );

  // The sync refuses to run when nobody is signed in, and a real session is only
  // readable with the app's own encryption, so this runs inside Electron for the
  // same reason firstrun.js does.
  await app.whenReady();

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-sync-check-'));
  setStoreRoot(root);
  await seedThread(root);

  const session = await writeCloudSession('sync-check-token', '', root);
  const stored = await readCloudSession(root);
  if (session?.ok !== true || stored?.data?.token !== 'sync-check-token') {
    // No keyring on this machine: the signed-in paths cannot be reached, and saying
    // so is better than reporting a pass for work that never ran.
    console.log(`SKIP chat sync - a session cannot be stored here (${session?.error?.code ?? 'unknown'})`);

  await fs.rm(root, { recursive: true, force: true });
    app.quit();
    return;
  }

  const account = fakeAccount();
  const chatSync = createChatSync({ request: account.request, log: () => {} });

  // First run: the thread is uploaded and every local message gains a server id.
  const first = await chatSync.syncThread('thread-1');
  check(first?.ok === true, 'the first sync reports success');
  check(account.conversations.size === 1, 'the thread created one cloud conversation', `saw ${account.conversations.size}`);
  const [cloud] = [...account.conversations.values()];
  check(cloud?.messages.length === 2, 'both local messages were uploaded', `saw ${cloud?.messages.length}`);
  check(cloud?.origin === 'desktop', 'the conversation is filed as coming from the desktop', String(cloud?.origin));
  check(cloud?.model === 'zuri-flash', 'a supplier id in the thread is filed under its Zuri code', String(cloud?.model));

  let [local] = await storedThreads();
  check(local?.cloud?.id === cloud?.id, 'the thread remembers the cloud conversation', String(local?.cloud?.id));
  check(local?.messages.every((message) => typeof message.cloudId === 'string' && message.cloudId !== ''), 'every uploaded message kept its server id');

  // Second run on an unchanged thread must add nothing.
  await chatSync.syncThread('thread-1');
  check(cloud.messages.length === 2, 'a repeat sync uploads no duplicates', `saw ${cloud.messages.length}`);

  // A reply written in the browser arrives on the desktop.
  account.addFromBrowser(cloud.id, 'Pick the third of November.');
  const pullRun = await chatSync.syncThread('thread-1');
  [local] = await storedThreads();
  const pulled = local.messages.find((message) => message.content === 'Pick the third of November.');
  check(Boolean(pulled), 'a reply written in the browser is pulled into the desktop thread');
  check(pulled?.cloudId === cloud.messages.at(-1).id, 'the pulled message carries the server id, so it is never sent back');
  // The count is what tells the window to re-read the open chat: main.js announces a
  // change only when this is above zero, so a pull that reported nothing would leave
  // the answer invisible until the chat was reopened.
  check(pullRun?.data?.appended === 1, 'a pull reports the message it added, so the window can refresh', `saw ${pullRun?.data?.appended}`);

  await chatSync.syncThread('thread-1');
  check(cloud.messages.length === 3, 'pulling a message does not push it back as a new one', `saw ${cloud.messages.length}`);

  // The chat is deleted in the browser while the app was closed. Re-creating it at
  // launch would resurrect a chat the person deliberately removed, so the run only
  // forgets the link; the chat comes back when it is actually used again.
  account.conversations.delete(cloud.id);
  const afterDelete = await chatSync.syncThread('thread-1');
  check(afterDelete?.ok === true, 'a deleted cloud conversation is not reported as a failure', JSON.stringify(afterDelete?.error ?? null));
  check(account.conversations.size === 0, 'a chat deleted in the browser is not resurrected at launch', `saw ${account.conversations.size}`);
  [local] = await storedThreads();
  check(!local?.cloud?.id, 'the dead link is forgotten so the next sync starts a fresh copy', String(local?.cloud?.id));

  // The next thing said in that thread starts a new cloud copy of it.
  await appendMessage('thread-1', { id: 'local-3', role: 'user', content: 'Still planning the launch' });
  await chatSync.syncThread('thread-1');
  check(account.conversations.size === 1, 'the next reply re-creates the chat under a new cloud conversation', `saw ${account.conversations.size}`);
  const [recreated] = [...account.conversations.values()];
  [local] = await storedThreads();
  check(
    recreated?.messages.length === local.messages.length,
    'the re-created chat carries the whole thread, not just the new reply',
    `cloud ${recreated?.messages.length} vs local ${local.messages.length}`,
  );
  // Signed out is quiet: no failure surfaced and nothing written.
  const signedOut = createChatSync({
    request: async () => ({ ok: false, error: { code: 'CLOUD_AUTH_REQUIRED', message: 'Sign in to use the cloud.' } }),
    log: () => {},
  });
  const quiet = await signedOut.syncThread('thread-1');
  check(quiet?.ok === false, 'a signed-out sync reports a result rather than throwing');
  check(quiet?.error?.code === 'CLOUD_AUTH_REQUIRED', 'the signed-out result keeps the reason', String(quiet?.error?.code));

  // A request that throws must not escape into the chat path.
  const broken = createChatSync({
    request: async () => {
      throw new Error('network down');
    },
    log: () => {},
  });
  let threw = null;
  let brokenResult = null;
  try {
    brokenResult = await broken.syncThread('thread-1');
  } catch (error) {
    threw = error;
  }
  check(threw === null, 'a throwing request does not escape as an exception', String(threw?.message ?? ''));
  check(brokenResult?.ok === false, 'a throwing request is turned into a failure result');

  // An attachment stays on the machine that opened it. The file's own wording is
  // folded into the message text, and so is the path it came from, so neither may
  // reach the account; the answer to such a turn is kept back for the same reason.
  const privateThread = await createThread({ title: 'Private budget' });
  const privateId = privateThread?.data?.id;
  check(typeof privateId === 'string' && privateId !== '', 'a thread was created to hold the attachment checks');

  // The two ordinary turns either side of the attachment are there to prove the
  // conversation still syncs: only the file-carrying turn and its answer are held.
  await appendMessage(privateId, { role: 'user', content: 'What does this sheet say?' });
  await appendMessage(privateId, { role: 'assistant', content: 'I cannot see a file yet.' });
  const attachmentTurn = await appendMessage(privateId, {
    role: 'user',
    content: 'What are we paying?\n\nAttached file: salaries.xlsx (path: C:/Users/me/salaries.xlsx)\n\nName,Pay\nAda,400',
    localOnly: true,
  });
  check(attachmentTurn?.data?.message?.localOnly === true, 'the attachment turn is stored as device-only');
  const attachmentReply = await appendMessage(privateId, { role: 'assistant', content: 'Ada is paid 400.' });
  check(attachmentReply?.data?.message?.localOnly === true, 'the answer to an attachment is marked device-only too');
  await appendMessage(privateId, { role: 'user', content: 'Thanks, that is all.' });

  await chatSync.syncThread(privateId);
  const privateCloud = [...account.conversations.values()].find((row) => row.title === 'Private budget');
  check(Boolean(privateCloud), 'the ordinary part of an attachment chat still reaches the account');
  check(privateCloud?.messages.length === 3, 'only the three ordinary turns were uploaded', `saw ${privateCloud?.messages.length}`);
  const uploaded = JSON.stringify(privateCloud?.messages ?? []);
  check(!uploaded.includes('salaries.xlsx'), 'the attached file\'s wording never reached the account');
  check(!uploaded.includes('C:/Users'), 'the file path never reached the account');
  check(!uploaded.includes('Ada is paid'), 'the answer that quotes the file never reached the account');

  // A chat that is nothing but attachments has nothing the account may hold, so it
  // must not spend one of the account's conversation slots saying so.
  const attachmentsOnly = await createThread({ title: 'Only attachments' });
  const onlyId = attachmentsOnly?.data?.id;
  await appendMessage(onlyId, { role: 'user', content: 'Attached folder: Payslips\n\nAda, 400', localOnly: true });
  await appendMessage(onlyId, { role: 'assistant', content: 'Two people are on the payroll.' });
  const beforeOnly = account.conversations.size;
  const onlyResult = await chatSync.syncThread(onlyId);
  check(onlyResult?.ok === true, 'a chat of only attachments is not reported as a failure', JSON.stringify(onlyResult?.error ?? null));
  check(account.conversations.size === beforeOnly, 'a chat of only attachments opens no conversation in the account', `saw ${account.conversations.size}`);

  // Regenerate replaces a reply the account already holds, and the account has no way
  // to delete one message. Without a record of the replaced reply, the next pull would
  // see an id this machine does not know and put the old answer back under the new one.
  const regenerated = await createThread({ title: 'Regenerate' });
  const regenId = regenerated?.data?.id;
  await appendMessage(regenId, { role: 'user', content: 'Name a colour.' });
  await appendMessage(regenId, { role: 'assistant', content: 'Blue.' });
  await chatSync.syncThread(regenId);
  await removeTrailingReply(regenId);
  await appendMessage(regenId, { role: 'assistant', content: 'Green.' });
  const regenRun = await chatSync.syncThread(regenId);
  const regenLocal = (await storedThreads()).find((thread) => thread.id === regenId);
  check(regenRun?.ok === true, 'a sync after regenerating is not reported as a failure', JSON.stringify(regenRun?.error ?? null));
  check(!regenLocal?.messages.some((message) => message.content === 'Blue.'), 'a regenerated reply is not pulled back in from the account');
  check(regenLocal?.messages.at(-1)?.content === 'Green.', 'the new reply stays the last message', String(regenLocal?.messages.at(-1)?.content));
  const regenCloud = [...account.conversations.values()].find((row) => row.title === 'Regenerate');
  check(!regenCloud?.messages.some((message) => message.content === 'Blue.'), 'the account no longer holds the replaced reply', JSON.stringify(regenCloud?.messages.map((message) => message.content)));
  check(regenLocal?.droppedCloudIds === undefined, 'the replaced reply is forgotten once the account has deleted it', JSON.stringify(regenLocal?.droppedCloudIds));

  // A server that has not been updated yet answers the delete with a generic not-found.
  // That is not a confirmation, so the reply must stay remembered (and stay out of the
  // desktop thread), and be deleted on a later run once the server catches up.
  const oldServerThread = await createThread({ title: 'Old server' });
  const oldId = oldServerThread?.data?.id;
  await appendMessage(oldId, { role: 'user', content: 'Name an animal.' });
  await appendMessage(oldId, { role: 'assistant', content: 'Cat.' });
  await chatSync.syncThread(oldId);
  await removeTrailingReply(oldId);
  await appendMessage(oldId, { role: 'assistant', content: 'Dog.' });
  account.setOlderServer(true);
  await chatSync.syncThread(oldId);
  let oldLocal = (await storedThreads()).find((thread) => thread.id === oldId);
  check(!oldLocal?.messages.some((message) => message.content === 'Cat.'), 'with an older server the replaced reply still does not come back');
  check(oldLocal?.droppedCloudIds?.length === 1, 'with an older server the replaced reply stays remembered', JSON.stringify(oldLocal?.droppedCloudIds));
  account.setOlderServer(false);
  await chatSync.syncThread(oldId);
  oldLocal = (await storedThreads()).find((thread) => thread.id === oldId);
  const oldCloud = [...account.conversations.values()].find((row) => row.title === 'Old server');
  check(!oldCloud?.messages.some((message) => message.content === 'Cat.'), 'once the server is updated the replaced reply is deleted from the account');
  check(oldLocal?.droppedCloudIds === undefined, 'and then it is forgotten here', JSON.stringify(oldLocal?.droppedCloudIds));

  /*
   * A chat started in the browser has no thread here, so every pull above had nothing to
   * aim at: the sweep only ever walked threads chats.json already held. Asking the account
   * what it lists is the one path that reaches a conversation the desktop has never heard
   * of. A settling sweep first, so the counts below belong to this chat alone.
   */
  await chatSync.syncAllThreads({ limit: 200 });

  const fromBrowser = account.startOnWeb('Trip to Abuja', [
    { role: 'user', content: 'What should I pack?' },
    { role: 'assistant', content: 'Light clothes and a rain jacket.' },
  ]);
  const sweep = await chatSync.syncAllThreads({ limit: 10 });
  check(sweep?.ok === true, 'a sweep that finds a chat written in the browser is not a failure', JSON.stringify(sweep?.error ?? null));

  let adoptedLocal = (await storedThreads()).find((thread) => thread?.cloud?.id === fromBrowser.id);
  check(Boolean(adoptedLocal), 'a conversation started in the browser becomes a thread here');
  check(adoptedLocal?.title === 'Trip to Abuja', 'the adopted chat keeps the title the browser gave it', String(adoptedLocal?.title));
  check(adoptedLocal?.messages?.length === 2, 'its turns are pulled with it', `saw ${adoptedLocal?.messages?.length}`);
  check(
    (adoptedLocal?.messages ?? []).every((message) => typeof message.cloudId === 'string' && message.cloudId !== ''),
    'every pulled turn carries the server id, so none is sent back',
    JSON.stringify(adoptedLocal?.messages?.map((message) => message.cloudId)),
  );
  check((sweep?.data?.adopted ?? 0) >= 1, 'the sweep reports the chat it took on, so the list can refresh', `saw ${sweep?.data?.adopted}`);
  check((sweep?.data?.appended ?? 0) >= 2, 'the turns it brought in are counted, so the open chat refreshes', `saw ${sweep?.data?.appended}`);
  check(fromBrowser.messages.length === 2, 'taking a chat on never uploads it back', `saw ${fromBrowser.messages.length}`);

  // A second sweep must find nothing new: the link written on adoption is what stops the
  // same conversation being taken on again under a second local thread.
  const secondSweep = await chatSync.syncAllThreads({ limit: 10 });
  const linkedHere = (await storedThreads()).filter((thread) => thread?.cloud?.id === fromBrowser.id);
  check(secondSweep?.data?.adopted === 0, 'a chat already adopted is not adopted again', `saw ${secondSweep?.data?.adopted}`);
  check(linkedHere.length === 1, 'the account conversation answers for exactly one local thread', `saw ${linkedHere.length}`);

  // A browser chat opened and never typed into has nothing to show.
  const emptyWeb = account.startOnWeb('Draft chat', []);
  const beforeEmpty = (await storedThreads()).length;
  await chatSync.syncAllThreads({ limit: 10 });
  const afterEmpty = await storedThreads();
  check(afterEmpty.length === beforeEmpty, 'a browser chat with nothing in it opens no thread here', `${beforeEmpty} then ${afterEmpty.length}`);
  check(!afterEmpty.some((thread) => thread?.cloud?.id === emptyWeb.id), 'the empty browser chat stays in the account only');

  /*
   * Deleting is best effort against the account, so the copy can outlive the local delete.
   * Without the id being written down first, the next sweep would adopt the chat back and
   * the person would watch a chat they deleted undelete itself.
   */
  adoptedLocal = (await storedThreads()).find((thread) => thread?.cloud?.id === fromBrowser.id);
  await deleteThread(adoptedLocal.id);
  account.refuseDeletes(true);
  const refused = await chatSync.deleteConversation(fromBrowser.id);
  account.refuseDeletes(false);
  check(refused?.ok !== true, 'a delete that cannot reach the account reports the failure', JSON.stringify(refused?.error?.code ?? null));

  const afterDeleteSweep = await chatSync.syncAllThreads({ limit: 10 });
  check(
    !(await storedThreads()).some((thread) => thread?.cloud?.id === fromBrowser.id),
    'a chat deleted here is not adopted back while the account still lists it',
    JSON.stringify(afterDeleteSweep?.data ?? null),
  );

  // The link written above is gone, so the thread is uploaded fresh under a new id;
  // what matters is that the run succeeded and did not keep retrying a dead id.
  await fs.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? '\nPASS chat sync' : `\n${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
  app.quit();
}

main().catch((error) => {
  console.error(`FAIL chat sync - ${error?.message ?? error}`);
  process.exitCode = 1;
  app.quit();
});
