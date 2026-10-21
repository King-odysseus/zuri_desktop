/**
 * secrets.js - the only module that reads or writes provider API keys.
 *
 * A key lives in `secrets.json` under the same userData/zuri directory as the
 * store files, but it does not go through store.js. The store's readers are
 * generic (`readStore(key)`), so filing keys there would let any main module pull
 * a key out by name; here the only way out is `getKey()`, which exists for the
 * provider adapter. `secrets.json` is git-ignored, so a checkout can never carry
 * a real key.
 *
 * Nothing in this module is exposed over IPC. The one channel that accepts a key
 * (`zuri:settings:setKey`) answers with a boolean, never with the key back.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { getStoreRoot } from './store.js';

/** Filename inside the store root. Listed in .gitignore. */
export const SECRETS_FILE_NAME = 'secrets.json';

/** Providers a key may be stored for. */
export const PROVIDERS = Object.freeze(['openai', 'anthropic']);

/** Provider assumed when a caller names none. */
export const DEFAULT_PROVIDER = 'openai';

// Real provider keys are far longer than this; the floor only rejects a stub or an
// accidental single character, without guessing at any provider's exact format.
const KEY_MIN_LENGTH = 8;
const KEY_MAX_LENGTH = 512;

/** Windows ignores the mode, POSIX honours it: owner read/write only. */
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

const WRITE_RETRY_DELAY_MS = 250;

/**
 * Absolute path of the secrets file.
 * @param {string} [root] Store root; defaults to the same root store.js uses.
 * @returns {string}
 */
export function secretsPath(root = getStoreRoot()) {
  return path.join(root, SECRETS_FILE_NAME);
}

/**
 * Lower-case a caller's provider name, or null when it is not one we support.
 * @param {unknown} provider
 * @returns {'openai'|'anthropic'|null}
 */
function normaliseProvider(provider) {
  const name = typeof provider === 'string' ? provider.trim().toLowerCase() : DEFAULT_PROVIDER;
  return PROVIDERS.includes(name) ? name : null;
}

/**
 * Trim the whitespace a copy-paste adds and reject anything that cannot be a key.
 * A key never contains spaces or newlines, so an internal one means the clipboard
 * carried more than the key.
 * @param {unknown} rawKey
 * @returns {string|null} The key to store, or null when it is not usable.
 */
function normaliseKey(rawKey) {
  if (typeof rawKey !== 'string') return null;
  const key = rawKey.trim();
  if (key.length < KEY_MIN_LENGTH || key.length > KEY_MAX_LENGTH) return null;
  if (/\s/.test(key)) return null;
  return key;
}

/**
 * Read the stored keys.
 * A missing file is "no keys yet", which is the first-run state. A file that
 * cannot be parsed is reported as an error rather than treated as empty: the next
 * write would otherwise replace it and silently drop every other provider's key.
 * @param {string} [root]
 * @returns {{ ok: true, data: Record<string, string> } | { ok: false, error: { code: string, message: string } }}
 */
