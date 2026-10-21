/**
 * scheduler.js - which scheduled automations are due on this tick.
 *
 * Only the selection lives here, as a pure function over the stored `schedules`
 * array and an explicit clock. The 30-second timer, running an automation and
 * recording the run belong to the scheduler card; keeping the choice free of
 * timers is what lets scripts/selftest.js drive it with a fixed clock instead of
 * waiting on real time.
 *
 * Two rules the earlier stories depend on:
 * - A run missed while Zuri was closed is replayed once, not once per missed
 *   interval, so `dueSchedules` returns each automation at most once however far
 *   in the past its `nextRunAt` sits.
 * - A paused automation, and one with no readable `nextRunAt` (still being
 *   created), is skipped quietly rather than treated as due now.
 */

/** A pause in the UI is stored as `enabled: false`; a missing flag means enabled. */
function isPaused(schedule) {
  return schedule.enabled === false || schedule.paused === true;
}

/**
 * Millisecond time for a stored timestamp, or NaN when it cannot be read.
 * `nextRunAt` is written as an ISO string by the automations module, but a
 * number is accepted so a hand-edited file still fires.
 * @param {unknown} value
 * @returns {number}
 */
function timeOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  return Date.parse(value);
}

/**
 * The automations due at `now`, oldest due first, each listed once.
 *
 * @param {Array<{ id?: string, nextRunAt?: string|number, enabled?: boolean }>} schedules Stored automations.
 * @param {number} [now] Clock in milliseconds; defaults to the wall clock.
 * @returns {Array<object>} The same objects, not copies: the caller advances their nextRunAt.
 */
export function dueSchedules(schedules, now = Date.now()) {
  if (!Array.isArray(schedules)) {
    throw new TypeError('dueSchedules expects the stored schedules array');
  }
  if (!Number.isFinite(now)) {
    throw new TypeError('dueSchedules expects a clock in milliseconds');
  }

  return schedules
    .filter((schedule) => {
      if (!schedule || typeof schedule !== 'object') return false;
      if (isPaused(schedule)) return false;
      const due = timeOf(schedule.nextRunAt);
      return Number.isFinite(due) && due <= now;
    })
    .sort((left, right) => {
      // Equal due times fall back to id so the order is stable across reads of the
      // same file; without it two runs due in the same millisecond could swap.
      const byTime = timeOf(left.nextRunAt) - timeOf(right.nextRunAt);
      if (byTime !== 0) return byTime;
      return String(left.id ?? '').localeCompare(String(right.id ?? ''));
    });
}

/**
 * Whether any automation is due, without building the list.
 * The tick uses this to stay quiet: no due work means no run and no notification.
 * @param {Array<object>} schedules
 * @param {number} [now]
 * @returns {boolean}
 */
export function hasDueSchedule(schedules, now = Date.now()) {
  return dueSchedules(schedules, now).length > 0;
}
