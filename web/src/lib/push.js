import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { fetchPublicConfig, registerNotificationDevice } from './api.js';

let nativeRegistrationStarted = false;

/** Convert a URL-safe VAPID key into the byte array PushManager expects. */
function vapidBytes(value) {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

/** Register an Android Capacitor token once after account sign-in. */
export async function registerNativePush() {
  if (!Capacitor.isNativePlatform() || nativeRegistrationStarted) return { enabled: false, reason: 'not_native' };
  nativeRegistrationStarted = true;
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return { enabled: false, reason: 'permission_denied' };

  await PushNotifications.addListener('registration', async (token) => {
    if (typeof token?.value !== 'string' || token.value.trim() === '') return;
    await registerNotificationDevice({ platform: 'android', token: token.value });
  });
  await PushNotifications.addListener('registrationError', (error) => {
    console.error('[zuri:push] Android registration failed', error?.error ?? error);
  });
  await PushNotifications.register();
  return { enabled: true };
}

/** Register the browser's encrypted PushSubscription after a button click. */
export async function enableWebPush() {
  if (Capacitor.isNativePlatform()) return { enabled: false, reason: 'native' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { enabled: false, reason: 'unsupported' };
  }
  const config = await fetchPublicConfig();
  const vapidKey = typeof config.pushVapidPublicKey === 'string' ? config.pushVapidPublicKey : '';
  if (vapidKey === '') return { enabled: false, reason: 'not_configured' };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { enabled: false, reason: 'permission_denied' };

  const registration = await navigator.serviceWorker.register('/push-sw.js');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidBytes(vapidKey),
  });
  const json = subscription.toJSON();
  await registerNotificationDevice({
    platform: 'web',
    token: subscription.endpoint,
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  });
  return { enabled: true };
}
