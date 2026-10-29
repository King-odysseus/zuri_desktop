/*
 * The picture library for the browser and the Android app.
 *
 * Pictures are kept in IndexedDB on this device and nowhere else: the server hands
 * a picture back once and keeps no copy, so clearing site data deletes it for good.
 * That is the point, and the screen says so.
 */

const DATABASE = 'zuri-images';
const STORE = 'pictures';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot keep pictures on the device.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The picture library could not be opened.'));
  });
}

async function run(mode, work) {
  const database = await open();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('The picture library failed.'));
    });
  } finally {
    database.close();
  }
}

/** @param {string} base64 @param {string} mime @returns {Blob} */
export function blobFromBase64(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

/**
 * Keep one picture on this device.
 * @param {{ blob: Blob, prompt: string, usedPrompt: string, model: string, shape: string }} picture
 * @returns {Promise<{ id: string }>}
 */
export async function savePicture(picture) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await run('readwrite', (store) => store.put({ ...picture, id, createdAt: new Date().toISOString() }));
  return { id };
}

/** @returns {Promise<Array<{ id: string, blob: Blob, prompt: string, usedPrompt: string, model: string, shape: string, createdAt: string }>>} newest first */
export async function listPictures() {
  const all = (await run('readonly', (store) => store.getAll())) ?? [];
  return all.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
}

/** @param {string} id */
export async function deletePicture(id) {
  await run('readwrite', (store) => store.delete(id));
}
