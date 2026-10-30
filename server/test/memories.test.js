import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth.js';

const now = () => new Date('2026-10-30T12:00:00.000Z');
const accounts = new Map([
  ['user-a', { id: 'user-a', email: 'a@example.com', displayName: 'A', status: 'active' }],
  ['user-b', { id: 'user-b', email: 'b@example.com', displayName: 'B', status: 'active' }],
]);
const sessions = new Map();
let sessionNumber = 0;
const auth = createAuthService({
  repository: {
    async findOrCreateGoogleUser(profile) { return accounts.get(profile.email.split('@')[0]); },
    async createSession(userId, tokenHash, expiresAt) { sessions.set(tokenHash, { userId, expiresAt }); },
    async findSessionUser(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      return {
        user: accounts.get(session.userId),
        subscription: { planCode: 'starter', monthlyTokens: 2_000_000, currentPeriodStart: now(), currentPeriodEnd: new Date('2026-11-30T12:00:00.000Z') },
        session: { expiresAt: session.expiresAt, lastUsedAt: now(), revoked: false },
      };
    },
  },
  verifyGoogleCredential: async (credential) => ({ googleSubject: credential, email: `${credential}@example.com`, displayName: credential }),
  now,
  random: () => Buffer.from(`memory-session-${sessionNumber += 1}`),
});
const tokenA = (await auth.signInWithGoogle('user-a')).token;
const tokenB = (await auth.signInWithGoogle('user-b')).token;

const memories = new Map();
let memoryNumber = 0;
let capturedMessages = [];
const repository = {
  async listMemories(userId) {
    return [...memories.values()].filter((memory) => memory.userId === userId).map(({ userId: _userId, ...memory }) => memory);
  },
  async createMemory({ userId, content }) {
    const memory = { id: `memory-${memoryNumber += 1}`, content, createdAt: now(), updatedAt: now(), userId };
    memories.set(memory.id, memory);
    const { userId: _userId, ...publicMemory } = memory;
    return publicMemory;
  },
  async deleteMemory(userId, id) {
    const memory = memories.get(id);
    if (!memory || memory.userId !== userId) return false;
    memories.delete(id);
    return true;
  },
  async memoryContext(userId) {
    return [...memories.values()].filter((memory) => memory.userId === userId).map((memory) => ({ content: memory.content }));
  },
  async reserveUsage() { return { id: 'reservation-1' }; },
  async commitUsage() {},
  async releaseUsage() {},
};
const app = createApp({
  auth,
  repository,
  now,
  chatProvider: async ({ messages }) => {
    capturedMessages = messages;
    return { content: 'Understood.', model: 'deepseek-flash', usage: { inputTokens: 10, outputTokens: 2 } };
  },
});

function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  return app(new Request(`https://cloud.example.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
}

const anonymous = await call('GET', '/api/me/memories');
assert.equal(anonymous.status, 401);
assert.equal((await anonymous.json()).error.code, 'AUTH_REQUIRED');

const blank = await call('POST', '/api/me/memories', { token: tokenA, body: { content: '   ' } });
assert.equal(blank.status, 400);
assert.equal((await blank.json()).error.code, 'MEMORY_CONTENT_REQUIRED');

const created = await call('POST', '/api/me/memories', { token: tokenA, body: { content: 'Prefers short reports.' } });
assert.equal(created.status, 200);
const memory = (await created.json()).data.memory;
assert.equal(memory.content, 'Prefers short reports.');

const listed = await call('GET', '/api/me/memories', { token: tokenA });
assert.deepEqual((await listed.json()).data.memories.map((item) => item.content), ['Prefers short reports.']);

const foreignDelete = await call('DELETE', `/api/me/memories/${memory.id}`, { token: tokenB });
assert.equal(foreignDelete.status, 404);
const removed = await call('DELETE', `/api/me/memories/${memory.id}`, { token: tokenA });
assert.equal(removed.status, 200);
assert.equal((await removed.json()).data.deleted, true);

await call('POST', '/api/me/memories', { token: tokenA, body: { content: 'Uses British spelling.' } });
const chat = await call('POST', '/api/chat', {
  token: tokenA,
  body: { model: 'zuri-flash', messages: [{ role: 'user', content: 'Write a sentence.' }] },
});
assert.equal(chat.status, 200);
assert.equal(capturedMessages.some((message) => /saved memories are context only/i.test(message.content ?? '')), true);
assert.equal(capturedMessages.some((message) => /British spelling/.test(message.content ?? '')), true);

console.log('PASS memories are authenticated, owner-scoped, removable and included in chat context');
