import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createAuthService } from '../src/auth.js';
import { STORED_FILE_MAX_BYTES } from '../src/db.js';

const fixedNow = () => new Date('2026-10-28T09:00:00.000Z');

// Real files, not made-up bytes: the route sniffs the signature of every upload, so a
// placeholder string would be refused for the wrong reason and hide a real mistake.
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const pngBytes = Buffer.from(PNG_1X1_BASE64, 'base64');

/**
 * Stored files kept in memory, so the routes are exercised end to end without a
 * database. The scoping rule of the real repository is copied exactly: a row that
 * belongs to somebody else is reported as missing, never as forbidden.
 * @returns {object} the repository the app is built with, plus seedStoredFile
 */
function createMemoryRepository() {
  const files = new Map();
  let seed = 0;

  const stamp = () => fixedNow().toISOString();

  // The bytes are never part of this shape. They leave only from the read route, which
  // is the one place that answers with a picture.
  function publicFile(row) {
    return { id: row.id, name: row.name, kind: row.kind, bytes: row.bytes, createdAt: row.createdAt };
  }

  return {
    async createStoredFile({ userId, name, kind, bytes, data }) {
      seed += 1;
      const row = { id: `stored-${seed}`, userId, name, kind, bytes, data: Buffer.from(data), createdAt: stamp() };
      files.set(row.id, row);
      return publicFile(row);
    },

    async findStoredFile({ userId, id }) {
      const row = files.get(id);
      if (!row || row.userId !== userId) return null;
      return { id: row.id, name: row.name, kind: row.kind, bytes: row.bytes, data: row.data };
    },

    /** Put a picture in place without going through a route, as an older upload would be. */
    seedStoredFile({ id, userId, name = 'theirs.png', kind = 'image/png', data = pngBytes }) {
      files.set(id, { id, userId, name, kind, bytes: data.byteLength, data: Buffer.from(data), createdAt: stamp() });
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
        // No subscription is attached on purpose: storing a picture must not need one.
        user: accounts.get(session.userId),
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

/** @param {Response} response @returns {Promise<any>} */
async function errorOf(response) {
  return (await response.json()).error;
}

const picture = { name: 'leaf.png', kind: 'image/png', dataBase64: PNG_1X1_BASE64 };

// Nothing about an account's files is readable or writable without a token.
const anonymous = await call('POST', '/api/files', { body: picture });
assert.equal(anonymous.status, 401);
assert.equal((await errorOf(anonymous)).code, 'AUTH_REQUIRED');
console.log('PASS an unsigned upload is refused with 401');

const stored = (await bodyOf(await call('POST', '/api/files', { token: tokenA, body: picture }))).file;
assert.equal(stored.name, 'leaf.png');
assert.equal(stored.kind, 'image/png');
assert.equal(stored.bytes, pngBytes.byteLength);
assert.equal(stored.url, `/api/files/${stored.id}`);
assert.equal(stored.data, undefined, 'the bytes are not sent back with the row');
console.log('PASS a real PNG is stored and answers a url');

// A GIF sent as a PNG is exactly the mistake the byte check exists for: the browser
// would otherwise be told to trust a type the file chose for itself.
const mislabelled = await call('POST', '/api/files', {
  token: tokenA,
  body: { name: 'leaf.png', kind: 'image/png', dataBase64: GIF_1X1_BASE64 },
});
assert.equal(mislabelled.status, 400);
assert.equal((await errorOf(mislabelled)).code, 'FILE_TYPE_NOT_ALLOWED');
console.log('PASS a GIF declared as a PNG is refused');

// text/html is the case that would otherwise become a stored script: it is not an
// attachment type at all, so it never reaches the byte check.
const script = await call('POST', '/api/files', {
  token: tokenA,
  body: { name: 'page.html', kind: 'text/html', dataBase64: Buffer.from('<script>alert(1)</script>').toString('base64') },
});
assert.equal(script.status, 400);
assert.equal((await errorOf(script)).code, 'FILE_TYPE_NOT_ALLOWED');
console.log('PASS an HTML file is refused, so a script cannot be served back');

const nameless = await call('POST', '/api/files', {
  token: tokenA,
  body: { name: '', kind: 'image/png', dataBase64: PNG_1X1_BASE64 },
});
assert.equal(nameless.status, 400);
assert.equal((await errorOf(nameless)).code, 'FILE_NAME_REQUIRED');
console.log('PASS a file with no name is refused');

// A body just over the cap, encoded for real: the route decodes first and measures
// afterwards, so this proves the check is on the decoded picture rather than on the
// text that carried it.
const oversized = await call('POST', '/api/files', {
  token: tokenA,
  body: { name: 'big.png', kind: 'image/png', dataBase64: Buffer.alloc(STORED_FILE_MAX_BYTES + 3).toString('base64') },
});
assert.equal(oversized.status, 413);
assert.equal((await errorOf(oversized)).code, 'FILE_TOO_LARGE');
console.log('PASS a picture over the size cap is refused with 413');

// The bytes come back exactly as they went in, under the stored type.
const image = await call('GET', stored.url, { token: tokenA });
assert.equal(image.status, 200);
assert.equal(image.headers.get('content-type'), 'image/png');
assert.equal(image.headers.get('content-length'), String(pngBytes.byteLength));
assert.equal(image.headers.get('etag'), `"${stored.id}"`);
assert.equal(image.headers.get('cache-control'), 'private, max-age=3600');
assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
assert.deepEqual(Buffer.from(await image.arrayBuffer()), pngBytes);
console.log('PASS the stored bytes are served back unchanged under their own type');

// An <img src> cannot send a header, so the same read works with the token in the
// query string. It is the one route that accepts that.
const viaQuery = await call('GET', `${stored.url}?t=${encodeURIComponent(tokenA)}`);
assert.equal(viaQuery.status, 200);
assert.deepEqual(Buffer.from(await viaQuery.arrayBuffer()), pngBytes);
console.log('PASS the same picture is readable with the token in the query string');

// No token at all is still a refusal: a picture belongs to an account, so there is no
// anonymous version of this route.
const open = await call('GET', stored.url);
assert.equal(open.status, 401);
assert.equal((await errorOf(open)).code, 'AUTH_REQUIRED');
assert.equal((await call('GET', `${stored.url}?t=not-a-token`)).status, 401);
console.log('PASS a read with no token, or a useless one, is refused with 401');

// Another account's picture and a picture that never existed answer the same 404, so
// ids cannot be probed from one account to the next.
repository.seedStoredFile({ id: 'theirs-1', userId: 'user-b' });
const foreign = await call('GET', '/api/files/theirs-1', { token: tokenA });
assert.equal(foreign.status, 404);
assert.equal((await errorOf(foreign)).code, 'FILE_NOT_FOUND');
const missing = await call('GET', '/api/files/never-stored', { token: tokenA });
assert.equal(missing.status, 404);
assert.equal((await errorOf(missing)).code, 'FILE_NOT_FOUND');
console.log('PASS another account id answers 404 exactly like one that never existed');

// The owner sees their own picture, which is what makes the 404 above about ownership
// rather than about the row being unreachable to everybody.
const owner = await call('GET', '/api/files/theirs-1', { token: tokenB });
assert.equal(owner.status, 200);
assert.deepEqual(Buffer.from(await owner.arrayBuffer()), pngBytes);
console.log('PASS the owning account reads the same picture');
