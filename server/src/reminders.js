/** Cloud reminder sweep that writes durable in-app notifications. */

export const DEFAULT_REMINDER_SWEEP_MS = 60_000;

function words(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** @param {object} options @returns {{ sweepOnce: Function, start: Function, stop: Function }} */
export function createReminderScheduler({ repository, now = () => new Date(), sweepMs = DEFAULT_REMINDER_SWEEP_MS }) {
  let timer = null;
  let sweeping = false;

  async function sweepOnce() {
    if (typeof repository?.claimDueReminders !== 'function' || typeof repository?.appendNotification !== 'function') {
      return { ran: 0 };
    }
    const due = await repository.claimDueReminders({ now: now().toISOString(), limit: 50 });
    for (const reminder of due) {
      await repository.appendNotification({
        userId: reminder.userId,
        kind: 'reminder',
        title: 'Reminder due',
        body: words(reminder.title) || 'A reminder is due.',
      });
    }
    return { ran: due.length };
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
