import { api } from './api.js';

/**
 * Platforms the site offers, in the order they are shown. Availability is not
 * declared here: only the server knows which installers it actually holds, so
 * the label and detail are display text and the link comes from /api/downloads.
 */
export const DOWNLOAD_PLATFORMS = [
  { platform: 'windows', label: 'Windows', detail: 'Windows 10 or 11, 64-bit' },
  { platform: 'macos', label: 'macOS', detail: 'macOS 12 or later' },
  { platform: 'android', label: 'Android', detail: 'Android 6 or later' },
];

// One request per page load. The landing grid, the footer and the dashboard
// sidebar all ask, and the list cannot change while the tab is open.
let cached = null;

/**
 * Installers this server can hand out.
 * @returns {Promise<Array<{ platform: string, label: string, detail: string, name: string, size: number, version: string, url: string, releaseUrl?: string }>>}
 */
export function fetchDownloads() {
  cached ??= api('/api/downloads')
    .then((data) => (Array.isArray(data?.files) ? data.files : []))
    // A download list is not worth an error screen: no files simply means the
    // platform card says it is not available yet.
    .catch(() => []);
  return cached;
}

/**
 * Forget a failed or stale download lookup so a visible retry can ask the
 * server again without forcing the visitor to reload the whole page.
 * @returns {Promise<Array<{ platform: string, label: string, detail: string, name: string, size: number, version: string, url: string, releaseUrl?: string }>>}
 */
export function refreshDownloads() {
  cached = null;
  return fetchDownloads();
}

/** @param {number} bytes @returns {string} */
export function formatDownloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 100 ? `${Math.round(megabytes)} MB` : `${Math.round(megabytes * 10) / 10} MB`;
}

/**
 * Return the platform most likely to match the visitor. This only changes
 * emphasis and never hides another available installer.
 * @returns {string}
 */
export function recommendedPlatform() {
  if (typeof navigator === 'undefined') return '';
  const platform = String(navigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent).toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac') || platform.includes('darwin')) return 'macos';
  return '';
}
