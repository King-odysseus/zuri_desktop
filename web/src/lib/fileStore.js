/*
 * Files Zuri built in a chat, kept on this device so their Download card is still
 * there after a reload.
 *
 * The server hands a file back once and keeps no copy, the same promise as the picture
 * library, so the file lives in IndexedDB here and nowhere else. A private chat never
 * writes here. Every function answers quietly with an empty result when the browser
 * cannot keep files: a missing card is a far smaller problem than a chat that breaks.
 */

const DATABASE = 'zuri-files';
const STORE = 'files';
/** Enough for a long project, small enough that one chat cannot fill the device. */
const FILES_PER_CHAT = 20;

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot keep files on the device.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('conversationId', 'conversationId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The file store could not be opened.'));
  });
}

/** Run one transaction and settle with whatever `work` returns. */
async function run(mode, work) {
  const database = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let result;
      Promise.resolve(work(transaction.objectStore(STORE))).then((value) => { result = value; }, reject);
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('The file store failed.'));
    });
  } finally {
    database.close();
  }
}

/** @param {IDBRequest} request @returns {Promise<any>} */
function settle(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Every file kept for one chat, oldest first.
 * @param {string} conversationId
 * @returns {Promise<Array<{ name: string, kind: string, mime: string, bytes: number, base64: string }>>}
 */
export async function listFiles(conversationId) {
  if (!conversationId) return [];
  try {
    const rows = await run('readonly', (store) => settle(store.index('conversationId').getAll(conversationId)));
    return (Array.isArray(rows) ? rows : []).sort((a, b) => a.savedAt - b.savedAt);
  } catch (error) {
    console.warn('[zuri] files could not be read:', error?.message ?? error);
    return [];
  }
}

/**
 * Keep files built in one chat, dropping the oldest once the chat holds too many.
 * @param {string} conversationId
 * @param {Array<{ name: string, kind: string, mime: string, bytes: number, base64: string }>} files
 * @returns {Promise<void>}
 */
export async function saveFiles(conversationId, files) {
  if (!conversationId || !Array.isArray(files) || files.length === 0) return;
  try {
    await run('readwrite', async (store) => {
      const now = Date.now();
      files.forEach((file, index) => {
        store.put({
          id: `${conversationId}:${now}:${index}`,
          conversationId,
          savedAt: now + index,
          name: file.name,
          kind: file.kind,
          mime: file.mime,
          bytes: file.bytes,
          base64: file.base64,
        });
      });
      const all = (await settle(store.index('conversationId').getAll(conversationId))).sort((a, b) => a.savedAt - b.savedAt);
      all.slice(0, Math.max(0, all.length - FILES_PER_CHAT)).forEach((old) => store.delete(old.id));
    });
  } catch (error) {
    console.warn('[zuri] files could not be kept on this device:', error?.message ?? error);
  }
}

/**
 * Forget every file kept for a chat, when the chat itself is deleted.
 * @param {string} conversationId
 * @returns {Promise<void>}
 */
export async function deleteFiles(conversationId) {
  if (!conversationId) return;
  try {
    await run('readwrite', async (store) => {
      const rows = await settle(store.index('conversationId').getAll(conversationId));
      rows.forEach((row) => store.delete(row.id));
    });
  } catch (error) {
    console.warn('[zuri] files could not be removed from this device:', error?.message ?? error);
  }
}