function readKeys(root = getStoreRoot()) {
  let raw;
  try {
    raw = fsSync.readFileSync(secretsPath(root), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, data: {} };
    return failure('SECRETS_READ_FAILED', `secrets.json could not be read: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A JSON syntax error can quote the text around the fault, and in this file that
    // text is a key. Report the problem without any of the message.
    console.error('[zuri:secrets] secrets.json is not valid JSON', error.name);
    return failure('SECRETS_READ_FAILED', 'secrets.json is not valid JSON');
  }

  const keys = parsed?.keys;
  if (keys === null || typeof keys !== 'object' || Array.isArray(keys)) {
    return failure('SECRETS_READ_FAILED', 'secrets.json should hold a "keys" object');
  }

  /** @type {Record<string, string>} */
  const clean = {};
  for (const [provider, value] of Object.entries(keys)) {
    if (PROVIDERS.includes(provider) && typeof value === 'string' && value.length > 0) {
      clean[provider] = value;
    }
  }
  return { ok: true, data: clean };
}

/**
 * Whether a usable key is stored for `provider`.
 * @param {string} [provider] One of PROVIDERS; defaults to DEFAULT_PROVIDER.
 * @returns {boolean}
 */
export function hasKey(provider = DEFAULT_PROVIDER) {
  return getKey(provider) !== null;
}

/**
 * The stored key for `provider`, for main-process callers that are about to call
 * a provider API. Renderer code must never receive this value.
 * @param {string} [provider] One of PROVIDERS; defaults to DEFAULT_PROVIDER.
 * @returns {string|null} The key, or null when none is stored or it is unreadable.
 */
export function getKey(provider = DEFAULT_PROVIDER) {
  const name = normaliseProvider(provider);
  if (name === null) return null;

  const read = readKeys();
  if (!read.ok) {
    // Deliberately no key material in the log, and no throw: a corrupt secrets
    // file must not crash a request, it just means "no key".
    console.error(`[zuri:secrets] ${read.error.message}`);
    return null;
  }

  return read.data[name] ?? null;
}

/**
 * What a view is allowed to know: which provider, and whether a key exists.
 * @param {string} [provider]
 * @returns {{ ok: true, data: { provider: string, hasKey: boolean } } | { ok: false, error: { code: string, message: string } }}
 */
export function keyStatus(provider = DEFAULT_PROVIDER) {
  const name = normaliseProvider(provider);
  if (name === null) {
    return failure('SECRETS_UNKNOWN_PROVIDER', unknownProviderMessage(provider));
  }

  const read = readKeys();
  if (!read.ok) return read;
  return { ok: true, data: { provider: name, hasKey: typeof read.data[name] === 'string' } };
}

/**
 * Store a key for `provider`. The result carries the provider and a boolean only:
 * echoing the key back would put it on the IPC wire again for no benefit.
 * @param {string} [provider] One of PROVIDERS; defaults to DEFAULT_PROVIDER.
 * @param {unknown} [rawKey]
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { provider: string, hasKey: true } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function setKey(provider = DEFAULT_PROVIDER, rawKey, options = {}) {
  const name = normaliseProvider(provider);
  if (name === null) {
    return failure('SECRETS_UNKNOWN_PROVIDER', unknownProviderMessage(provider));
  }

  const key = normaliseKey(rawKey);
  if (key === null) {
    return failure(
      'SECRETS_INVALID_KEY',
      `a provider key must be ${KEY_MIN_LENGTH}-${KEY_MAX_LENGTH} characters with no spaces`,
    );
  }

  const root = options.root ?? getStoreRoot();
  const read = readKeys(root);
  if (!read.ok) return read;

  const payload = {
    version: 1,
    keys: { ...read.data, [name]: key },
    updatedAt: new Date().toISOString(),
  };

  try {
    await fs.mkdir(root, { recursive: true, mode: DIRECTORY_MODE });
  } catch (error) {
    return failure('SECRETS_WRITE_FAILED', `could not create ${root}: ${error.message}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await writeAtomic(secretsPath(root), `${JSON.stringify(payload, null, 2)}\n`);
      return { ok: true, data: { provider: name, hasKey: true } };
    } catch (error) {
      lastError = error;
      if (attempt === 1) await delay(WRITE_RETRY_DELAY_MS);
    }
  }

  return failure('SECRETS_WRITE_FAILED', `secrets.json: ${lastError?.message ?? 'write failed'}`);
}

/**
 * Forget the key for `provider`. When it was the last one, the file is deleted
 * rather than left empty: "no key" is the absence of `secrets.json`, and deleting
 * it removes the key material from the disk instead of leaving a blanked copy.
 * @param {string} [provider] One of PROVIDERS; defaults to DEFAULT_PROVIDER.
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ ok: true, data: { provider: string, hasKey: false } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function clearKey(provider = DEFAULT_PROVIDER, options = {}) {
  const name = normaliseProvider(provider);
  if (name === null) {
    return failure('SECRETS_UNKNOWN_PROVIDER', unknownProviderMessage(provider));
  }

  const root = options.root ?? getStoreRoot();
  const read = readKeys(root);
  if (!read.ok) return read;
  if (!(name in read.data)) {
    return { ok: true, data: { provider: name, hasKey: false } };
  }

  delete read.data[name];

  try {
    if (Object.keys(read.data).length === 0) {
      await fs.rm(secretsPath(root), { force: true });
    } else {
      const payload = { version: 1, keys: read.data, updatedAt: new Date().toISOString() };
      await writeAtomic(secretsPath(root), `${JSON.stringify(payload, null, 2)}\n`);
    }
  } catch (error) {
    return failure('SECRETS_WRITE_FAILED', `secrets.json: ${error.message}`);
  }

  return { ok: true, data: { provider: name, hasKey: false } };
}

/**
 * Write `text` to `target` through a temp file in the same directory, with owner
 * only permissions. Same tmp-then-rename guarantee as store.js: a reader sees the
 * old file or the new one, never a half-written key file.
 * @param {string} target Absolute destination path.
 * @param {string} text Exact file contents.
 * @returns {Promise<void>}
 */
async function writeAtomic(target, text) {
  const tempPath = `${target}.${process.pid}-${Date.now()}.tmp`;
  try {
    const handle = await fs.open(tempPath, 'w', FILE_MODE);
    try {
      await handle.writeFile(text, 'utf8');
      // Flush before the rename so a crash cannot leave the name pointing at a
      // file whose bytes never reached the disk.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, target);
  } catch (error) {
    try {
      await fs.rm(tempPath, { force: true });
    } catch (cleanupError) {
      console.error('[zuri:secrets] could not remove temp file', cleanupError);
    }
    throw error;
  }
}

/**
 * @param {unknown} provider
 * @returns {string}
 */
function unknownProviderMessage(provider) {
  return `unknown provider: ${String(provider)}. Expected one of ${PROVIDERS.join(', ')}.`;
}

/**
 * @param {string} code SCREAMING_SNAKE code for the caller to branch on.
 * @param {string} message User-presentable prose. Never contains key material.
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {number} milliseconds
 * @returns {Promise<void>}
 */
function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
