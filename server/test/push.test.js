import assert from 'node:assert/strict';
import { checkedNotificationDevice, checkedNotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } from '../src/push.js';

assert.deepEqual(checkedNotificationPreferences({ reminders: 'off', unknown: 'push' }), {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  reminders: 'off',
});
assert.equal(checkedNotificationDevice({ platform: 'android', token: 'fcm-token' }).ok, true);
assert.equal(checkedNotificationDevice({ platform: 'web', token: 'endpoint', endpoint: 'http://localhost', p256dh: 'key', auth: 'auth' }).ok, false);
assert.equal(checkedNotificationDevice({ platform: 'windows', token: 'https://example.com/channel' }).ok, false);
console.log('PASS push registration validates platforms, preferences and provider endpoints');
