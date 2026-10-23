/**
 * reminder-toast.js - the OS toast a due reminder raises.
 *
 * Draws the open-pencil node "Reminder notification (OS toasts)" (0:11015). Windows
 * paints this surface, not the app, so every fact the design puts on it has to be
 * carried in the arguments to Electron's Notification: the title, the sentence
 * under it, the repeat context, and the two buttons. Nothing here is a web page.
 *
 * What the design shows, and where each piece comes from:
 *
 *   Toast title   "Standup notes due"            the reminder's own title
 *                 "Standup notes due - again"    plus the suffix when it has
 *                                                already fired once today (state 02:
 *                                                "carries the repeat context ... so it
 *                                                does not read as a duplicate")
 *   Toast body    "Your 9:45 AM reminder: ..."   the design's sentence, with the
 *                 "Friday 5:00 PM reminder: ..." reminder's words where the mock has
 *                 "This reminder fired again. ..." its own
 *   Chips         "Repeats weekdays"             the reminder's repeat rule
 *                 "Occurrence 3 today"           how many times it has fired today
 *   Actions       "Snooze 10 min"                push the next fire ten minutes out
 *                 "Open reminders"               bring Zuri to the front
 *                 "Dismiss"                      close the toast
 *
 * Windows toasts have no chip row, so the two chips travel on one line under the
 * sentence; the Action Center keeps the toast after it leaves the screen, which is
 * the design's stacked-toast state.
 *
 * The design's chip reads "Repeats weekdays" because its mock reminder repeats on
 * weekdays. A stored reminder repeats daily or every N minutes, so the same chip is
 * rendered from the rule the reminder actually has ("Repeats daily").
 *
 * Electron is never imported here: this module is pure so scripts/selftest.js can
 * assert the payload and the button behaviour under plain Node.
 */

import { listReminders, recordReminderFire } from './store.js';

/** How far the snooze button pushes the next fire. */
export const SNOOZE_MINUTES = 10;

/** The suffix the design puts on a toast whose reminder has already fired today. */
export const AGAIN_SUFFIX = ' - again';

/** Button labels, exactly as the design draws them. */
export const ACTION_SNOOZE = 'Snooze 10 min';
export const ACTION_OPEN = 'Open reminders';
export const ACTION_DISMISS = 'Dismiss';

/**
 * A moment as the design writes it: "9:45 AM". No leading zero, because the toast
 * body is a sentence and "09:45 AM reminder" reads as a time stamp, not a sentence.
 * @param {Date} date
 * @returns {string}
 */
