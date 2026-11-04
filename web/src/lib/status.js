// One rule for every status pill in the web app, so the same word is always the
// same colour: green is well and working, amber waits, red is stopped or failed.
// Blue is left for navigation and brand, which is why no status uses it.

/** Statuses that mean the thing has stopped working. */
const RED = new Set([
  'suspended', 'blocked', 'disabled', 'deactivated', 'inactive', 'cancelled',
  'canceled', 'failed', 'refused', 'reversed', 'past_due', 'expired', 'revoked', 'error',
]);

/** Statuses that mean it is on its way or waiting on someone. */
const AMBER = new Set(['pending', 'processing', 'abandoned', 'waiting', 'queued', 'warning']);

/** Statuses that mean it is well. */
const GREEN = new Set(['active', 'success', 'completed', 'succeeded', 'enabled', 'paid', 'ready', 'installed']);

/**
 * The tone a status word belongs to.
 *
 * Anything unrecognised falls back to amber rather than green: an unknown state is
 * something to look at, never a silent all-clear.
 * @param {unknown} value
 * @returns {'success' | 'warning' | 'danger'}
 */
export function statusTone(value) {
  const status = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (status === '') return 'success';
  if (RED.has(status)) return 'danger';
  if (GREEN.has(status)) return 'success';
  if (AMBER.has(status)) return 'warning';
  return 'warning';
}

/**
 * A status word as it should be read: underscores become spaces, first letter up.
 * @param {unknown} value
 * @returns {string}
 */
export function statusLabel(value) {
  const words = String(value ?? '').trim().replace(/_/g, ' ');
  if (words === '') return 'Active';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The class string for the shared `.chip` pill in a status tone.
 * @param {unknown} value
 * @returns {string}
 */
export function statusChipClass(value) {
  return `chip chip-${statusTone(value)}`;
}
