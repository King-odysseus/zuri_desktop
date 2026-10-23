/**
 * reminders.js - the ten-second heartbeat behind reminders.
 *
 * A reminder carries the time it should next fire (`dueAt`), so a tick is a
 * filter over reminders.json rather than a rule engine: everything whose dueAt
 * has passed fires once, gets a Windows notification, a line in
 * notifications.json, and a new dueAt (or, for a one-off, is marked complete).
 *
 * The interval lives here and nowhere else. Main starts it on `ready`, an
 * immediate first tick catches up anything that came due while Zuri was closed,
 * and every tick reports the new unread count so the bell and the right-panel
 * list can refresh without polling.
 *
 * Electron is required lazily, exactly as store.js does, so scripts/selftest.js
 * can import and drive this module under plain Node with an injected notifier.
 */

import { createRequire } from 'node:module';

import {
  REMINDER_INTERVAL_DEFAULT_MINUTES,
  appendNotification,
  listNotifications,
  listReminders,
  parseTimeOfDay,
  recordReminderFire,
} from './store.js';

import {
  ACTION_DISMISS,
  ACTION_OPEN,
  ACTION_SNOOZE,
  buildReminderToast,
  snoozeReminder,
  todayFireCounts,
} from './reminder-toast.js';

/** How often due reminders are checked. The card asks for ten seconds. */
export const REMINDER_TICK_MS = 10_000;

/** Title of the line written to notifications.json, which is the bell's history. */
const NOTIFICATION_TITLE = 'Zuri reminder';

/** Stop handle for the running ticker, if there is one. */
let stopActiveTicker = null;

/**
 * The next time a reminder should fire, given the moment it just fired at.
 * @param {any} reminder A stored reminder.
 * @param {Date} [from] The moment to count from, normally now.
 * @returns {string | null} ISO time, or null when the reminder has no next fire.
 */
