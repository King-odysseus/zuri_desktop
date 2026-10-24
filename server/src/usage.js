/**
 * Build the quota state shown to both a customer and an administrator. The
 * server remains the source of truth; this module only turns verified database
 * totals into a stable response shape.
 * @param {{ code: string, name: string, amountKobo: number, monthlyTokens: number }} plan
 * @param {unknown} usedTokens
 * @returns {{ planCode: string, monthlyTokens: number, usedTokens: number, remainingTokens: number, percentUsed: number, overQuota: boolean, nearLimit: boolean }}
 */
export function usageStatus(plan, usedTokens) {
  const numericUsed = Number(usedTokens);
  const safeUsed = Number.isFinite(numericUsed) && numericUsed >= 0 ? Math.floor(numericUsed) : 0;
  const monthlyTokens = Math.max(0, Math.floor(Number(plan?.monthlyTokens) || 0));
  const remainingTokens = Math.max(monthlyTokens - safeUsed, 0);
  const percentUsed = monthlyTokens === 0
    ? 100
    : Math.min(Math.round((safeUsed / monthlyTokens) * 100), 100);

  return {
    planCode: typeof plan?.code === 'string' ? plan.code : '',
    monthlyTokens,
    usedTokens: safeUsed,
    remainingTokens,
    percentUsed,
    overQuota: safeUsed >= monthlyTokens,
    nearLimit: monthlyTokens > 0 && safeUsed >= Math.ceil(monthlyTokens * 0.8),
  };
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