export function clockLabel(date) {
  const hours = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

/**
 * @param {Date} left
 * @param {Date} right
 * @returns {boolean} True when both fall on the same local calendar day.
 */
export function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * How many times each reminder already fired today, from notifications.json.
 *
 * Counted off the history rather than an in-memory tally so the number survives a
 * restart: notifications.json is the one record of every fire.
 * @param {object[]} entries Notification entries, newest first.
 * @param {Date} now
 * @returns {Map<string, number>} Fires today, by reminder id.
 */
export function todayFireCounts(entries, now = new Date()) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const reminderId = entry?.reminderId;
    if (typeof reminderId !== 'string' || reminderId === '') continue;
    const firedAt = new Date(entry.createdAt);
    if (Number.isNaN(firedAt.getTime()) || !isSameDay(firedAt, now)) continue;
    counts.set(reminderId, (counts.get(reminderId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The reminder's repeat rule as the design's chip words it.
 * @param {any} reminder
 * @returns {string} Empty for a reminder that fires once.
 */
export function repeatLabel(reminder) {
  if (reminder?.repeat === 'daily') return 'Repeats daily';
  if (reminder?.repeat === 'interval') {
    const minutes = Number(reminder.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 1) return 'Repeats';
    return minutes === 60 ? 'Repeats every hour' : `Repeats every ${minutes} min`;
  }
  return '';
}

/**
 * The sentence under the title.
 *
 * The design has three shapes and they come from two facts: whether the fire moment
 * is today (so the toast can say "Your 9:45 AM reminder" instead of naming a day),
 * and whether this is a repeat fire (state 02: "A repeating reminder fires again").
 * @param {any} reminder
 * @param {{ now?: Date, firedToday?: number }} [options]
 * @returns {string}
 */
export function toastSentence(reminder, { now = new Date(), firedToday = 1 } = {}) {
  const title = typeof reminder?.title === 'string' ? reminder.title.trim() : '';
  const due = new Date(reminder?.dueAt);
  const clock = Number.isNaN(due.getTime()) ? clockLabel(now) : clockLabel(due);

  // A repeat fire is the one the person has already seen today: it must say so, or
  // a second identical toast looks like a duplicate the app sent by mistake.
  if (firedToday > 1) return `This reminder fired again. ${title}.`;

  const when = Number.isNaN(due.getTime()) || isSameDay(due, now)
    ? `Your ${clock} reminder`
    : `${due.toLocaleString('en-US', { weekday: 'long' })} ${clock} reminder`;

  return `${when}: ${title}.`;
}

/**
 * The chip row as one line: the repeat rule, then today's occurrence count.
 * @param {any} reminder
 * @param {{ firedToday?: number }} [options]
 * @returns {string} Empty when the reminder neither repeats nor has fired again.
 */
export function toastContext(reminder, { firedToday = 1 } = {}) {
  const parts = [];
  const repeat = repeatLabel(reminder);
  if (repeat !== '') parts.push(repeat);
  if (firedToday > 1) parts.push(`occurrence ${firedToday} today`);
  return parts.join(' - ');
}

/**
 * The buttons, in the design's order: a repeating reminder offers Snooze first, a
 * reminder that fires once offers Dismiss instead.
 * @param {any} reminder
 * @returns {Array<{ type: 'button', text: string }>}
 */
export function toastActions(reminder) {
  const labels = repeatLabel(reminder) === ''
    ? [ACTION_OPEN, ACTION_DISMISS]
    : [ACTION_SNOOZE, ACTION_OPEN];
  return labels.map((text) => ({ type: 'button', text }));
}

/**
 * Everything the toast says, plus the reminder it belongs to so the buttons can act
 * on it. `body` is what Windows is handed: the sentence, then the chip line.
 * @param {any} reminder
 * @param {{ now?: Date, firedToday?: number }} [options]
 * @returns {{ reminderId: string, title: string, body: string, sentence: string, context: string, actions: Array<{ type: 'button', text: string }>, silent: boolean }}
 */
export function buildReminderToast(reminder, { now = new Date(), firedToday = 1 } = {}) {
  const title = typeof reminder?.title === 'string' ? reminder.title.trim() : '';
  const sentence = toastSentence(reminder, { now, firedToday });
  const context = toastContext(reminder, { firedToday });

  return {
    reminderId: typeof reminder?.id === 'string' ? reminder.id : '',
    title: firedToday > 1 && title !== '' ? `${title}${AGAIN_SUFFIX}` : title,
    body: context === '' ? sentence : `${sentence}\n${context}`,
    sentence,
    context,
    actions: toastActions(reminder),
    // A reminder is the one toast a person must be able to read at a glance from
    // another window, so it keeps its own volume rather than the system default.
    silent: false,
  };
}

/**
 * Push a reminder's next fire ten minutes out, which is what the design's Snooze
 * button promises.
 *
 * The tick has already moved the reminder to its next fire by the time the button is
 * pressed, so snoozing never delays it: it re-arms at `now + 10 min` only when that
 * is sooner than the fire already scheduled. A reminder that repeats every five
 * minutes therefore keeps firing every five minutes, which is what it is for.
 * @param {string} reminderId
 * @param {{ root?: string, now?: Date, minutes?: number }} [options]
 * @returns {Promise<{ ok: boolean, data?: object, error?: { code: string, message: string } }>}
 */
export async function snoozeReminder(reminderId, options = {}) {
  if (typeof reminderId !== 'string' || reminderId === '') {
    return { ok: false, error: { code: 'REMINDER_INVALID_ID', message: 'Which reminder to snooze was not given.' } };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const minutes = Number.isFinite(options.minutes) && options.minutes >= 1 ? options.minutes : SNOOZE_MINUTES;
  const storeOptions = options.root === undefined ? {} : { root: options.root };

  const listed = await listReminders(storeOptions);
  if (!listed.ok) return listed;

  const reminder = listed.data.find((candidate) => candidate.id === reminderId);
  if (reminder === undefined) {
    return { ok: false, error: { code: 'REMINDER_NOT_FOUND', message: 'That reminder is no longer on the list.' } };
  }

  const snoozedTo = now.getTime() + minutes * 60_000;
  const scheduled = Date.parse(reminder.dueAt);
  if (Number.isFinite(scheduled) && scheduled <= snoozedTo) {
    return { ok: true, data: reminder };
  }

  return recordReminderFire(reminderId, { dueAt: new Date(snoozedTo).toISOString() }, storeOptions);
}