export function nextDueAt(reminder, from = new Date()) {
  const due = Date.parse(reminder?.dueAt);
  const repeat = reminder?.repeat;

  if (repeat === 'interval') {
    const minutes = Number.isFinite(reminder.intervalMinutes) && reminder.intervalMinutes >= 1
      ? reminder.intervalMinutes
      : REMINDER_INTERVAL_DEFAULT_MINUTES;
    const step = minutes * 60_000;
    let next = (Number.isFinite(due) ? due : from.getTime()) + step;

    // Zuri may have been closed for days. Skip the missed fires instead of
    // replaying them all at once, which would be a burst of identical toasts.
    if (next <= from.getTime()) {
      next += Math.ceil((from.getTime() - next) / step) * step;
    }
    return new Date(next).toISOString();
  }

  if (repeat === 'daily') {
    const fallback = Number.isFinite(due) ? minutesIntoDay(new Date(due)) : null;
    const minutes = parseTimeOfDay(reminder.timeOfDay) ?? fallback;
    if (minutes === null) return null;

    const next = new Date(from.getTime());
    next.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    // Strictly after `from`: a fire time equal to now would otherwise be due
    // again on the very next tick, every ten seconds.
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  // A one-off has no next fire once it has fired.
  return null;
}

/**
 * @param {Date} date
 * @returns {number} Minutes past midnight, local time.
 */
function minutesIntoDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Which reminders are owed a notification at `now`.
 * @param {any[]} reminders Pending reminders from store.listReminders.
 * @param {Date} now
 * @returns {any[]}
 */
export function dueReminders(reminders, now = new Date()) {
  const cutoff = now.getTime();
  return reminders.filter((reminder) => {
    const due = Date.parse(reminder?.dueAt);
    return Number.isFinite(due) && due <= cutoff;
  });
}

/**
 * The clock time a notification names, in the form a person reads at a glance.
 * @param {string} iso
 * @param {Date} [now]
 * @returns {string} For example "today at 09:30" or "21 Oct at 09:30".
 */
export function whenLabel(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfThat - startOfToday) / 86_400_000);

  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `tomorrow at ${clock}`;
  if (days === -1) return `yesterday at ${clock}`;

  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${date.getDate()} ${month} at ${clock}`;
}

/**
 * The line that goes in notifications.json, the bell's history. The OS toast is
 * worded by reminder-toast.js from its own design node, so the two surfaces are
 * allowed to read differently: this one is a log line, that one is the toast.
 * @param {any} reminder
 * @param {Date} [now]
 * @returns {string}
 */
export function notificationBody(reminder, now = new Date()) {
  const when = whenLabel(reminder?.dueAt, now);
  return when === '' ? reminder?.title ?? '' : `${reminder.title} - due ${when}`;
}

/**
 * The real Windows notification. Electron is required here rather than imported
 * at the top so this module loads under plain Node.
 * @returns {(payload: object) => boolean} True when a
 *   toast was shown; false when the platform says it cannot show one.
 */
export function createSystemNotifier(options = {}) {
  const require = createRequire(import.meta.url);
  // Injectable so the project check can read what would be handed to Windows without
  // starting Electron: the check drives this very function.
  let Notification = options.Notification ?? null;
  if (Notification === null) {
    try {
      ({ Notification } = require('electron'));
    } catch (error) {
      // Running outside Electron (a script): no toast is possible, and that is not
      // an error. The notification is still recorded in notifications.json.
      return () => false;
    }
  }

  if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) {
    return () => false;
  }

  const snooze = options.onSnooze ?? ((payload) => snoozeReminder(payload.reminderId));

  return (payload) => {
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      actions,
      silent: payload.silent === true,
    });

    // Clicking the toast itself is the design's primary action, the same as
    // "Open reminders", so a person can ignore the buttons entirely.
    notification.on?.('click', () => options.onOpen?.());
    notification.on?.('action', (event, actionIndex) => {
      const index = Number.isFinite(event?.actionIndex) ? event.actionIndex : actionIndex;
      const action = actions[index]?.text ?? '';

      if (action === ACTION_SNOOZE) {
        // The write is reported rather than awaited here: a refused snooze must
        // reach the log instead of vanishing inside an event handler.
        Promise.resolve(snooze(payload)).catch((error) => console.error('[zuri:reminders] snooze', error));
        return;
      }
      if (action === ACTION_DISMISS) {
        notification.close?.();
        return;
      }
      if (action === ACTION_OPEN) options.onOpen?.();
    });

    notification.show();
    return true;
  };
}

/**
 * Fire everything that is due, once. Order matters: the notification is written
 * first, then shown, then the reminder moves to its next fire. A failed write
 * must not leave a reminder marked as fired with nothing to show for it.
 * @param {{ now?: Date, root?: string, notify?: (payload: object) => boolean, onOpen?: Function, onSnooze?: Function }} [options]
 * @returns {Promise<{ ok: true, data: { fired: string[], unread: number, showed: boolean } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function tickReminders(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const root = options.root;
  const notify = typeof options.notify === 'function'
    ? options.notify
    : createSystemNotifier({ onOpen: options.onOpen, onSnooze: options.onSnooze });
  const storeOptions = root === undefined ? {} : { root };

  const pending = await listReminders(storeOptions);
  if (!pending.ok) return pending;

  const due = dueReminders(pending.data, now);
  const fired = [];
  let showed = false;

  // The toast's "occurrence N today" counts fires, and notifications.json is the only
  // record of them. Read once per tick before anything is written, so the count is the
  // fires before this one and the fire being raised now is the +1.
  const counted = due.length === 0 ? null : await listNotifications(storeOptions);
  if (counted !== null && !counted.ok) return counted;
  const countsToday = counted === null ? new Map() : todayFireCounts(counted.data.items, now);

  for (const reminder of due) {
    const body = notificationBody(reminder, now);

    const recorded = await appendNotification(
      { reminderId: reminder.id, title: NOTIFICATION_TITLE, body },
      storeOptions,
    );
    if (!recorded.ok) return recorded;

    const firedToday = (countsToday.get(reminder.id) ?? 0) + 1;

    try {
      showed = notify(buildReminderToast(reminder, { now, firedToday })) || showed;
    } catch (error) {
      // A refused toast is not a reason to fire the reminder again next tick;
      // the line in notifications.json is still there for the bell.
      console.error('[zuri:reminders] notification', error);
    }

    const advanced = await recordReminderFire(
      reminder.id,
      { dueAt: nextDueAt(reminder, now), firedAt: now.toISOString() },
      storeOptions,
    );
    if (!advanced.ok) return advanced;

    fired.push(reminder.id);
  }

  const history = await listNotifications(storeOptions);
  if (!history.ok) return history;

  return { ok: true, data: { fired, unread: history.data.unread, showed } };
}

/**
 * Start the ten-second ticker. The first tick runs immediately, which is the
 * catch-up sweep for reminders that came due while Zuri was closed.
 * Calling it twice returns the running stop handle rather than starting a second
 * loop, so a second window or a reload cannot double the notifications.
 * @param {{ intervalMs?: number, root?: string, notify?: Function, onOpen?: Function, onSnooze?: Function, onTick?: (result: object) => void }} [options]
 * @returns {() => void} Stops the ticker.
 */
export function startReminderTicker(options = {}) {
  if (stopActiveTicker !== null) return stopActiveTicker;

  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : REMINDER_TICK_MS;
  let running = false;
  let timer = null;

  const run = async () => {
    // A slow disk must not stack ticks: skip this one rather than overlap reads.
    if (running) return;
    running = true;
    try {
      const result = await tickReminders({
        root: options.root,
        notify: options.notify,
        onOpen: options.onOpen,
        onSnooze: options.onSnooze,
      });
      if (!result.ok) {
        console.error('[zuri:reminders]', result.error.message);
      } else if (typeof options.onTick === 'function') {
        options.onTick(result.data);
      }
    } catch (error) {
      // The ticker must survive one bad read; the next tick tries again.
      console.error('[zuri:reminders] tick', error);
    } finally {
      running = false;
    }
  };

  void run();
  timer = setInterval(() => {
    void run();
  }, intervalMs);

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (stopActiveTicker === stop) stopActiveTicker = null;
  };
  stopActiveTicker = stop;
  return stop;
}

/**
 * Stop the running ticker, if any. Used on quit so a pending tick cannot write
 * to a store that is already closing.
 * @returns {void}
 */
export function stopReminderTicker() {
  stopActiveTicker?.();
}
