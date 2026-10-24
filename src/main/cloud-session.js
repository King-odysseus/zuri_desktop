import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getStoreRoot } from './store.js';

const FILE_NAME = 'cloud-session.json';

// The cloud server ends a session after three quiet days. Keeping the same rule
// here means the app never opens into chat holding a token its server has
// already dropped.
export const SESSION_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

// Three cloud calls in flight each read the session, and each read stamps it.
// Stamping at most once a minute keeps that from turning into three writes per
// call racing over one temp file, and a minute of slack cannot change a decision
// measured in days.
const TOUCH_INTERVAL_MS = 60 * 1000;

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function sessionPath(root = getStoreRoot()) {
  return path.join(root, FILE_NAME);
}

function storageUnavailable() {
  return failure('CLOUD_STORAGE_UNAVAILABLE', 'Secure cloud storage is unavailable on this computer.');
}

/** Epoch milliseconds for a stored timestamp, or NaN when there is none to read. */
function epochOf(value) {
  if (typeof value !== 'string' || value === '') return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/**
 * A stored session survives only while it is being used.
 *
 * The saved expiresAt is deliberately not consulted once lastUsedAt exists: the
 * cloud server pushes its expiry out on every call, so the copy written at
 * sign-in is older than the server's and would sign a daily user out three days
 * after they signed in.
 * @param {{ lastUsedAt?: string, expiresAt?: string }} record
 * @param {number} now epoch milliseconds
 * @returns {boolean}
 */
function isStale(record, now) {
  const lastUsed = epochOf(record.lastUsedAt);
  if (Number.isFinite(lastUsed)) return now - lastUsed > SESSION_IDLE_MS;
  // Files written before the idle rule existed carry no last-used stamp, so the
  // expiry the server sent is the only evidence in them.
  const expiresAt = epochOf(record.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

// One writer at a time. Every write renames over the same temp path, so two
// concurrent writes could otherwise interleave into one corrupt file.
let pendingWrite = Promise.resolve();
function queueWrite(run) {
  const next = pendingWrite.then(() => run());
  pendingWrite = next.catch(() => {});
  return next;
}

async function writeRecord(record, root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const target = sessionPath(root);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
}

/**
 * Record that the session was just used. Failure is not fatal: the token is
 * still good, and a stamp that lags only shortens how long the next launch
 * trusts it, so this must never turn a working read into an error.
 */
async function touch(record, root, now) {
  const previous = epochOf(record.lastUsedAt);
  if (Number.isFinite(previous) && now - previous < TOUCH_INTERVAL_MS) return;
  try {
    await queueWrite(() => writeRecord({ ...record, lastUsedAt: new Date(now).toISOString() }, root));
  } catch {
    // Deliberately quiet: see above.
  }
}

/**
 * The stored session, stamped as used. An idle or expired session is deleted and
 * reported as absent, which is the same answer the renderer gives a person who
 * never signed in.
 * @param {string} [root]
 * @returns {Promise<{ok: boolean, data?: {token: string, expiresAt: string, lastUsedAt: string} | null, error?: {code: string, message: string}}>}
 */
export async function readCloudSession(root = getStoreRoot()) {
  if (!safeStorage.isEncryptionAvailable()) return storageUnavailable();
  let raw;
  try {
    raw = await fs.readFile(sessionPath(root), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, data: null };
    return failure('CLOUD_SESSION_READ_FAILED', 'The saved cloud session could not be read.');
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return failure('CLOUD_SESSION_INVALID', 'The saved cloud session is not valid.');
  }
  if (typeof record?.token !== 'string' || record.token === '') return failure('CLOUD_SESSION_INVALID', 'The saved cloud session is not valid.');
  let token;
  try {
    token = safeStorage.decryptString(Buffer.from(record.token, 'base64'));
  } catch {
    return failure('CLOUD_SESSION_INVALID', 'The saved cloud session could not be opened.');
  }
  const now = Date.now();
  if (isStale(record, now)) {
    await clearCloudSession(root);
    return { ok: true, data: null };
  }
  await touch(record, root, now);
  return {
    ok: true,
    data: {
      token,
      expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : '',
      lastUsedAt: new Date(now).toISOString(),
    },
  };
}

export async function writeCloudSession(token, expiresAt = '', root = getStoreRoot()) {
  if (!safeStorage.isEncryptionAvailable()) return storageUnavailable();
  if (typeof token !== 'string' || token.trim() === '') return failure('CLOUD_SESSION_INVALID', 'A cloud session token is required.');
  try {
    const encrypted = safeStorage.encryptString(token.trim()).toString('base64');
    const record = {
      version: 1,
      token: encrypted,
      expiresAt: typeof expiresAt === 'string' ? expiresAt : '',
      lastUsedAt: new Date().toISOString(),
    };
    await queueWrite(() => writeRecord(record, root));
    return { ok: true, data: { saved: true } };
  } catch {
    return failure('CLOUD_SESSION_WRITE_FAILED', 'The cloud session could not be saved securely.');
  }
}

export async function clearCloudSession(root = getStoreRoot()) {
  try {
    await fs.rm(sessionPath(root), { force: true });
    return { ok: true, data: { signedOut: true } };
  } catch {
    return failure('CLOUD_SESSION_CLEAR_FAILED', 'The cloud session could not be cleared.');
  }
}
