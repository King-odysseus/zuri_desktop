/**
 * Desktop installers offered by the site.
 *
 * The files themselves are not in git: the Windows installer is 140 MB and
 * GitHub refuses any single file over 100 MB, so `downloads/` is ignored and
 * carried to the deploy by `npm run cloud:deploy`. When the folder is empty the
 * API reports no files and the site says so, instead of linking somewhere that
 * 404s.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOWNLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'downloads');
export const DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';

// Only installers are offered. An electron-builder output folder also holds a
// .blockmap and a .yml for the updater; listing those as downloads invites a
// visitor to save a file that cannot be installed.
const INSTALLERS = new Map([
  ['.exe', { platform: 'windows', label: 'Windows', detail: 'Windows 10 or 11, 64-bit' }],
  ['.dmg', { platform: 'macos', label: 'macOS', detail: 'macOS 12 or later' }],
]);

/** @param {string} name @returns {string} */
function versionOf(name) {
  const match = /(\d+\.\d+\.\d+)/.exec(name);
  return match ? match[1] : '';
}

/**
 * Absolute path for a requested installer, or null when the name is not one we
 * are willing to serve. The name is checked rather than resolved first: a name
 * carrying a separator or '..' is refused outright, so no path traversal can be
 * built in the first place.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function resolveDownloadPath(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  if (!INSTALLERS.has(path.extname(name).toLowerCase())) return null;
  return path.join(DOWNLOADS_DIR, name);
}

/**
 * Installers present on this server, newest build per platform.
 * @returns {Promise<Array<{ platform: string, label: string, detail: string, name: string, size: number, version: string, url: string }>>}
 */
export async function listDownloads() {
  let names;
  try {
    names = await readdir(DOWNLOADS_DIR);
  } catch {
    return []; // no folder on this machine: every platform is simply unavailable
  }

  /** @type {Map<string, { platform: string, label: string, detail: string, name: string, size: number, version: string, url: string, modified: number }>} */
  const newest = new Map();
  for (const name of names) {
    const installer = INSTALLERS.get(path.extname(name).toLowerCase());
    if (!installer) continue;
    const info = await stat(path.join(DOWNLOADS_DIR, name)).catch(() => null);
    if (!info?.isFile()) continue;
    const previous = newest.get(installer.platform);
    if (previous && previous.modified > info.mtimeMs) continue;
    newest.set(installer.platform, {
      ...installer,
      name,
      size: info.size,
      version: versionOf(name),
      url: `/downloads/${encodeURIComponent(name)}`,
      modified: info.mtimeMs,
    });
  }

  // Windows before macOS, so the grid has a stable order whatever is present.
  const order = [...INSTALLERS.values()].map((installer) => installer.platform);
  return [...newest.values()]
    .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform))
    .map(({ modified, ...download }) => download);
}
