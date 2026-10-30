/**
 * Cloud reminder sweep.
 *
 * The client-side reminder ticker is useful while an app is open, but it cannot
 * wake a closed Windows, macOS or Android app. This sweep claims reminders in the
 * database and sends through the cloud mailer instead.
 */

export const DEFAULT_REMINDER_SWEEP_MS = 60_000;
const REMINDER_BATCH = 50;

function words(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nextDueAt(reminder, now) {
  const due = new Date(reminder.dueAt).getTime();
  if (!Number.isFinite(due)) return null;
  if (reminder.repeat === 'interval') {
    const minutes = Number(reminder.intervalMinutes);
    return new Date(now.getTime() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000).toISOString();
  }
  if (reminder.repeat === 'daily') {
    const next = new Date(now.getTime());
    next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  return null;
}

/**
 * @param {object} options
 * @param {{ claimDueReminders?: Function }} options.repository
 * @param {{ sendReminder?: Function }} [options.mailer]
 * @param {() => Date} [options.now]
 * @param {number} [options.sweepMs]
 * @returns {{ sweepOnce: () => Promise<{ ran: number, sent: number }>, start: () => void, stop: () => void }}
 */
export function createReminderScheduler({
  repository,
  mailer = null,
  now = () => new Date(),
  sweepMs = DEFAULT_REMINDER_SWEEP_MS,
}) {
  let timer = null;
  let sweeping = false;

  async function sweepOnce() {
    if (typeof repository?.claimDueReminders !== 'function') return { ran: 0, sent: 0 };
    // Leave due rows untouched until mail is configured. Claiming them first
    // would turn a deployment configuration mistake into a lost reminder.
    if (mailer?.configured === false || typeof mailer?.sendReminder !== 'function') return { ran: 0, sent: 0 };
    const current = now();
    const due = await repository.claimDueReminders({ now: current.toISOString(), limit: REMINDER_BATCH });
    let sent = 0;
    for (const reminder of due) {
      if (typeof mailer?.sendReminder !== 'function') continue;
      try {
        const result = await mailer.sendReminder({
          to: reminder.email,
          title: reminder.title,
          dueAt: reminder.dueAt,
        });
        if (result?.sent === true) sent += 1;
      } catch (error) {
        // Claiming is atomic, so a failed provider call cannot make the same
        // reminder fire repeatedly on every sweep.
        console.error('[zuri-cloud] reminder email', words(error?.message) || error);
      }
    }
    return { ran: due.length, sent };
  }

  return {
    sweepOnce,
    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (sweeping) return;
        sweeping = true;
        sweepOnce()
          .catch((error) => console.error('[zuri-cloud] reminder sweep', words(error?.message) || error))
          .finally(() => { sweeping = false; });
      }, sweepMs);
      if (typeof timer?.unref === 'function') timer.unref();
      sweeping = true;
      sweepOnce()
        .catch((error) => console.error('[zuri-cloud] reminder catch-up', words(error?.message) || error))
        .finally(() => { sweeping = false; });
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

export { nextDueAt };
