/**
 * Per-plan request guardrails. Token quotas remain authoritative in the
 * database; these limits stop an account from creating a burst of
 * expensive provider calls before the usage event is recorded.
 */
export const PLAN_LIMITS = Object.freeze({
  starter: Object.freeze({ requestsPerMinute: 30, maxConcurrent: 2, maxInputTokens: 16_000, maxOutputTokens: 2_000 }),
  pro: Object.freeze({ requestsPerMinute: 60, maxConcurrent: 3, maxInputTokens: 32_000, maxOutputTokens: 4_000 }),
  power: Object.freeze({ requestsPerMinute: 120, maxConcurrent: 4, maxInputTokens: 64_000, maxOutputTokens: 8_000 }),
  max: Object.freeze({ requestsPerMinute: 240, maxConcurrent: 8, maxInputTokens: 128_000, maxOutputTokens: 16_000 }),
});

/** @param {unknown} planCode @returns {object} */
export function limitsForPlan(planCode) {
  const key = typeof planCode === 'string' ? planCode.trim().toLowerCase() : '';
  return { ...(PLAN_LIMITS[key] ?? PLAN_LIMITS.starter) };
}

/** @param {unknown} value @returns {number} */
function timestamp(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(number) ? number : Date.now();
}

/**
 * Create a small process-local limiter. Railway deployments with multiple
 * replicas should move this state to a shared store before scaling out.
 * @param {{ now?: () => number | Date, windowMs?: number }} [options]
 */
export function createRequestLimiter({ now = () => Date.now(), windowMs = 60_000 } = {}) {
  const buckets = new Map();

  function prune(currentTime) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.active === 0 && currentTime - bucket.windowStartedAt >= windowMs) buckets.delete(key);
    }
  }

  return {
    /** @param {unknown} key @param {{ requestsPerMinute: number, maxConcurrent: number }} limits */
    acquire(key, limits) {
      const normalizedKey = typeof key === 'string' ? key.trim() : '';
      const requestsPerMinute = Math.floor(Number(limits?.requestsPerMinute));
      const maxConcurrent = Math.floor(Number(limits?.maxConcurrent));
      const currentTime = timestamp(now());
      if (normalizedKey === '' || requestsPerMinute < 1 || maxConcurrent < 1) {
        return { allowed: false, reason: 'invalid_limits', retryAfterSeconds: 0, release() {} };
      }

      prune(currentTime);
      let bucket = buckets.get(normalizedKey);
      if (!bucket || currentTime - bucket.windowStartedAt >= windowMs) {
        bucket = { windowStartedAt: currentTime, requestCount: 0, active: 0 };
        buckets.set(normalizedKey, bucket);
      }

      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + windowMs - currentTime) / 1000));
      if (bucket.active >= maxConcurrent) {
        return { allowed: false, reason: 'concurrency_limit', retryAfterSeconds, release() {} };
      }
      if (bucket.requestCount >= requestsPerMinute) {
        return { allowed: false, reason: 'rate_limit', retryAfterSeconds, release() {} };
      }

      bucket.requestCount += 1;
      bucket.active += 1;
      let released = false;
      return {
        allowed: true,
        reason: 'ok',
        retryAfterSeconds: 0,
        release() {
          if (released) return;
          released = true;
          bucket.active = Math.max(0, bucket.active - 1);
        },
      };
    },
  };
}

/**
 * Length of the rolling burst window. A monthly quota alone lets an account
 * spend a whole month of headroom in one afternoon, which is what a short
 * window prevents; the monthly quota still decides what the month costs.
 */
export const QUOTA_WINDOW_HOURS = 5;

/**
 * Tokens each plan may spend inside one window, in quota tokens (the same
 * weighted unit usage_events stores). Roughly an eighth of the monthly
 * allowance: enough for a long working session, not enough to empty the month.
 *
 * Kept out of PLAN_LIMITS because those are per-request guardrails the desktop
 * app applies locally; this ceiling is enforced only by the server.
 */
export const WINDOW_TOKENS = Object.freeze({
  starter: 250_000,
  pro: 750_000,
  power: 1_500_000,
  max: 5_000_000,
});

/** @param {unknown} planCode @returns {number} */
export function windowTokensForPlan(planCode) {
  const key = typeof planCode === 'string' ? planCode.trim().toLowerCase() : '';
  return WINDOW_TOKENS[key] ?? WINDOW_TOKENS.starter;
}
