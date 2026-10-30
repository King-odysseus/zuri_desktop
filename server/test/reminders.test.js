import assert from 'node:assert/strict';
import { createReminderScheduler } from '../src/reminders.js';
import { createMailer, reminderBody } from '../src/mail.js';

const now = new Date('2026-11-02T18:00:00.000Z');
const claimed = [{ id: 'r1', title: 'Call Greg', dueAt: now.toISOString(), email: 'person@example.com' }];
const sent = [];
const scheduler = createReminderScheduler({
  repository: { async claimDueReminders() { return claimed; } },
  mailer: { async sendReminder(input) { sent.push(input); return { sent: true, id: 'mail-1' }; } },
  now: () => now,
});

assert.deepEqual(await scheduler.sweepOnce(), { ran: 1, sent: 1 });
assert.deepEqual(sent, [{ to: 'person@example.com', title: 'Call Greg', dueAt: now.toISOString() }]);
assert.match(reminderBody({ title: 'Call Greg', dueAt: now.toISOString() }), /Call Greg/);
console.log('PASS cloud reminder sweep sends a claimed reminder while clients are closed');

let mailRequest;
const mailer = createMailer({
  apiKey: 'key',
  from: 'zuri@example.com',
  fetchImpl: async (_url, options) => {
    mailRequest = JSON.parse(options.body);
    return { ok: true, async json() { return { messageId: 'mail-2' }; } };
  },
});
assert.deepEqual(await mailer.sendReminder({ to: 'person@example.com', title: 'Call Greg', dueAt: now.toISOString() }), { sent: true, id: 'mail-2' });
assert.equal(mailRequest.to[0].email, 'person@example.com');
assert.equal(mailRequest.subject, 'Zuri reminder');
console.log('PASS reminder email uses the account address and plain text body');
