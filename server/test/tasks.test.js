import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth.js';

const fixedNow = () => new Date('2026-10-29T09:00:00.000Z');

/**
 * Tasks and reminders kept in memory, so the routes are exercised end to end without
 * a database.
 *
 * The per-account cap and the ordering live in SQL and are not repeated here. What
 * this fake does copy is the one rule the routes depend on: every read and write
 * matches on the owner as well as the id, so an id belonging to another account comes
 * back as nothing. It also records the owner each call was given, which is the only
 * way a test can see that the route used the token and not the body.
 * @returns {object} the repository the app is built with, plus seedTask
 */
function createMemoryRepository() {
  const tasks = new Map();
  const reminders = new Map();
  let seed = 0;

  const stamp = () => fixedNow().toISOString();

  function owned(map, userId, id) {
    const row = map.get(id);
    return row && row.userId === userId ? row : null;
  }

  function publicTask(row) {
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      due: row.due,
      priority: row.priority,
      done: row.done,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function publicReminder(row) {
    return {
      id: row.id,
      title: row.title,
      dueAt: row.dueAt,
      repeat: row.repeat,
      intervalMinutes: row.intervalMinutes,
      timeOfDay: row.timeOfDay,
      done: row.done,
      createdAt: row.createdAt,
    };
  }

  // The owners each call was handed, in order, so a test can prove the account came
  // from the session rather than from anything the request carried.
  const taskOwners = [];
  const reminderOwners = [];

  return {
    taskOwners,
    reminderOwners,

    async listTasks(userId) {
      taskOwners.push(userId);
      return [...tasks.values()].filter((row) => row.userId === userId).map(publicTask);
    },
    async createTask({ userId, title, notes, due, priority }) {
      taskOwners.push(userId);
      const row = { id: `task-${(seed += 1)}`, userId, title, notes, due, priority, done: false, createdAt: stamp(), updatedAt: stamp() };
      tasks.set(row.id, row);
      return publicTask(row);
    },
    // A null field is "not sent", exactly as the SQL COALESCE reads it, so a tick on
    // the box cannot clear the title or the notes.
    async updateTask({ userId, id, title = null, notes = null, due = null, priority = null, done = null }) {
      taskOwners.push(userId);
      const row = owned(tasks, userId, id);
      if (!row) return null;
      if (title !== null) row.title = title;
      if (notes !== null) row.notes = notes;
      if (due !== null) row.due = due;
      if (priority !== null) row.priority = priority;
      if (done !== null) row.done = done;
      row.updatedAt = stamp();
      return publicTask(row);
    },
    async deleteTask({ userId, id }) {
      taskOwners.push(userId);
      if (!owned(tasks, userId, id)) return 0;
      tasks.delete(id);
      return 1;
    },

    async listReminders(userId) {
      reminderOwners.push(userId);
      return [...reminders.values()].filter((row) => row.userId === userId).map(publicReminder);
    },
    async createReminder({ userId, title, dueAt, repeat, intervalMinutes, timeOfDay }) {
      reminderOwners.push(userId);
      const row = { id: `reminder-${(seed += 1)}`, userId, title, dueAt, repeat, intervalMinutes, timeOfDay, done: false, createdAt: stamp() };
      reminders.set(row.id, row);
      return publicReminder(row);
    },
    async updateReminder({ userId, id, done }) {
      reminderOwners.push(userId);
      const row = owned(reminders, userId, id);
      if (!row) return null;
      row.done = done;
      return publicReminder(row);
    },
    async deleteReminder({ userId, id }) {
      reminderOwners.push(userId);
      if (!owned(reminders, userId, id)) return 0;
      reminders.delete(id);
      return 1;
    },

    /** Put a row in place without going through a route, as another account's would be. */
    seedTask(row) {
      tasks.set(row.id, { notes: '', due: '', priority: 'normal', done: false, createdAt: stamp(), updatedAt: stamp(), ...row });
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
        // No subscription on purpose: a to-do costs nothing to store, so these routes
        // must work for an account that has not paid for anything.
        subscription: null,
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

/** @param {Response} response @returns {Promise<any>} */
async function bodyOf(response) {
  return (await response.json()).data;
}

// A to-do list belongs to one account, so nothing about it is readable without a
// token, and the owner is never something the request can claim.
const anonymousList = await call('GET', '/api/tasks');
assert.equal(anonymousList.status, 401);
assert.equal((await anonymousList.json()).error.code, 'AUTH_REQUIRED');
const anonymousCreate = await call('POST', '/api/tasks', { body: { title: 'Anything' } });
assert.equal(anonymousCreate.status, 401);
assert.equal((await anonymousCreate.json()).error.code, 'AUTH_REQUIRED');
assert.equal((await call('GET', '/api/reminders')).status, 401);
console.log('PASS an unsigned request to the task and reminder routes is refused with 401');

const send = (await bodyOf(await call('POST', '/api/tasks', {
  token: tokenA,
  body: { title: '  Send Zuri to Greg  ', due: '2026-11-02' },
}))).task;
assert.equal(send.title, 'Send Zuri to Greg', 'the title arrives trimmed');
assert.equal(send.done, false, 'a new task starts open');
assert.equal(send.priority, 'normal', 'the ordinary priority is the default');
assert.equal(send.due, '2026-11-02', 'the date is kept exactly as it was typed');

const listed = (await bodyOf(await call('GET', '/api/tasks', { token: tokenA }))).tasks;
assert.deepEqual(listed.map((row) => row.id), [send.id]);
// The owner handed to the repository is the session's account. This is the closest a
// fake repository can come to proving the SQL is scoped per user.
assert.ok(repository.taskOwners.length >= 2);
assert.deepEqual([...new Set(repository.taskOwners)], ['user-a'], 'the session account is the owner of every call');
console.log('PASS a task is created, comes back not done, and is listed for its owner');

// A blank name is an unfinished form, not a task called nothing.
const blank = await call('POST', '/api/tasks', { token: tokenA, body: { title: '   ' } });
assert.equal(blank.status, 400);
assert.equal((await blank.json()).error.code, 'TASK_TITLE_REQUIRED');
console.log('PASS a title of spaces is refused');

// The screens only know three priorities, so a fourth has to be refused rather than
// stored and drawn as nothing.
const urgent = await call('POST', '/api/tasks', { token: tokenA, body: { title: 'Fix the roof', priority: 'urgent' } });
assert.equal(urgent.status, 400);
assert.equal((await urgent.json()).error.code, 'TASK_PRIORITY_INVALID');
console.log('PASS a priority outside low, normal and high is refused');

const ticked = (await bodyOf(await call('PATCH', `/api/tasks/${send.id}`, { token: tokenA, body: { done: true } }))).task;
assert.equal(ticked.done, true);
assert.equal(ticked.title, 'Send Zuri to Greg', 'ticking the box leaves the other fields alone');
assert.equal(ticked.due, '2026-11-02');
console.log('PASS marking a task done changes only the done flag');

const deleted = await call('DELETE', `/api/tasks/${send.id}`, { token: tokenA });
assert.equal(deleted.status, 200);
assert.equal((await bodyOf(deleted)).id, send.id);
assert.deepEqual((await bodyOf(await call('GET', '/api/tasks', { token: tokenA }))).tasks, []);
assert.equal((await call('DELETE', `/api/tasks/${send.id}`, { token: tokenA })).status, 404);
console.log('PASS a deleted task is gone and deleting it again answers 404');

// An id belonging to another account is answered exactly like one that never
// existed, so ids cannot be probed from one account to the next.
repository.seedTask({ id: 'task-foreign', userId: 'user-b', title: 'Bells own list' });
const foreign = await call('PATCH', '/api/tasks/task-foreign', { token: tokenA, body: { done: true } });
assert.equal(foreign.status, 404);
assert.equal((await foreign.json()).error.code, 'TASK_NOT_FOUND');
const foreignDelete = await call('DELETE', '/api/tasks/task-foreign', { token: tokenA });
assert.equal(foreignDelete.status, 404);
assert.equal((await foreignDelete.json()).error.code, 'TASK_NOT_FOUND');
console.log('PASS another account owns that task, so it answers 404 rather than changing it');

// A reminder that cannot be placed at an instant could never go off, so it is refused
// instead of being stored with a guessed time.
const bogusDue = await call('POST', '/api/reminders', { token: tokenA, body: { title: 'Call Greg', dueAt: 'tomorrow-ish' } });
assert.equal(bogusDue.status, 400);
assert.equal((await bogusDue.json()).error.code, 'REMINDER_INVALID_DUE');

const monthly = await call('POST', '/api/reminders', {
  token: tokenA,
  body: { title: 'Pay the rent', dueAt: '2026-11-01T08:00:00Z', repeat: 'monthly' },
});
assert.equal(monthly.status, 400);
assert.equal((await monthly.json()).error.code, 'REMINDER_REPEAT_INVALID');
console.log('PASS a reminder needs a real dueAt and a repeat it can schedule');

const daily = (await bodyOf(await call('POST', '/api/reminders', {
  token: tokenA,
  body: { title: 'Take the tablets', dueAt: '2026-10-30T07:30:00Z', repeat: 'daily', timeOfDay: '07:30' },
}))).reminder;
assert.equal(daily.repeat, 'daily');
assert.equal(daily.timeOfDay, '07:30');
assert.equal(daily.dueAt, '2026-10-30T07:30:00.000Z', 'the instant is stored in one standard form');
assert.equal(daily.done, false);

const reminders = (await bodyOf(await call('GET', '/api/reminders', { token: tokenA }))).reminders;
assert.deepEqual(reminders.map((row) => row.id), [daily.id]);
assert.deepEqual([...new Set(repository.reminderOwners)], ['user-a'], 'the session account is the owner of every call');
console.log('PASS a daily reminder is created and listed for its owner only');

const doneReminder = (await bodyOf(await call('PATCH', `/api/reminders/${daily.id}`, { token: tokenA, body: { done: true } }))).reminder;
assert.equal(doneReminder.done, true);
const deletedReminder = await call('DELETE', `/api/reminders/${daily.id}`, { token: tokenA });
assert.equal(deletedReminder.status, 200);
assert.equal((await bodyOf(deletedReminder)).id, daily.id);
assert.deepEqual((await bodyOf(await call('GET', '/api/reminders', { token: tokenA }))).reminders, []);
console.log('PASS a reminder is ticked off, then deleted');

// Account B still sees its own seeded row, and nothing of account A's: the split is
// by owner, not by luck.
const bells = (await bodyOf(await call('GET', '/api/tasks', { token: tokenB }))).tasks;
assert.deepEqual(bells.map((row) => row.id), ['task-foreign'], 'the other account list never sees these rows');
