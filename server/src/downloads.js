/**
 * Desktop installers offered by the site.
 *
 * The binaries live in the public `King-odysseus/zuri-releases` repository, not
 * on this server. At 140 MB the Windows build cannot be committed (GitHub
 * refuses files over 100 MB), and carrying it inside every deploy image meant
 * each upload pushed it again. GitHub serves release assets with
 * `content-disposition: attachment`, so a plain link saves the file.
 *
 * A `downloads/` folder next to this file still works, and only fills platforms
 * the releases do not cover: that keeps a local run and an offline checkout
 * honest instead of showing a link that leads nowhere.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOWNLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'downloads');
export const DOWNLOAD_CONTENT_TYPE = 'application/octet-stream';

const DEFAULT_RELEASE_REPO = 'King-odysseus/zuri-releases';

// Unauthenticated GitHub allows 60 requests an hour per IP, and the container IP
// is shared, so the answer is reused for a while instead of being asked again on
// every page load.
const RELEASE_CACHE_MS = 10 * 60 * 1000;
const RELEASE_TIMEOUT_MS = 5000;

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
 * Windows before macOS, so the grid has a stable order whatever is available.
 * @param {Map<string, any>} byPlatform
 */
function orderPlatforms(byPlatform) {
  const order = [...INSTALLERS.values()].map((installer) => installer.platform);
  return [...byPlatform.values()].sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
}

/**
 * Which repository holds the installers. An empty value means "local folder
 * only", which the tests use so they never reach the network.
 * @returns {string}
 */
function releaseRepo() {
  const configured = process.env.ZURI_RELEASE_REPO;
  if (typeof configured === 'string') return configured.trim();
  return DEFAULT_RELEASE_REPO;
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
 * Newest installer per platform in a list of GitHub releases, newest first.
 *
 * Kept free of network and file access so the mapping from a release to a
 * download card can be tested against a fixture.
 *
 * @param {Array<{ tag_name?: string, html_url?: string, draft?: boolean, prerelease?: boolean, assets?: Array<{ name?: string, size?: number, browser_download_url?: string }> }>} releases
 * @returns {Array<{ platform: string, label: string, detail: string, name: string, size: number, version: string, url: string, releaseUrl: string }>}
 */
export function downloadsFromReleases(releases) {
  const newest = new Map();
  for (const release of releases) {
    // A draft is invisible until published, and a prerelease is not what a
    // visitor arriving from the site should be handed.
    if (!release || release.draft || release.prerelease) continue;
    const tagVersion = versionOf(String(release.tag_name ?? ''));
    for (const asset of release.assets ?? []) {
      const name = String(asset?.name ?? '');
      const installer = INSTALLERS.get(path.extname(name).toLowerCase());
      if (!installer || !asset.browser_download_url) continue;
      // Releases arrive newest first, so the first asset seen per platform wins.
      if (newest.has(installer.platform)) continue;
      newest.set(installer.platform, {
        ...installer,
        name,
        size: Number(asset.size) || 0,
        // The file name carries the version electron-builder stamped into it;
        // the tag is the fallback when a name has none.
        version: versionOf(name) || tagVersion,
        url: asset.browser_download_url,
        releaseUrl: typeof release.html_url === 'string' ? release.html_url : '',
      });
    }
  }
  return orderPlatforms(newest);
}

/** @returns {Promise<Array<any>>} releases in the order GitHub reports them */
async function fetchReleases() {
  const repo = releaseRepo();
  if (!repo) return [];

  /** @type {Record<string, string>} */
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'zuri-cloud',
  };
  // Optional: lifts the hourly limit from 60 to 5000 when one is configured.
  const token = process.env.GITHUB_TOKEN;
  if (typeof token === 'string' && token.trim() !== '') headers.authorization = `Bearer ${token.trim()}`;

  const reply = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, {
    headers,
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  if (!reply.ok) throw new Error(`GitHub releases answered ${reply.status}`);
  const body = await reply.json();
  if (!Array.isArray(body)) throw new Error('GitHub releases did not return a list');
  return body;
}

/** @type {{ at: number, files: Array<any> }} */
let releaseCache = { at: 0, files: [] };

/**
 * Installers published as release assets.
 *
 * A failure (GitHub down, rate limited, repo renamed) keeps the previous answer
 * rather than emptying the page, and leaves the cache stale so the next request
 * tries again.
 * @returns {Promise<Array<any>>}
 */
async function releaseDownloads() {
  if (Date.now() - releaseCache.at < RELEASE_CACHE_MS) return releaseCache.files;
  try {
    const files = downloadsFromReleases(await fetchReleases());
    releaseCache = { at: Date.now(), files };
    return files;
  } catch {
    return releaseCache.files;
  }
}

/** Installers sitting in the folder on this machine, newest build per platform. */
async function localDownloads() {
  let names;
  try {
    names = await readdir(DOWNLOADS_DIR);
  } catch {
    return []; // no folder on this machine: the releases decide what is offered
  }

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

  for (const file of newest.values()) delete file.modified;
  return orderPlatforms(newest);
}

/**
 * Installers the site can offer, newest build per platform. A published release
 * wins over a file on disk, so the deployed site follows `gh release` alone.
 * @returns {Promise<Array<{ platform: string, label: string, detail: string, name: string, size: number, version: string, url: string }>>}
 */
export async function listDownloads() {
  const [released, local] = await Promise.all([releaseDownloads(), localDownloads()]);
  const merged = new Map();
  for (const file of [...released, ...local]) {
    if (!merged.has(file.platform)) merged.set(file.platform, file);
  }
  return orderPlatforms(merged);
}
