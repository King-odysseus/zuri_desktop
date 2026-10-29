import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth.js';
import { CONVERSATION_LIMIT, CONVERSATION_LIST_LIMIT, CONVERSATION_SEARCH_MAX_LENGTH, MESSAGE_LIMIT, createRepository } from '../src/db.js';

// Saved chat history is the one part of the cloud that holds what a customer actually
// typed. The checks below are in two halves for that reason: the first half reads the
// SQL the repository builds (there is no Postgres in this suite, so a stub connection
// records it), the second half drives the routes end to end against an in-memory
// repository that answers the way the SQL does.

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-10-24T11:00:00.000Z');
const UPDATED_AT = new Date('2026-10-24T12:00:00.000Z');

/**
 * A stand-in for pg's pool that records every statement and replies from a script.
 *
 * A script entry answers the first statement whose text contains its `match`, so an
 * entry can answer one call with `reply` or several with `replies`. Nothing outside the
 * script answers with an empty result, which is what an empty table looks like.
 * @param {Array<{ match: string, reply?: object, replies?: Array<object> }>} [script]
 * @returns {{ queries: Array<{ text: string, values: Array<unknown> }>, pool: object }}
 */
function recordingPool(script = []) {
  const queries = [];
  const entries = script.map((entry) => ({ ...entry, replies: entry.replies ? [...entry.replies] : null }));
  const client = {
    async query(text, values = []) {
      // Whitespace is collapsed so the assertions can name one phrase instead of
      // reproducing the exact line breaks of a concatenated statement.
      queries.push({ text: String(text).replace(/\s+/g, ' ').trim(), values });
      const entry = entries.find((candidate) => String(text).includes(candidate.match));
      if (!entry) return { rows: [], rowCount: 0 };
      if (entry.replies?.length) return entry.replies.shift();
      return entry.reply ?? { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { queries, pool: { query: client.query, connect: async () => client } };
}

const conversationRow = {
  id: CONVERSATION_ID,
  title: 'Renew my passport',
  model: 'zuri-flash',
  origin: 'web',
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  message_count: '2',
};

// ---------------------------------------------------------------------------
// The repository: which rows a statement is allowed to reach.
// ---------------------------------------------------------------------------

const listing = recordingPool([{ match: 'FROM conversations c', reply: { rows: [conversationRow], rowCount: 1 } }]);
const listed = await createRepository(listing.pool).listConversations(USER_A);
assert.equal(listing.queries.length, 1, 'the list is one query, not one per conversation');
assert.match(listing.queries[0].text, /WHERE c\.user_id = \$1/);
assert.match(listing.queries[0].text, /ORDER BY c.pinned DESC, c.updated_at DESC/);
assert.deepEqual(listing.queries[0].values, [USER_A, '', CONVERSATION_LIST_LIMIT, false, null], 'the archive is excluded unless it is asked for');
// COUNT is a bigint, which pg hands back as a string: the response must carry a number.
assert.deepEqual(listed, [{
  id: CONVERSATION_ID,
  title: 'Renew my passport',
  model: 'zuri-flash',
  origin: 'web',
  messageCount: 2,
  pinned: false,
  archived: false,
  projectId: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
}]);
console.log('PASS conversations are listed for their owner only');

const searched = recordingPool([{ match: 'FROM conversations c', reply: { rows: [conversationRow], rowCount: 1 } }]);
await createRepository(searched.pool).listConversations(USER_A, ' passport ');
assert.match(searched.queries[0].text, /c\.title ILIKE/);
assert.match(searched.queries[0].text, /conversation_messages sm/);
assert.deepEqual(searched.queries[0].values, [USER_A, 'passport', CONVERSATION_LIST_LIMIT, false, null]);
await createRepository(searched.pool).listConversations(USER_A, 'x'.repeat(CONVERSATION_SEARCH_MAX_LENGTH + 20));
assert.equal(searched.queries[1].values[1].length, CONVERSATION_SEARCH_MAX_LENGTH);
console.log('PASS conversation search is owner-scoped, parameterized and capped');

const created = recordingPool([{
  match: 'INSERT INTO conversations',
  reply: { rows: [conversationRow], rowCount: 1 },
}]);
const createdConversation = await createRepository(created.pool).createConversation({ userId: USER_A, title: 'New chat', model: 'zuri-flash', origin: 'web' });
assert.equal(createdConversation.messageCount, 0);
assert.match(created.queries[0].text, /COUNT\(\*\) FROM conversations WHERE user_id = \$1/);
assert.deepEqual(created.queries[0].values, [USER_A, 'New chat', 'zuri-flash', 'web', CONVERSATION_LIMIT]);

// No row comes back when the guard refuses the insert, and that is reported as a limit
// rather than as a database fault.
const saturated = recordingPool([{ match: 'INSERT INTO conversations', reply: { rows: [], rowCount: 0 } }]);
await assert.rejects(
  () => createRepository(saturated.pool).createConversation({ userId: USER_A, title: 'New chat', model: 'zuri-flash', origin: 'web' }),
  (error) => error.code === 'CONVERSATION_LIMIT',
);
console.log('PASS a new conversation is capped per account');

const otherOwnersThread = recordingPool([{ match: 'FROM conversations c', reply: { rows: [], rowCount: 0 } }]);
assert.equal(await createRepository(otherOwnersThread.pool).getConversation(USER_B, CONVERSATION_ID), null);
assert.deepEqual(otherOwnersThread.queries[0].values, [USER_B, CONVERSATION_ID]);
assert.match(otherOwnersThread.queries[0].text, /c\.user_id = \$1 AND c\.id = \$2/);
assert.equal(otherOwnersThread.queries.length, 1, 'a thread that is not yours never reaches its messages');

// An invented id must not be sent to Postgres: the cast would fail and the caller would
// learn from the difference that the id was never a real one.
const probing = recordingPool();
assert.equal(await createRepository(probing.pool).getConversation(USER_B, 'not-a-uuid'), null);
assert.equal(await createRepository(probing.pool).getConversation(USER_B, `${CONVERSATION_ID.slice(0, -1)}g`), null);
assert.equal(probing.queries.length, 0);
console.log('PASS an id that cannot exist is refused before it is queried');

const reading = recordingPool([
  { match: 'FROM conversations c', reply: { rows: [conversationRow], rowCount: 1 } },
  {
    match: 'FROM conversation_messages',
    reply: {
      rows: [
        { id: '44444444-4444-4444-8444-444444444444', role: 'user', content: 'Where do I start?', created_at: CREATED_AT },
        { id: '55555555-5555-4555-8555-555555555555', role: 'assistant', content: 'At the portal.', created_at: UPDATED_AT },
      ],
    },
  },
]);
const read = await createRepository(reading.pool).getConversation(USER_A, CONVERSATION_ID);
assert.equal(read.conversation.id, CONVERSATION_ID);
assert.deepEqual(read.messages.map((message) => message.role), ['user', 'assistant']);
assert.deepEqual(read.messages[0], { id: '44444444-4444-4444-8444-444444444444', role: 'user', content: 'Where do I start?', attachment: null, createdAt: CREATED_AT });
assert.match(reading.queries[1].text, /ORDER BY m\.created_at, m\.id/);
// The messages are read with the owner in the same statement, not just on the row above.
assert.match(reading.queries[1].text, /WHERE c\.user_id = \$1 AND m\.conversation_id = \$2/);
assert.deepEqual(reading.queries[1].values, [USER_A, CONVERSATION_ID]);
console.log('PASS one conversation is read oldest message first');

const writing = recordingPool([
  { match: 'FOR UPDATE', reply: { rows: [{ id: CONVERSATION_ID }], rowCount: 1 } },
  { match: 'COUNT(*)::INT AS message_count FROM conversation_messages', reply: { rows: [{ message_count: 2 }], rowCount: 1 } },
  {
    match: 'INSERT INTO conversation_messages',
    reply: { rows: [{ id: '66666666-6666-4666-8666-666666666666', role: 'user', content: 'And the fee?', created_at: UPDATED_AT }], rowCount: 1 },
  },
  { match: 'UPDATE conversations SET title', reply: { rows: [], rowCount: 1 } },
  { match: 'FROM conversations c', reply: { rows: [{ ...conversationRow, message_count: '3' }], rowCount: 1 } },
]);
const appended = await createRepository(writing.pool).appendMessage({ userId: USER_A, conversationId: CONVERSATION_ID, role: 'user', content: 'And the fee?' });
assert.equal(writing.queries[0].text, 'BEGIN');
assert.equal(writing.queries.at(-1).text, 'COMMIT');
// The row is locked before anything is counted, so two appends cannot both pass the cap
// and cannot both rename the thread.
assert.match(writing.queries[1].text, /WHERE id = \$1 AND user_id = \$2 FOR UPDATE/);
assert.deepEqual(writing.queries[1].values, [CONVERSATION_ID, USER_A]);
// Even the cap check names the owner, so it cannot count another account's messages.
assert.match(writing.queries[2].text, /c\.user_id = \$2/);
assert.deepEqual(writing.queries[2].values, [CONVERSATION_ID, USER_A]);
const insert = writing.queries.find((entry) => entry.text.startsWith('INSERT INTO conversation_messages'));
assert.deepEqual(insert.values, [CONVERSATION_ID, 'user', 'And the fee?', null], 'a turn with no file stores an explicit null');
const titleUpdate = writing.queries.find((entry) => entry.text.startsWith('UPDATE conversations SET title'));
assert.match(titleUpdate.text, /CASE WHEN title = 'New chat' AND \$2 = 'user' THEN LEFT\(TRIM\(\$3\), 60\)/);
assert.match(titleUpdate.text, /updated_at = NOW\(\)/);
assert.match(titleUpdate.text, /WHERE id = \$1 AND user_id = \$4/);
assert.deepEqual(titleUpdate.values, [CONVERSATION_ID, 'user', 'And the fee?', USER_A]);
assert.equal(appended.message.content, 'And the fee?');
assert.equal(appended.conversation.messageCount, 3);

const foreignAppend = recordingPool([{ match: 'FOR UPDATE', reply: { rows: [], rowCount: 0 } }]);
assert.equal(
  await createRepository(foreignAppend.pool).appendMessage({ userId: USER_B, conversationId: CONVERSATION_ID, role: 'user', content: 'peek' }),
  null,
);
assert.equal(foreignAppend.queries.at(-1).text, 'ROLLBACK');
assert.ok(!foreignAppend.queries.some((entry) => entry.text.startsWith('INSERT')), 'nothing is written to a thread that is not yours');

const fullThread = recordingPool([
  { match: 'FOR UPDATE', reply: { rows: [{ id: CONVERSATION_ID }], rowCount: 1 } },
  { match: 'COUNT(*)::INT AS message_count FROM conversation_messages', reply: { rows: [{ message_count: MESSAGE_LIMIT }], rowCount: 1 } },
]);
await assert.rejects(
  () => createRepository(fullThread.pool).appendMessage({ userId: USER_A, conversationId: CONVERSATION_ID, role: 'user', content: 'one more' }),
  (error) => error.code === 'MESSAGE_LIMIT',
);
assert.equal(fullThread.queries.at(-1).text, 'ROLLBACK');
assert.ok(!fullThread.queries.some((entry) => entry.text.startsWith('INSERT')));
console.log('PASS a message is appended inside one transaction and capped per thread');

const renaming = recordingPool([
  { match: 'UPDATE conversations SET title', reply: { rows: [{ id: CONVERSATION_ID }], rowCount: 1 } },
  { match: 'FROM conversations c', reply: { rows: [{ ...conversationRow, title: 'Passport' }], rowCount: 1 } },
]);
const renamed = await createRepository(renaming.pool).renameConversation(USER_A, CONVERSATION_ID, 'Passport');
assert.equal(renamed.title, 'Passport');
assert.match(renaming.queries[0].text, /WHERE id = \$1 AND user_id = \$2/);
assert.deepEqual(renaming.queries[0].values, [CONVERSATION_ID, USER_A, 'Passport']);
const foreignRename = recordingPool([{ match: 'UPDATE conversations SET title', reply: { rows: [], rowCount: 0 } }]);
assert.equal(await createRepository(foreignRename.pool).renameConversation(USER_B, CONVERSATION_ID, 'Mine now'), null);
console.log('PASS a rename only lands on a thread the caller owns');

const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const deletingMessage = recordingPool([{ match: 'DELETE FROM conversation_messages', reply: { rows: [{ id: MESSAGE_ID }], rowCount: 1 } }]);
assert.equal(await createRepository(deletingMessage.pool).deleteMessage(USER_A, CONVERSATION_ID, MESSAGE_ID), true);
// Ownership rides in the same statement, through the conversation, not in a later check.
assert.match(deletingMessage.queries[0].text, /c\.user_id = \$2/);
assert.deepEqual(deletingMessage.queries[0].values, [CONVERSATION_ID, USER_A, MESSAGE_ID]);
const foreignMessage = recordingPool([{ match: 'DELETE FROM conversation_messages', reply: { rows: [], rowCount: 0 } }]);
assert.equal(await createRepository(foreignMessage.pool).deleteMessage(USER_B, CONVERSATION_ID, MESSAGE_ID), false);
const badIds = recordingPool([]);
assert.equal(await createRepository(badIds.pool).deleteMessage(USER_A, 'not-a-uuid', MESSAGE_ID), false);
assert.equal(await createRepository(badIds.pool).deleteMessage(USER_A, CONVERSATION_ID, 'nope'), false);
assert.equal(badIds.queries.length, 0, 'a malformed id never reaches the database');
console.log('PASS one message is deleted only from a thread the caller owns');

const removing = recordingPool([{ match: 'DELETE FROM conversations', reply: { rows: [{ id: CONVERSATION_ID }], rowCount: 1 } }]);
assert.equal(await createRepository(removing.pool).deleteConversation(USER_A, CONVERSATION_ID), true);
assert.match(removing.queries[0].text, /WHERE id = \$1 AND user_id = \$2/);
assert.deepEqual(removing.queries[0].values, [CONVERSATION_ID, USER_A]);
const foreignDelete = recordingPool([{ match: 'DELETE FROM conversations', reply: { rows: [], rowCount: 0 } }]);
assert.equal(await createRepository(foreignDelete.pool).deleteConversation(USER_B, CONVERSATION_ID), false);
console.log('PASS a delete only removes a thread the caller owns');

// ---------------------------------------------------------------------------
// The routes: status codes and payloads.
//
// The account and its token are real (the auth service issues them); the repository is
// an in-memory copy of the SQL's behaviour, so the route can be driven without a
// Postgres instance.
// ---------------------------------------------------------------------------

/** @returns {object} A repository whose answers mirror the SQL, including the caps. */
function createMemoryRepository() {
  const rows = new Map();
  const view = (row) => ({
    id: row.id,
    title: row.title,
    model: row.model,
    origin: row.origin,
    messageCount: row.messages.length,
    pinned: row.pinned === true,
    archived: row.archived === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  const owned = (userId, id) => {
    const row = rows.get(id);
    return row && row.userId === userId ? row : null;
  };
  return {
    rows,
    async listConversations(userId, search = '', includeArchived = false) {
      const query = String(search).trim().slice(0, CONVERSATION_SEARCH_MAX_LENGTH).toLowerCase();
      return [...rows.values()]
        .filter((row) => row.userId === userId && (includeArchived === true || row.archived !== true) && (query === '' || row.title.toLowerCase().includes(query) || row.messages.some((message) => message.content.toLowerCase().includes(query))))
        // Pinned first, then most recent, which is the order the SQL asks for.
        .sort((left, right) => Number(right.pinned === true) - Number(left.pinned === true) || right.updatedAt - left.updatedAt)
        .slice(0, CONVERSATION_LIST_LIMIT)
        .map(view);
    },
    async createConversation({ userId, title, model, origin }) {
      if ([...rows.values()].filter((row) => row.userId === userId).length >= CONVERSATION_LIMIT) {
        const error = new Error('This account already holds as many conversations as it can store.');
        error.code = 'CONVERSATION_LIMIT';
        throw error;
      }
      const row = { id: randomUUID(), userId, title, model, origin, createdAt: fixedNow(), updatedAt: fixedNow(), messages: [] };
      rows.set(row.id, row);
      return view(row);
    },
    async getConversation(userId, id) {
      const row = owned(userId, id);
      if (!row) return null;
      return { conversation: view(row), messages: row.messages.map((message) => ({ ...message })) };
    },
    async appendMessage({ userId, conversationId, role, content, attachment = null }) {
      const row = owned(userId, conversationId);
      if (!row) return null;
      if (row.messages.length >= MESSAGE_LIMIT) {
        const error = new Error('This conversation already holds as many messages as it can store.');
        error.code = 'MESSAGE_LIMIT';
        throw error;
      }
      const createdAt = new Date(row.updatedAt.getTime() + 1000);
      const message = { id: randomUUID(), role, content, attachment, createdAt };
      row.messages.push(message);
      if (row.title === 'New chat' && role === 'user') row.title = content.trim().slice(0, 60);
      row.updatedAt = createdAt;
      return { message: { ...message }, conversation: view(row) };
    },
    async deleteMessage(userId, id, messageId) {
      const row = owned(userId, id);
      const index = row ? row.messages.findIndex((message) => message.id === messageId) : -1;
      if (index === -1) return false;
      row.messages.splice(index, 1);
      return true;
    },
    async renameConversation(userId, id, title) {
      const row = owned(userId, id);
      if (!row) return null;
      row.title = title;
      row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
      return view(row);
    },
    async setConversationFlags(userId, id, { pinned = null, archived = null }) {
      const row = owned(userId, id);
      if (!row) return null;
      if (pinned !== null) row.pinned = pinned;
      if (archived !== null) row.archived = archived;
      return view(row);
    },
    async deleteConversation(userId, id) {
      const row = owned(userId, id);
      if (!row) return null;
      rows.delete(id);
      return true;
    },
  };
}

const accounts = new Map([
  ['user-a', { id: 'user-a', email: 'user-a@example.com', displayName: 'A', status: 'active' }],
  ['user-b', { id: 'user-b', email: 'user-b@example.com', displayName: 'B', status: 'active' }],
]);
const issued = new Map();
let sessionSeed = 0;
const auth = createAuthService({
  repository: {
    async findOrCreateGoogleUser(profile) {
      return accounts.get(String(profile.email).split('@')[0]);
    },
    async createSession(userId, tokenHash, expiresAt) {
      issued.set(tokenHash, { userId, expiresAt });
    },
    // The idle check reads the stored session, so it travels back with the user the
    // way the real repository returns it.
    async findSessionUser(tokenHash) {
      const session = issued.get(tokenHash);
      if (!session) return null;
      return {
        user: accounts.get(session.userId),
        subscription: { id: 'subscription-1', planCode: 'starter', monthlyTokens: 2_000_000, currentPeriodStart: fixedNow(), currentPeriodEnd: new Date('2026-11-24T12:00:00.000Z') },
        session: { expiresAt: session.expiresAt, lastUsedAt: fixedNow(), revoked: false },
      };
    },
  },
  verifyGoogleCredential: async (credential) => ({ googleSubject: credential, email: `${credential}@example.com`, displayName: credential }),
  now: fixedNow,
  random: () => Buffer.from(`session-seed-${(sessionSeed += 1)}`),
});
const tokenA = (await auth.signInWithGoogle('user-a')).token;
const tokenB = (await auth.signInWithGoogle('user-b')).token;

const repository = createMemoryRepository();
const app = createApp({ auth, repository, now: fixedNow });

/**
 * @param {string} method
 * @param {string} path
 * @param {{ token?: string, body?: object }} [options]
 * @returns {Promise<Response>}
 */
function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return app(new Request(`https://cloud.example.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
}

assert.equal((await call('GET', '/api/me/conversations')).status, 401);
assert.equal((await call('GET', '/api/me/conversations', { token: 'not-a-token' })).status, 401);
const unconfigured = createApp({ auth, repository: {}, now: fixedNow });
assert.equal((await unconfigured(new Request('https://cloud.example.com/api/me/conversations', { headers: { authorization: `Bearer ${tokenA}` } }))).status, 503);

const createdResponse = await call('POST', '/api/me/conversations', { token: tokenA, body: {} });
assert.equal(createdResponse.status, 200);
const newConversation = (await createdResponse.json()).data.conversation;
assert.deepEqual(Object.keys(newConversation).sort(), ['archived', 'createdAt', 'id', 'messageCount', 'model', 'origin', 'pinned', 'title', 'updatedAt']);
assert.equal(newConversation.title, 'New chat');
assert.equal(newConversation.model, 'zuri-flash');
assert.equal(newConversation.origin, 'web');
assert.equal(newConversation.messageCount, 0);
assert.equal(typeof newConversation.createdAt, 'string');

const chosen = (await (await call('POST', '/api/me/conversations', {
  token: tokenA,
  body: { title: '  Plan the trip  ', model: 'zuri-pro', origin: 'android' },
})).json()).data.conversation;
assert.equal(chosen.title, 'Plan the trip');
assert.equal(chosen.model, 'zuri-pro');
assert.equal(chosen.origin, 'android');
// An origin the three clients do not use falls back to the web rather than failing.
const strangeOrigin = (await (await call('POST', '/api/me/conversations', { token: tokenA, body: { origin: 'telepathy' } })).json()).data.conversation;
assert.equal(strangeOrigin.origin, 'web');
console.log('PASS a conversation is created with the documented defaults');

const threadId = newConversation.id;
const firstTurn = await call('POST', `/api/me/conversations/${threadId}/messages`, {
  token: tokenA,
  body: { role: 'user', content: 'How do I renew my passport?' },
});
assert.equal(firstTurn.status, 200);
const firstAppend = (await firstTurn.json()).data;
assert.deepEqual(Object.keys(firstAppend).sort(), ['conversation', 'message']);
assert.deepEqual(Object.keys(firstAppend.message).sort(), ['attachment', 'content', 'createdAt', 'id', 'role']);
assert.equal(firstAppend.message.role, 'user');
assert.equal(firstAppend.message.content, 'How do I renew my passport?');
assert.equal(firstAppend.conversation.messageCount, 1);
// The thread names itself after the first question, so the history list reads like one.
assert.equal(firstAppend.conversation.title, 'How do I renew my passport?');

const secondTurn = (await (await call('POST', `/api/me/conversations/${threadId}/messages`, {
  token: tokenA,
  body: { role: 'user', content: 'And the fee?' },
})).json()).data;
assert.equal(secondTurn.conversation.messageCount, 2);
assert.equal(secondTurn.conversation.title, 'How do I renew my passport?', 'a later message keeps the name the first one gave');

// An assistant turn arrives after the thread is named, so it cannot rename it.
const unnamed = (await (await call('POST', '/api/me/conversations', { token: tokenA, body: {} })).json()).data.conversation;
const assistantTurn = (await (await call('POST', `/api/me/conversations/${unnamed.id}/messages`, {
  token: tokenA,
  body: { role: 'assistant', content: 'Ask me anything.' },
})).json()).data;
assert.equal(assistantTurn.conversation.title, 'New chat');

const longQuestion = 'p'.repeat(80);
const longThread = (await (await call('POST', '/api/me/conversations', { token: tokenA, body: {} })).json()).data.conversation;
const longTitle = (await (await call('POST', `/api/me/conversations/${longThread.id}/messages`, {
  token: tokenA,
  body: { role: 'user', content: longQuestion },
})).json()).data.conversation.title;
assert.equal(longTitle.length, 60);
assert.equal(longTitle, longQuestion.slice(0, 60));
console.log('PASS appending a message names the thread after the first user turn');

const detail = await call('GET', `/api/me/conversations/${threadId}`, { token: tokenA });
assert.equal(detail.status, 200);
const thread = (await detail.json()).data;
assert.deepEqual(Object.keys(thread).sort(), ['conversation', 'messages']);
assert.deepEqual(thread.messages.map((message) => message.content), ['How do I renew my passport?', 'And the fee?']);

const badRole = await call('POST', `/api/me/conversations/${threadId}/messages`, { token: tokenA, body: { role: 'robot', content: 'Hi' } });
assert.equal(badRole.status, 400);
assert.equal((await badRole.json()).error.code, 'INVALID_MESSAGE');
const blank = await call('POST', `/api/me/conversations/${threadId}/messages`, { token: tokenA, body: { role: 'user', content: '   ' } });
assert.equal(blank.status, 400);
assert.equal((await blank.json()).error.code, 'INVALID_MESSAGE');
const oversized = await call('POST', `/api/me/conversations/${threadId}/messages`, { token: tokenA, body: { role: 'user', content: 'x'.repeat(100001) } });
assert.equal(oversized.status, 400);
assert.equal((await oversized.json()).error.code, 'MESSAGE_TOO_LARGE');

// 500 round trips would only slow the suite down, so the filled thread is seeded.
const fullThreadId = (await (await call('POST', '/api/me/conversations', { token: tokenA, body: { title: 'Full' } })).json()).data.conversation.id;
const fullRow = repository.rows.get(fullThreadId);
for (let index = 0; index < MESSAGE_LIMIT; index += 1) {
  fullRow.messages.push({ id: randomUUID(), role: 'assistant', content: `turn ${index}`, createdAt: fixedNow() });
}
const overfull = await call('POST', `/api/me/conversations/${fullThreadId}/messages`, { token: tokenA, body: { role: 'user', content: 'one more' } });
assert.equal(overfull.status, 400);
assert.equal((await overfull.json()).error.code, 'MESSAGE_LIMIT');
console.log('PASS a message is validated and a full thread refuses more');

// The other account has one thread of its own, so the list below can prove the two do
// not see each other.
const foreignThread = (await (await call('POST', '/api/me/conversations', { token: tokenB, body: { title: 'Only mine' } })).json()).data.conversation;
const listForA = (await (await call('GET', '/api/me/conversations', { token: tokenA })).json()).data.conversations;
const listForB = (await (await call('GET', '/api/me/conversations', { token: tokenB })).json()).data.conversations;
assert.deepEqual(listForB.map((row) => row.title), ['Only mine']);
assert.ok(listForA.every((row) => row.id !== foreignThread.id), 'one account never sees another account\'s thread');
assert.ok(listForA.length > 1);
// The thread touched last comes first, which is what the sidebar shows at the top. The
// two appends above made it the most recently updated thread of this account.
assert.equal(listForA[0].id, threadId);
console.log('PASS the list shows only the caller\'s threads, most recent first');
const searchForA = (await (await call('GET', '/api/me/conversations?q=fee', { token: tokenA })).json()).data.conversations;
assert.ok(searchForA.some((row) => row.id === threadId));
assert.ok(searchForA.every((row) => row.id !== foreignThread.id));
const searchCapped = await call('GET', `/api/me/conversations?q=${'x'.repeat(CONVERSATION_SEARCH_MAX_LENGTH + 20)}`, { token: tokenA });
assert.equal(searchCapped.status, 200);
console.log('PASS conversation search filters only the signed-in account');

// Reading, writing, renaming and deleting somebody else\'s thread all answer exactly
// like an id that does not exist, so an id cannot be tested for existence.
const crossRead = await call('GET', `/api/me/conversations/${threadId}`, { token: tokenB });
assert.equal(crossRead.status, 404);
assert.equal((await crossRead.json()).error.code, 'CONVERSATION_NOT_FOUND');
const crossWrite = await call('POST', `/api/me/conversations/${threadId}/messages`, { token: tokenB, body: { role: 'user', content: 'peek' } });
assert.equal(crossWrite.status, 404);
assert.equal((await crossWrite.json()).error.code, 'CONVERSATION_NOT_FOUND');
const crossRename = await call('PATCH', `/api/me/conversations/${threadId}`, { token: tokenB, body: { title: 'Mine now' } });
assert.equal(crossRename.status, 404);
assert.equal((await crossRename.json()).error.code, 'CONVERSATION_NOT_FOUND');
const crossDelete = await call('DELETE', `/api/me/conversations/${threadId}`, { token: tokenB });
assert.equal(crossDelete.status, 404);
assert.equal((await crossDelete.json()).error.code, 'CONVERSATION_NOT_FOUND');
assert.equal((await call('GET', `/api/me/conversations/${threadId}`, { token: tokenA })).status, 200, 'the owner still has the thread');
assert.equal((await call('GET', `/api/me/conversations/${randomUUID()}`, { token: tokenA })).status, 404);
assert.equal((await call('GET', '/api/me/conversations/not-a-uuid', { token: tokenA })).status, 404);
console.log('PASS another account\'s thread answers 404 and survives untouched');

const renamedResponse = await call('PATCH', `/api/me/conversations/${threadId}`, { token: tokenA, body: { title: '  Passport renewal  ' } });
assert.equal(renamedResponse.status, 200);
assert.equal((await renamedResponse.json()).data.conversation.title, 'Passport renewal');
const blankRename = await call('PATCH', `/api/me/conversations/${threadId}`, { token: tokenA, body: { title: '   ' } });
assert.equal(blankRename.status, 400);
assert.equal((await blankRename.json()).error.code, 'INVALID_MESSAGE');
const longRename = (await (await call('PATCH', `/api/me/conversations/${threadId}`, { token: tokenA, body: { title: 'y'.repeat(90) } })).json()).data.conversation;
assert.equal(longRename.title.length, 60);
console.log('PASS a rename is trimmed, capped and refuses to be blank');

const threadBefore = (await (await call('GET', `/api/me/conversations/${threadId}`, { token: tokenA })).json()).data;
const doomed = threadBefore.messages.at(-1);
const crossMessageDelete = await call('DELETE', `/api/me/conversations/${threadId}/messages/${doomed.id}`, { token: tokenB });
assert.equal(crossMessageDelete.status, 404);
assert.equal((await crossMessageDelete.json()).error.code, 'MESSAGE_NOT_FOUND');
const messageRemoved = await call('DELETE', `/api/me/conversations/${threadId}/messages/${doomed.id}`, { token: tokenA });
assert.equal(messageRemoved.status, 200);
assert.deepEqual(await messageRemoved.json(), { ok: true, data: { deleted: true } });
const afterRemoval = (await (await call('GET', `/api/me/conversations/${threadId}`, { token: tokenA })).json()).data;
assert.equal(afterRemoval.messages.length, threadBefore.messages.length - 1);
assert.ok(!afterRemoval.messages.some((message) => message.id === doomed.id), 'the message is gone');
assert.equal((await call('DELETE', `/api/me/conversations/${threadId}/messages/${doomed.id}`, { token: tokenA })).status, 404, 'a second delete finds nothing');
assert.equal((await call('POST', `/api/me/conversations/${threadId}/messages/${doomed.id}`, { token: tokenA })).status, 405);
console.log('PASS a single message is deleted for its owner only');

assert.equal((await call('PUT', '/api/me/conversations', { token: tokenA })).status, 405);
assert.equal((await call('GET', `/api/me/conversations/${threadId}/messages`, { token: tokenA })).status, 405);

const removed = await call('DELETE', `/api/me/conversations/${threadId}`, { token: tokenA });
assert.equal(removed.status, 200);
assert.deepEqual(await removed.json(), { ok: true, data: { deleted: true } });
assert.equal((await call('GET', `/api/me/conversations/${threadId}`, { token: tokenA })).status, 404);
console.log('PASS a thread is deleted for its owner only');

// The cap is per account: a second account is unaffected by the first one filling up.
const capped = createMemoryRepository();
const cappedApp = createApp({ auth, repository: capped, now: fixedNow });
const callCapped = (method, path, { token, body } = {}) => cappedApp(new Request(`https://cloud.example.com${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));
for (let index = 0; index < CONVERSATION_LIMIT; index += 1) {
  assert.equal((await callCapped('POST', '/api/me/conversations', { token: tokenA, body: {} })).status, 200);
}
const overflow = await callCapped('POST', '/api/me/conversations', { token: tokenA, body: {} });
assert.equal(overflow.status, 400);
assert.equal((await overflow.json()).error.code, 'CONVERSATION_LIMIT');
assert.equal((await callCapped('POST', '/api/me/conversations', { token: tokenB, body: {} })).status, 200);
console.log('PASS the conversation cap is per account');

// The Android and desktop clients call the API from a fixed local origin, so the
// preflight has to allow the two methods the history routes use.
const corsApp = createApp({ auth, repository, now: fixedNow, corsOrigins: ['https://localhost'] });
const preflight = await corsApp(new Request('https://cloud.example.com/api/me/conversations', {
  method: 'OPTIONS',
  headers: { origin: 'https://localhost' },
}));
assert.equal(preflight.status, 204);
assert.match(preflight.headers.get('access-control-allow-methods'), /PATCH/);
assert.match(preflight.headers.get('access-control-allow-methods'), /DELETE/);
console.log('PASS the browser preflight allows rename and delete');

// ---------------------------------------------------------------------------
// Attachments: signed on Railway, uploaded to Cloudinary, carried as a URL.
// ---------------------------------------------------------------------------

const cloudinaryDeps = {
  auth,
  repository: createMemoryRepository(),
  now: fixedNow,
  cloudinary: { cloudName: 'zuri-test', apiKey: 'public-key', apiSecret: 'secret-value' },
};
const cloudinaryApp = createApp(cloudinaryDeps);
const callCloud = (method, path, { token, body } = {}) => cloudinaryApp(new Request(`https://cloud.example.com${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));

// An unauthenticated caller gets nothing: a signature is a capability.
assert.equal((await callCloud('POST', '/api/me/conversations/uploads/sign')).status, 401);
const signed = await callCloud('POST', '/api/me/conversations/uploads/sign', { token: tokenA });
assert.equal(signed.status, 200);
const signedData = (await signed.json()).data;
assert.equal(signedData.cloudName, 'zuri-test');
assert.equal(signedData.apiKey, 'public-key', 'the public key is sent so the browser can post');
assert.equal(signedData.signature.length, 40, 'the signature is a sha1 digest');
assert.match(signedData.folder, /^zuri\/u\//, 'each account uploads into its own folder');
assert.equal(JSON.stringify(signedData).includes('secret-value'), false, 'the secret never leaves the server');
assert.equal(signedData.maxBytes, 10 * 1024 * 1024);
assert.deepEqual(signedData.allowedTypes.includes('application/pdf'), true);

// The signature is checkable by anyone holding the secret, which is exactly how
// Cloudinary verifies it. Recomputing it here proves the two halves agree.
const { uploadSignature, isCloudinaryUrl, checkedAttachment } = await import('../src/uploads.js');
assert.equal(
  signedData.signature,
  uploadSignature({ folder: signedData.folder, timestamp: signedData.timestamp, apiSecret: 'secret-value' }),
  'the signature is the sorted parameter hash Cloudinary expects',
);

// An installation without the three values keeps every other feature and says so
// plainly rather than failing a reply.
const bare = await call('POST', '/api/me/conversations/uploads/sign', { token: tokenA });
assert.equal(bare.status, 503);
assert.equal((await bare.json()).error.code, 'UPLOADS_NOT_CONFIGURED');
console.log('PASS an upload is signed per account and the secret stays on the server');

// A delivery URL is only accepted from this cloud's own host and folder, so a
// message cannot be made to point at an address the reader's browser would fetch.
assert.equal(isCloudinaryUrl('https://res.cloudinary.com/zuri-test/image/upload/a.png', 'zuri-test'), true);
assert.equal(isCloudinaryUrl('https://res.cloudinary.com/someone-else/image/upload/a.png', 'zuri-test'), false);
assert.equal(isCloudinaryUrl('https://evil.example.com/zuri-test/a.png', 'zuri-test'), false);
assert.equal(isCloudinaryUrl('http://res.cloudinary.com/zuri-test/image/upload/a.png', 'zuri-test'), false, 'plain http is refused');
assert.equal(isCloudinaryUrl('javascript:alert(1)', 'zuri-test'), false);
assert.equal(isCloudinaryUrl('', 'zuri-test'), false);

const goodAttachment = { url: 'https://res.cloudinary.com/zuri-test/image/upload/v1/zuri/u/user-a/leaf.png', name: 'leaf.png', kind: 'image/png', bytes: 2048 };
assert.deepEqual(checkedAttachment(goodAttachment, 'zuri-test'), { ok: true, attachment: goodAttachment });
assert.equal(checkedAttachment({ ...goodAttachment, url: 'https://evil.example.com/x.png' }, 'zuri-test').ok, false);
assert.equal(checkedAttachment({ ...goodAttachment, kind: 'text/html' }, 'zuri-test').ok, false, 'an html file is refused');
assert.equal(checkedAttachment({ ...goodAttachment, bytes: 20 * 1024 * 1024 }, 'zuri-test').ok, false, 'an oversized file is refused');
assert.equal(checkedAttachment({ ...goodAttachment, name: '   ' }, 'zuri-test').ok, false, 'an unnamed file is refused');
assert.equal(checkedAttachment(null, 'zuri-test').attachment, null, 'no attachment is not an error');
console.log('PASS an attachment must come from this cloud and be a picture or a pdf');

// A turn carries its file through the route, and the fileThread returns it.
const fileThread = await callCloud('POST', '/api/me/conversations', { token: tokenA, body: {} });
const fileThreadId = (await fileThread.json()).data.conversation.id;
const withFile = await callCloud('POST', `/api/me/conversations/${fileThreadId}/messages`, {
  token: tokenA,
  body: { role: 'user', content: 'What is wrong with this leaf?', attachment: goodAttachment },
});
assert.equal(withFile.status, 200);
const stored = (await withFile.json()).data.message;
assert.deepEqual(stored.attachment, goodAttachment, 'the file travels with the message');

const refused = await callCloud('POST', `/api/me/conversations/${fileThreadId}/messages`, {
  token: tokenA,
  body: { role: 'user', content: 'look', attachment: { ...goodAttachment, url: 'https://evil.example.com/x.png' } },
});
assert.equal(refused.status, 400);
assert.equal((await refused.json()).error.code, 'INVALID_ATTACHMENT');

const reopened = await callCloud('GET', `/api/me/conversations/${fileThreadId}`, { token: tokenA });
assert.deepEqual((await reopened.json()).data.messages.at(-1).attachment, goodAttachment, 'a reopened fileThread still shows its file');
console.log('PASS a file rides with a turn and comes back with the thread');

// ---------------------------------------------------------------------------
// Pinning and archiving: where a chat belongs.
// ---------------------------------------------------------------------------

const flagRepo = createMemoryRepository();
const flagApp = createApp({ auth, repository: flagRepo, now: fixedNow });
const callFlag = (method, path, { token, body } = {}) => flagApp(new Request(`https://cloud.example.com${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}));

const firstChat = (await (await callFlag('POST', '/api/me/conversations', { token: tokenA, body: {} })).json()).data.conversation;
await callFlag('POST', '/api/me/conversations', { token: tokenA, body: { title: 'Second chat' } });
const secondChat = (await (await callFlag('POST', '/api/me/conversations', { token: tokenA, body: { title: 'Second chat' } })).json()).data.conversation;

const flagPinned = await callFlag('PATCH', `/api/me/conversations/${firstChat.id}`, { token: tokenA, body: { pinned: true } });
assert.equal(flagPinned.status, 200);
assert.equal((await flagPinned.json()).data.conversation.pinned, true);

// The oldest chat is now firstChat, because pinning outranks recency.
const flagListed = (await (await callFlag('GET', '/api/me/conversations', { token: tokenA })).json()).data.conversations;
assert.equal(flagListed[0].id, firstChat.id, 'a pinned chat is held at the top');

// Archiving takes it out of the list but not out of existence.
const flagArchivedList = await callFlag('PATCH', `/api/me/conversations/${secondChat.id}`, { token: tokenA, body: { archived: true } });
assert.equal(flagArchivedList.status, 200);
const afterArchive = (await (await callFlag('GET', '/api/me/conversations', { token: tokenA })).json()).data.conversations;
assert.equal(afterArchive.some((row) => row.id === secondChat.id), false, 'an archived chat leaves the list');
const archiveList = (await (await callFlag('GET', '/api/me/conversations?archived=1', { token: tokenA })).json()).data.conversations;
assert.equal(archiveList.some((row) => row.id === secondChat.id), true, 'the archive can be asked for');
assert.equal((await callFlag('GET', `/api/me/conversations/${secondChat.id}`, { token: tokenA })).status, 200, 'an archived chat still opens');

// Pinning brings a filed chat back, because a chat cannot be both filed and held.
await callFlag('PATCH', `/api/me/conversations/${secondChat.id}`, { token: tokenA, body: { pinned: true } });
const flagRestored = (await (await callFlag('GET', '/api/me/conversations', { token: tokenA })).json()).data.conversations;
const restoredRow = flagRestored.find((row) => row.id === secondChat.id);
assert.equal(restoredRow.pinned, true);
assert.equal(restoredRow.archived, false, 'pinning lifts a chat out of the archive');

// Flags belong to the owner, and a rename still works beside them.
assert.equal((await callFlag('PATCH', `/api/me/conversations/${firstChat.id}`, { token: tokenB, body: { pinned: true } })).status, 404);
const flagRenamed = await callFlag('PATCH', `/api/me/conversations/${firstChat.id}`, { token: tokenA, body: { title: 'Leaf question' } });
assert.equal((await flagRenamed.json()).data.conversation.title, 'Leaf question');
console.log('PASS a chat can be pinned, archived and brought back');
