import assert from 'node:assert/strict';
import { createReminderScheduler } from '../src/reminders.js';

const events = [];
const scheduler = createReminderScheduler({
  repository: {
    async claimDueReminders() {
      return [{ userId: 'user-1', title: 'Call Greg' }];
    },
    async appendNotification(input) {
      events.push(input);
      return { id: 'notification-1', ...input };
    },
  },
  now: () => new Date('2026-11-02T18:00:00.000Z'),
});

assert.deepEqual(await scheduler.sweepOnce(), { ran: 1 });
assert.deepEqual(events, [{ userId: 'user-1', kind: 'reminder', title: 'Reminder due', body: 'Call Greg' }]);
console.log('PASS cloud reminders become durable in-app notifications');
