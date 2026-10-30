import webpush from 'web-push';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export const NOTIFICATION_CATEGORIES = Object.freeze([
  'replies',
  'pictures',
  'reminders',
  'tasks',
  'automations',
  'news',
]);

export const NOTIFICATION_DELIVERIES = Object.freeze(['push', 'email', 'both', 'off']);

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  replies: 'push',
  pictures: 'push',
  reminders: 'push',
  tasks: 'off',
  automations: 'push',
  news: 'email',
});

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {string} value @returns {boolean} */
function safeHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.startsWith('10.') && !host.startsWith('192.168.') && !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

/** @param {unknown} value @returns {string} */
function xml(value) {
  return text(value).replace(/[<>&'\"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[character]));
}

/** @param {unknown} value @returns {object} */
export function checkedNotificationPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const category of NOTIFICATION_CATEGORIES) {
    if (source[category] !== undefined && NOTIFICATION_DELIVERIES.includes(source[category])) {
      preferences[category] = source[category];
    }
  }
  return preferences;
}

/** @param {unknown} value @returns {{ ok: true, platform: string, token: string, endpoint: string, p256dh: string, auth: string, appVersion: string } | { ok: false, message: string }} */
export function checkedNotificationDevice(value) {
  const source = value && typeof value === 'object' ? value : {};
  const platform = text(source.platform).toLowerCase();
  const token = text(source.token);
  if (!['web', 'android', 'windows'].includes(platform)) {
    return { ok: false, message: 'Choose web, Android or Windows for the device.' };
  }
  if (token === '' || token.length > 4096) {
    return { ok: false, message: 'The notification device token is missing or too long.' };
  }
  const endpoint = text(source.endpoint);
  const p256dh = text(source.p256dh);
  const auth = text(source.auth);
  if (platform === 'web' && (endpoint === '' || p256dh === '' || auth === '')) {
    return { ok: false, message: 'A web device needs its push endpoint and encryption keys.' };
  }
  if (platform === 'web' && !safeHttpsUrl(endpoint)) return { ok: false, message: 'A web push endpoint must use HTTPS.' };
  if (platform === 'windows' && (!safeHttpsUrl(token) || !new URL(token).hostname.toLowerCase().endsWith('.notify.windows.com'))) {
    return { ok: false, message: 'A Windows push channel must use a Microsoft notification endpoint.' };
  }
  return {
    ok: true,
    platform,
    token,
    endpoint: endpoint.slice(0, 4096),
    p256dh: p256dh.slice(0, 512),
    auth: auth.slice(0, 512),
    appVersion: text(source.appVersion).slice(0, 40),
  };
}

/**
 * Build optional delivery adapters. Durable in-app rows are still written when a
 * provider is not configured, so adding credentials later never loses events.
 * @param {{ vapidSubject?: string, vapidPublicKey?: string, vapidPrivateKey?: string, firebaseProjectId?: string, firebaseClientEmail?: string, firebasePrivateKey?: string, windowsClientId?: string, windowsClientSecret?: string }} config
 */
export function createPushDelivery(config = {}) {
  const vapidSubject = text(config.vapidSubject);
  const vapidPublicKey = text(config.vapidPublicKey);
  const vapidPrivateKey = text(config.vapidPrivateKey);
  const webConfigured = vapidSubject !== '' && vapidPublicKey !== '' && vapidPrivateKey !== '';
  if (webConfigured) webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const firebaseProjectId = text(config.firebaseProjectId);
  const firebaseClientEmail = text(config.firebaseClientEmail);
  const firebasePrivateKey = text(config.firebasePrivateKey).replace(/\\n/g, '\n');
  let messaging = null;
  if (firebaseProjectId !== '' && firebaseClientEmail !== '' && firebasePrivateKey !== '') {
    const app = getApps().find((entry) => entry.name === 'zuri-push')
      ?? initializeApp({ credential: cert({ projectId: firebaseProjectId, clientEmail: firebaseClientEmail, privateKey: firebasePrivateKey }) }, 'zuri-push');
    messaging = getMessaging(app);
  }

  const windowsClientId = text(config.windowsClientId);
  const windowsClientSecret = text(config.windowsClientSecret);
  let windowsAccessToken = '';
  let windowsTokenExpiresAt = 0;

  async function getWindowsAccessToken() {
    if (windowsAccessToken !== '' && windowsTokenExpiresAt > Date.now() + 30_000) return windowsAccessToken;
    if (windowsClientId === '' || windowsClientSecret === '') return '';
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: windowsClientId,
      client_secret: windowsClientSecret,
      scope: 'notify.windows.com',
    });
    const result = await fetch('https://login.live.com/accesstoken.srf', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!result.ok) throw new Error(`Windows push authorization failed (${result.status}).`);
    const data = await result.json();
    windowsAccessToken = text(data.access_token);
    windowsTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return windowsAccessToken;
  }

  async function sendWindows(device, notification) {
    const accessToken = await getWindowsAccessToken();
    if (accessToken === '') return { sent: false, reason: 'not_configured' };
    const result = await fetch(device.token, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'text/xml',
        'x-wns-type': 'wns/toast',
      },
      body: `<toast><visual><binding template="ToastGeneric"><text>${xml(notification.title)}</text><text>${xml(notification.body)}</text></binding></visual></toast>`,
    });
    if (result.status === 404 || result.status === 410) return { sent: false, reason: 'expired' };
    if (!result.ok) throw new Error(`Windows push delivery failed (${result.status}).`);
    return { sent: true };
  }

  return {
    configured: { web: webConfigured, android: messaging !== null, windows: windowsClientId !== '' && windowsClientSecret !== '' },
    async send(device, notification) {
      if (device.platform === 'web') {
        if (!webConfigured) return { sent: false, reason: 'not_configured' };
        try {
          await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify({ title: notification.title, body: notification.body, kind: notification.kind }));
          return { sent: true };
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) return { sent: false, reason: 'expired' };
          throw error;
        }
      }
      if (device.platform === 'android') {
        if (messaging === null) return { sent: false, reason: 'not_configured' };
        const result = await messaging.send({ token: device.token, notification: { title: notification.title, body: notification.body }, data: { kind: notification.kind } });
        return { sent: typeof result === 'string' };
      }
      if (device.platform === 'windows') return sendWindows(device, notification);
      return { sent: false, reason: 'unsupported' };
    },
  };
}
