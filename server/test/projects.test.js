import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth.js';
import { PROJECT_FILE_CONTENT_MAX_LENGTH } from '../src/db.js';

const fixedNow = () => new Date('2026-10-28T09:00:00.000Z');

/**
 * Projects, their files and the chats filed under them, kept in memory so the
 * routes are exercised end to end without a database and without a network call.
 * @returns {object} the repository the app is built with, plus seedConversation
 */
function createMemoryRepository() {
  const projects = new Map();
  const files = new Map();
  const conversations = new Map();
  let projectSeed = 0;
  let fileSeed = 0;

  const stamp = () => fixedNow().toISOString();

  // An id owned by another account answers exactly like a missing one, which is
  // what stops one account probing another's ids.
  function ownedProject(userId, projectId) {
    const row = projects.get(projectId);
    return row && row.userId === userId ? row : null;
  }

  const filesOf = (projectId) => [...files.values()].filter((file) => file.projectId === projectId);
  const chatsOf = (projectId) => [...conversations.values()].filter((row) => row.projectId === projectId);

  function publicProject(row) {
    return {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      fileCount: filesOf(row.id).length,
      conversationCount: chatsOf(row.id).length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // A file row ships the length of its text, never the text: the detail answer has
  // to stay small however large the reference is.
  function publicFile(row) {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      bytes: row.bytes,
      url: row.url,
      contentLength: row.content.length,
      createdAt: row.createdAt,
    };
  }

  function publicChat(row) {
    return {
      id: row.id,
      title: row.title,
      model: row.model,
      origin: row.origin,
      pinned: row.pinned,
      archived: row.archived,
      messageCount: 0,
      projectId: row.projectId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async listProjects(userId) {
      return [...projects.values()]
        .filter((row) => row.userId === userId)
        .map(publicProject);
    },

    async createProject({ userId, name, instructions }) {
      projectSeed += 1;
      const row = { id: `project-${projectSeed}`, userId, name, instructions, createdAt: stamp(), updatedAt: stamp() };
      projects.set(row.id, row);
      return publicProject(row);
    },

    async getProject(userId, projectId) {
      const row = ownedProject(userId, projectId);
      if (!row) return null;
      return { project: publicProject(row), files: filesOf(row.id).map(publicFile) };
    },

    async updateProject(userId, projectId, changes) {
      const row = ownedProject(userId, projectId);
      if (!row) return null;
      // Null means "this field was not sent", not "set it to nothing".
      if (changes.name !== null) row.name = changes.name;
      if (changes.instructions !== null) row.instructions = changes.instructions;
      row.updatedAt = stamp();
      return publicProject(row);
    },

    async deleteProject(userId, projectId) {
      const row = ownedProject(userId, projectId);
      if (!row) return false;
      projects.delete(row.id);
      for (const file of filesOf(row.id)) files.delete(file.id);
      // Chats outlive the project they were filed under: they fall back to plain history.
      for (const chat of chatsOf(row.id)) chat.projectId = null;
      return true;
    },

    async addProjectFile({ userId, projectId, name, kind, bytes, url, content }) {
      const row = ownedProject(userId, projectId);
      if (!row) return null;
      fileSeed += 1;
      const file = { id: `file-${fileSeed}`, projectId: row.id, name, kind, bytes, url, content, createdAt: stamp() };
      files.set(file.id, file);
      return publicFile(file);
    },

    async deleteProjectFile(userId, projectId, fileId) {
      const row = ownedProject(userId, projectId);
      if (!row) return false;
      const file = files.get(fileId);
      if (!file || file.projectId !== row.id) return false;
      files.delete(fileId);
      return true;
    },

    async listConversations(userId, search, includeArchived, projectId) {
      return [...conversations.values()]
        .filter((row) => row.userId === userId)
        .filter((row) => (projectId ? row.projectId === projectId : true))
        .map(publicChat);
    },

    async setConversationProject(userId, conversationId, projectId) {
      const chat = conversations.get(conversationId);
      if (!chat || chat.userId !== userId) return null;
      // Filing a chat under somebody else's project is refused like a missing project.
      if (projectId !== null && !ownedProject(userId, projectId)) return null;
      chat.projectId = projectId;
      chat.updatedAt = stamp();
      return publicChat(chat);
    },

    async projectContext(userId, projectId) {
      const row = ownedProject(userId, projectId);
      if (!row) return null;
      return {
        name: row.name,
        instructions: row.instructions,
        files: filesOf(row.id).map((file) => ({ name: file.name, content: file.content })),
      };
    },

    // The chat route reserves the whole request envelope before it calls a supplier.
    async reserveUsage() {
      return { id: 'reservation-1' };
    },
    async commitUsage() {},
    async releaseUsage() {},

    /** Put a chat in place without going through a route, as an older thread would be. */
    seedConversation(row) {
      conversations.set(row.id, {
        pinned: false,
        archived: false,
        projectId: null,
        model: 'zuri-flash',
        origin: 'web',
        createdAt: stamp(),
        updatedAt: stamp(),
        ...row,
      });
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
    async findSessionUser(tokenHash) {
      const session = issued.get(tokenHash);
      if (!session) return null;
      return {
        user: accounts.get(session.userId),
        // Paid only: the chat route refuses an account without a live subscription.
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
repository.seedConversation({ id: 'thread-1', userId: 'user-a', title: 'Launch questions' });

// The supplier is faked, never called: every request is recorded so a test can read
// the prompt the chat route actually built.
const supplierCalls = [];
const app = createApp({
  auth,
  repository,
  cloudinary: { cloudName: 'zuri-test', apiKey: 'key', apiSecret: 'secret' },
  chatProvider: async (request) => {
    supplierCalls.push(request);
    return { content: 'The launch is on 14 November.', model: 'deepseek-flash', usage: { inputTokens: 120, outputTokens: 12 } };
  },
  now: fixedNow,
});

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

/** @param {Response} response @returns {Promise<any>} */
async function bodyOf(response) {
  return (await response.json()).data;
}

// An account that is not signed in never reaches a project, so nothing about the
// feature is readable without a token.
const anonymous = await call('GET', '/api/me/projects');
assert.equal(anonymous.status, 401);
assert.equal((await anonymous.json()).error.code, 'AUTH_REQUIRED');
assert.equal((await call('GET', '/api/me/projects', { token: 'not-a-token' })).status, 401);
console.log('PASS an unsigned request to the project list is refused with 401');

// A blank name is an unfinished form, not a project called nothing.
const blank = await call('POST', '/api/me/projects', { token: tokenA, body: { name: '   ' } });
assert.equal(blank.status, 400);
assert.equal((await blank.json()).error.code, 'INVALID_MESSAGE');

const launch = (await bodyOf(await call('POST', '/api/me/projects', {
  token: tokenA,
  body: { name: '  Launch plan  ', instructions: 'Answer in British English.' },
}))).project;
assert.equal(launch.name, 'Launch plan', 'the name arrives trimmed');
assert.equal(launch.instructions, 'Answer in British English.');
assert.equal(launch.fileCount, 0);
assert.equal(launch.conversationCount, 0);
assert.equal(typeof launch.createdAt, 'string');

const second = (await bodyOf(await call('POST', '/api/me/projects', { token: tokenA, body: { name: 'Second project' } }))).project;
const listA = (await bodyOf(await call('GET', '/api/me/projects', { token: tokenA }))).projects;
const listB = (await bodyOf(await call('GET', '/api/me/projects', { token: tokenB }))).projects;
assert.deepEqual(listA.map((row) => row.id).sort(), [launch.id, second.id].sort());
assert.equal(listB.length, 0, 'another account sees none of these projects');
console.log('PASS a project is created and listed for its owner only');

// A project of another account answers exactly like an id that never existed, so
// ids cannot be probed from one account to the next.
const foreign = await call('GET', `/api/me/projects/${launch.id}`, { token: tokenB });
assert.equal(foreign.status, 404);
assert.equal((await foreign.json()).error.code, 'PROJECT_NOT_FOUND');
assert.equal((await call('GET', '/api/me/projects/project-that-never-was', { token: tokenA })).status, 404);
console.log('PASS a project of another account answers 404 rather than 403 or 200');

// One field at a time: sending only the instructions must not reset the name, and
// the other way round.
const instructed = (await bodyOf(await call('PATCH', `/api/me/projects/${launch.id}`, {
  token: tokenA,
  body: { instructions: 'Use short sentences.' },
}))).project;
assert.equal(instructed.name, 'Launch plan');
assert.equal(instructed.instructions, 'Use short sentences.');
const renamed = (await bodyOf(await call('PATCH', `/api/me/projects/${launch.id}`, {
  token: tokenA,
  body: { name: 'Launch plan 2027' },
}))).project;
assert.equal(renamed.name, 'Launch plan 2027');
assert.equal(renamed.instructions, 'Use short sentences.');
console.log('PASS an update changes only the fields that were sent');

// A text file travels inline and keeps its text; a picture travels as a link that
// has to be this account's own upload, which is the only guard against a chat
// pointing at an arbitrary address.
const briefText = 'Launch is on 14 November.';
const brief = (await bodyOf(await call('POST', `/api/me/projects/${launch.id}/files`, {
  token: tokenA,
  body: { name: 'brief.txt', content: briefText },
}))).file;
assert.equal(brief.name, 'brief.txt');
assert.equal(brief.kind, 'text/plain');
assert.equal(brief.contentLength, briefText.length);
assert.equal(brief.content, undefined, 'the stored text is not sent back with the row');

const leaf = (await bodyOf(await call('POST', `/api/me/projects/${launch.id}/files`, {
  token: tokenA,
  body: { name: 'leaf.png', kind: 'image/png', bytes: 2048, url: 'https://res.cloudinary.com/zuri-test/image/upload/v1/leaf.png' },
}))).file;
assert.equal(leaf.kind, 'image/png');
assert.equal(leaf.url, 'https://res.cloudinary.com/zuri-test/image/upload/v1/leaf.png');
assert.equal(leaf.contentLength, 0);

const otherCloud = await call('POST', `/api/me/projects/${launch.id}/files`, {
  token: tokenA,
  body: { name: 'other.png', kind: 'image/png', bytes: 2048, url: 'https://res.cloudinary.com/another-cloud/image/upload/v1/leaf.png' },
});
assert.equal(otherCloud.status, 400);
assert.equal((await otherCloud.json()).error.code, 'INVALID_FILE');
console.log('PASS a text file keeps its text and a picture must come from this account own cloud');

// The prompt reads every file, so one oversized reference would spend the plan's
// input allowance on its own.
const oversized = await call('POST', `/api/me/projects/${launch.id}/files`, {
  token: tokenA,
  body: { name: 'huge.txt', content: 'x'.repeat(PROJECT_FILE_CONTENT_MAX_LENGTH + 1) },
});
assert.equal(oversized.status, 400);
assert.equal((await oversized.json()).error.code, 'INVALID_FILE');
console.log('PASS a project file over the content limit is refused');

const scratch = (await bodyOf(await call('POST', `/api/me/projects/${launch.id}/files`, {
  token: tokenA,
  body: { name: 'scratch.txt', content: 'Throw this away.' },
}))).file;
const removed = await call('DELETE', `/api/me/projects/${launch.id}/files/${scratch.id}`, { token: tokenA });
assert.equal(removed.status, 200);
assert.equal((await removed.json()).data.deleted, true);
const missingFile = await call('DELETE', `/api/me/projects/${launch.id}/files/${scratch.id}`, { token: tokenA });
assert.equal(missingFile.status, 404);
assert.equal((await missingFile.json()).error.code, 'PROJECT_NOT_FOUND');
console.log('PASS a removed project file is gone and a missing one answers 404');

// A chat is filed from its own row menu, and null puts it back in plain history.
const theirs = (await bodyOf(await call('POST', '/api/me/projects', { token: tokenB, body: { name: 'Their project' } }))).project;
const filed = (await bodyOf(await call('PATCH', '/api/me/conversations/thread-1', {
  token: tokenA,
  body: { projectId: launch.id },
}))).conversation;
assert.equal(filed.projectId, launch.id);
const unfiled = (await bodyOf(await call('PATCH', '/api/me/conversations/thread-1', {
  token: tokenA,
  body: { projectId: null },
}))).conversation;
assert.equal(unfiled.projectId, null);
const crossAccount = await call('PATCH', '/api/me/conversations/thread-1', {
  token: tokenA,
  body: { projectId: theirs.id },
});
assert.equal(crossAccount.status, 404);
assert.equal((await crossAccount.json()).error.code, 'CONVERSATION_NOT_FOUND');
// Filed again, so the project detail below has a chat to carry.
await call('PATCH', '/api/me/conversations/thread-1', { token: tokenA, body: { projectId: launch.id } });
console.log('PASS a chat moves into a project and back out again');

// The whole screen in one answer: the project, its files and the chats inside it.
const detail = await bodyOf(await call('GET', `/api/me/projects/${launch.id}`, { token: tokenA }));
assert.equal(detail.project.id, launch.id);
assert.deepEqual(detail.files.map((file) => file.name).sort(), ['brief.txt', 'leaf.png']);
assert.equal(detail.conversations.length, 1);
assert.equal(detail.conversations[0].id, 'thread-1');
console.log('PASS one read of a project returns the project, its files and its chats');

const deleted = await call('DELETE', `/api/me/projects/${second.id}`, { token: tokenA });
assert.equal(deleted.status, 200);
assert.equal((await deleted.json()).data.deleted, true);
const deletedAgain = await call('DELETE', `/api/me/projects/${second.id}`, { token: tokenA });
assert.equal(deletedAgain.status, 404);
assert.equal((await deletedAgain.json()).error.code, 'PROJECT_NOT_FOUND');
console.log('PASS deleting a project answers deleted true and a second delete answers 404');

// A chat inside a project is answered with that project's standing instructions,
// without the person repeating them in the thread.
const support = (await bodyOf(await call('POST', '/api/me/projects', {
  token: tokenA,
  body: { name: 'Support replies', instructions: 'Always answer in British English and quote the file you used.' },
}))).project;
await call('POST', `/api/me/projects/${support.id}/files`, {
  token: tokenA,
  body: { name: 'brief.txt', content: briefText },
});

supplierCalls.length = 0;
const chat = await call('POST', '/api/chat', {
  token: tokenA,
  body: { messages: [{ role: 'user', content: 'When do we launch?' }], model: 'zuri-flash', projectId: support.id },
});
assert.equal(chat.status, 200);
const sent = supplierCalls[0].messages;
assert.equal(sent[0].role, 'system', 'the project context is the first message the supplier sees');
assert.ok(sent[0].content.includes('Always answer in British English and quote the file you used.'), 'the standing instructions reach the supplier');
assert.ok(sent[0].content.includes('Support replies'), 'the prompt names the project it answers inside');
assert.ok(sent.some((message) => message.role === 'user' && message.content === 'When do we launch?'));
console.log('PASS a chat inside a project sends the project instructions to the supplier');

// The text of a reference file is quoted under its own name so a reply can say
// which file it read. A picture has no text to quote, so no text is ever quoted
// for it, and a file past the shared budget is named without its text.
await call('POST', `/api/me/projects/${support.id}/files`, {
  token: tokenA,
  body: { name: 'leaf.png', kind: 'image/png', bytes: 2048, url: 'https://res.cloudinary.com/zuri-test/image/upload/v1/leaf.png' },
});
await call('POST', `/api/me/projects/${support.id}/files`, {
  token: tokenA,
  body: { name: 'notes.md', content: 'n'.repeat(PROJECT_FILE_CONTENT_MAX_LENGTH) },
});

supplierCalls.length = 0;
const quoted = await call('POST', '/api/chat', {
  token: tokenA,
  body: { messages: [{ role: 'user', content: 'What is in the brief?' }], model: 'zuri-flash', projectId: support.id },
});
assert.equal(quoted.status, 200);
const prompt = supplierCalls[0].messages[0].content;
assert.ok(prompt.includes('--- brief.txt ---'), 'the text file is named');
assert.ok(prompt.includes(briefText), 'and its text is quoted');
assert.ok(prompt.includes('--- notes.md ---'), 'a file past the budget is still named');
assert.ok(prompt.includes('(too long to include in full)'));
// The picture carries no text, so nothing may be quoted under its name.
assert.ok(!/--- leaf\.png ---\n\S/.test(prompt));
console.log('PASS the prompt quotes a project text file and quotes no text for a picture');


// The same question asked outside a project must not carry a project's standing
// instructions: a chat filed nowhere is answered by Zuri alone, not by a brief
// somebody wrote for a different piece of work.
supplierCalls.length = 0;
const loose = await call('POST', '/api/chat', {
  token: tokenA,
  body: { messages: [{ role: 'user', content: 'When do we launch?' }], model: 'zuri-flash' },
});
assert.equal(loose.status, 200);
const looseSent = supplierCalls[0].messages;
assert.ok(
  !looseSent.some((message) => message.role === 'system' && message.content.includes('--- brief.txt ---')),
  'a chat outside a project quotes none of its reference files',
);
assert.ok(
  !looseSent.some((message) => typeof message.content === 'string' && message.content.includes('Always answer in British English')),
  'and none of its standing instructions',
);
console.log('PASS a chat outside a project carries none of its instructions or files');
console.log('\nPASS every project behaviour holds');
