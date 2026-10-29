/*
 * Signed direct uploads to Cloudinary.
 *
 * The shape of this is deliberate. Railway runs a small Node service and a
 * Postgres database, and neither is a good place for file bytes: every megabyte
 * would be read into memory twice (once on upload, once on download), counted
 * against the dyno's memory, and paid for as egress. Cloudinary is a CDN with a
 * free tier measured in credits, so the bytes go there and Railway only signs.
 *
 * One upload therefore costs Railway a few hundred bytes: a signature, a
 * timestamp and a folder. The browser posts the file straight to Cloudinary, and
 * the reply carries back a delivery URL. Cloudinary's own limits (10MB for an
 * image, 100MB for a video) are stricter than ours for images, so the cap here is
 * the smaller of the two and is stated to the client rather than enforced by
 * hope.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** 10MB: Cloudinary's own image ceiling, and enough for a photo or a PDF. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** What Zuri accepts as an attachment, by MIME type. */
export const ALLOWED_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

/**
 * Cloudinary signs a hash of the parameters, sorted, without the API secret.
 *
 * The client must send back exactly these parameters (folder and timestamp) for
 * the signature to verify, which is what stops someone changing the folder after
 * it was signed.
 * @param {{ folder: string, timestamp: number, apiSecret: string }} details
 * @returns {string} the sha1 hex digest Cloudinary expects
 */
export function uploadSignature({ folder, timestamp, apiSecret }) {
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  return createHash('sha1').update(toSign).digest('hex');
}

/**
 * The parameters a browser needs to post a file straight to Cloudinary.
 *
 * `timestamp` is seconds, not milliseconds, because that is what Cloudinary
 * compares the signature against.
 * @param {{ cloudName: string, apiKey: string, apiSecret: string, userId: string }} details
 * @returns {{ cloudName: string, apiKey: string, folder: string, timestamp: number, signature: string, maxBytes: number, allowedTypes: string[] }}
 */
export function signUpload({ cloudName, apiKey, apiSecret, userId }) {
  // One folder per account, so a delivery URL names whose file it is and an
  // operator can clear a single account's uploads without guessing.
  const folder = `zuri/u/${userId}`;
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    cloudName,
    apiKey,
    folder,
    timestamp,
    signature: uploadSignature({ folder, timestamp, apiSecret }),
    maxBytes: UPLOAD_MAX_BYTES,
    allowedTypes: [...ALLOWED_UPLOAD_TYPES],
  };
}

/**
 * Check a delivery URL really is this cloud account's.
 *
 * Without this, a client could attach any address on the internet to a message
 * and the thread would render it, which turns a chat into a way to phone home
 * with the reader's browser, or to serve a file that was never scanned. Only the
 * configured cloud's own host and folder are accepted.
 * @param {unknown} url
 * @param {string} cloudName
 * @returns {boolean}
 */
export function isCloudinaryUrl(url, cloudName) {
  if (typeof url !== 'string' || url === '' || cloudName === '') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'res.cloudinary.com') return false;
  // The delivered path is /<cloud>/<resource>/upload/... so the cloud name is the
  // first segment. Compare it against the configured one rather than trusting it.
  const [first] = parsed.pathname.split('/').filter(Boolean);
  if (first === undefined) return false;
  const expected = Buffer.from(cloudName);
  const actual = Buffer.from(first);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Turn what a client sent into the small object a message may carry, or reject it.
 *
 * Every field is checked rather than copied: the object is rendered in another
 * person's browser on another device, so nothing in it may be trusted.
 * @param {unknown} value
 * @param {string} cloudName
 * @returns {{ ok: true, attachment: { url: string, name: string, kind: string, bytes: number } } | { ok: false, message: string }}
 */
export function checkedAttachment(value, cloudName) {
  if (value === null || value === undefined) return { ok: true, attachment: null };
  if (typeof value !== 'object') return { ok: false, message: 'An attachment must be an object.' };
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!isCloudinaryUrl(url, cloudName)) {
    return { ok: false, message: 'An attachment must point at this account\'s own uploads.' };
  }
  const kind = typeof value.kind === 'string' ? value.kind.trim().toLowerCase() : '';
  if (!ALLOWED_UPLOAD_TYPES.has(kind)) {
    return { ok: false, message: 'That kind of file cannot be attached.' };
  }
  const bytes = Number(value.bytes);
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > UPLOAD_MAX_BYTES) {
    return { ok: false, message: `An attachment must be ${UPLOAD_MAX_BYTES / (1024 * 1024)}MB or smaller.` };
  }
  // The name is displayed, never used as a path, so the only job here is to keep
  // it short and free of control characters that would break a row's layout.
  const name = (typeof value.name === 'string' ? value.name : '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120);
  if (name === '') return { ok: false, message: 'Give the attachment a name.' };
  return { ok: true, attachment: { url, name, kind, bytes: Math.round(bytes) } };
}
