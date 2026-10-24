import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getStoreRoot } from './store.js';

const FILE_NAME = 'cloud-session.json';

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

function sessionPath(root = getStoreRoot()) {
  return path.join(root, FILE_NAME);
}

function storageUnavailable() {
  return failure('CLOUD_STORAGE_UNAVAILABLE', 'Secure cloud storage is unavailable on this computer.');
}

export function readCloudSession(root = getStoreRoot()) {
  if (!safeStorage.isEncryptionAvailable()) return storageUnavailable();
  return fs.readFile(sessionPath(root), 'utf8').then((raw) => {
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return failure('CLOUD_SESSION_INVALID', 'The saved cloud session is not valid.');
    }
    if (typeof record?.token !== 'string' || record.token === '') return failure('CLOUD_SESSION_INVALID', 'The saved cloud session is not valid.');
    try {
      const token = safeStorage.decryptString(Buffer.from(record.token, 'base64'));
      return { ok: true, data: { token, expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : '' } };
    } catch {
      return failure('CLOUD_SESSION_INVALID', 'The saved cloud session could not be opened.');
    }
  }).catch((error) => {
    if (error?.code === 'ENOENT') return { ok: true, data: null };
    return failure('CLOUD_SESSION_READ_FAILED', 'The saved cloud session could not be read.');
  });
}

export async function writeCloudSession(token, expiresAt = '', root = getStoreRoot()) {
  if (!safeStorage.isEncryptionAvailable()) return storageUnavailable();
  if (typeof token !== 'string' || token.trim() === '') return failure('CLOUD_SESSION_INVALID', 'A cloud session token is required.');
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const encrypted = safeStorage.encryptString(token.trim()).toString('base64');
    const target = sessionPath(root);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ version: 1, token: encrypted, expiresAt: typeof expiresAt === 'string' ? expiresAt : '' })}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
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
