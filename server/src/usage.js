import { QUOTA_WINDOW_HOURS, windowTokensForPlan } from './limits.js';

/**
 * Build the quota state shown to both a customer and an administrator. The
 * server remains the source of truth; this module only turns verified database
 * totals into a stable response shape.
 * @param {{ code: string, name: string, amountKobo: number, monthlyTokens: number }} plan
 * @param {unknown} usedTokens tokens already spent in the billing period
 * @param {{ creditTokens?: unknown, windowUsedTokens?: unknown, windowOldestAt?: unknown }} [options]
 *   creditTokens: purchased tokens that have not expired. windowUsedTokens and
 *   windowOldestAt come from measuring the rolling window; omit both (as the
 *   admin listing does) and the response carries no window at all.
 * @returns {{ planCode: string, monthlyTokens: number, extraTokens: number, usedTokens: number, remainingTokens: number, percentUsed: number, overQuota: boolean, nearLimit: boolean, window?: object }}
 */
export function usageStatus(plan, usedTokens, options = {}) {
  const safeUsed = count(usedTokens, 0);
  const extraTokens = count(options.creditTokens, 0);
  // Purchased tokens raise the ceiling instead of replacing the plan's own
  // allowance, so the period keeps counting one number for the customer.
  const monthlyTokens = Math.max(0, count(plan?.monthlyTokens, 0) + extraTokens);
  const remainingTokens = Math.max(monthlyTokens - safeUsed, 0);
  const percentUsed = monthlyTokens === 0
    ? 100
    : Math.min(Math.round((safeUsed / monthlyTokens) * 100), 100);

  const status = {
    planCode: typeof plan?.code === 'string' ? plan.code : '',
    monthlyTokens,
    extraTokens,
    usedTokens: safeUsed,
    remainingTokens,
    percentUsed,
    overQuota: safeUsed >= monthlyTokens,
    nearLimit: monthlyTokens > 0 && safeUsed >= Math.ceil(monthlyTokens * 0.8),
  };

  // Only measured windows are reported. A caller that never read usage_events
  // for the window would otherwise show a confident and wrong zero.
  if (typeof options.windowUsedTokens === 'number') {
    status.window = windowStatus(plan?.code, options.windowUsedTokens, options.windowOldestAt, extraTokens);
  }
  return status;
}

/**
 * The rolling window on its own clock. Purchased tokens raise its ceiling too:
 * capping them at the plan's window would refuse a request the customer has
 * already paid for, and the ceiling stays finite because the tokens are.
 * @param {unknown} planCode
 * @param {number} usedTokens
 * @param {unknown} oldestAt timestamp of the oldest event still inside the window
 * @param {number} extraTokens
 */
function windowStatus(planCode, usedTokens, oldestAt, extraTokens) {
  const planTokens = windowTokensForPlan(planCode);
  const tokens = planTokens + Math.max(0, extraTokens);
  const used = count(usedTokens, 0);
  const oldest = oldestAt ? new Date(oldestAt) : null;
  const oldestTime = oldest && Number.isFinite(oldest.getTime()) ? oldest.getTime() : 0;
  // The window only frees up once the oldest event ages out, so that moment is
  // the earliest a blocked request can succeed.
  const resetsAt = used > 0 && oldestTime > 0
    ? new Date(oldestTime + QUOTA_WINDOW_HOURS * 3_600_000).toISOString()
    : null;

  return {
    hours: QUOTA_WINDOW_HOURS,
    planTokens,
    tokens,
    usedTokens: used,
    remainingTokens: Math.max(tokens - used, 0),
    percentUsed: tokens === 0 ? 100 : Math.min(Math.round((used / tokens) * 100), 100),
    overWindow: used >= tokens,
    resetsAt,
  };
}

/** A non-negative whole number, or the fallback when the value is unusable. */
function count(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

/**
 * Check a request before calling DeepSeek. This is deliberately separate from
 * usageStatus because a request can fit the remaining quota while the next one
 * cannot, and the database transaction must enforce that decision atomically.
 * @param {{ monthlyTokens: number }} plan
 * @param {unknown} usedTokens
 * @param {unknown} requestedTokens
 * @returns {{ allowed: boolean, reason: 'ok' | 'quota_exceeded' | 'invalid_tokens' }}
 */
export function canConsume(plan, usedTokens, requestedTokens) {
  const used = Number(usedTokens);
  const requested = Number(requestedTokens);
  const monthlyTokens = Number(plan?.monthlyTokens);
  if (![used, requested, monthlyTokens].every((value) => Number.isFinite(value) && value >= 0)) {
    return { allowed: false, reason: 'invalid_tokens' };
  }
  return used + requested <= monthlyTokens
    ? { allowed: true, reason: 'ok' }
    : { allowed: false, reason: 'quota_exceeded' };
}
