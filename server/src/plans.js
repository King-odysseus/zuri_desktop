/**
 * Nigerian starter plans. Prices are stored in kobo because Paystack expects
 * the smallest currency unit. Allowances are deliberately configuration data,
 * so pricing can be changed without rewriting quota logic.
 */
export const PLANS = Object.freeze([
  Object.freeze({ code: 'free', name: 'Free', amountKobo: 0, monthlyTokens: 100_000 }),
  Object.freeze({ code: 'starter', name: 'Starter', amountKobo: 250_000, monthlyTokens: 2_000_000 }),
  Object.freeze({ code: 'pro', name: 'Pro', amountKobo: 600_000, monthlyTokens: 6_000_000 }),
  Object.freeze({ code: 'power', name: 'Power', amountKobo: 1_500_000, monthlyTokens: 12_000_000 }),
]);

/**
 * Return a plan by its public code without exposing mutable configuration.
 * @param {unknown} code
 * @returns {{ code: string, name: string, amountKobo: number, monthlyTokens: number } | null}
 */
export function findPlan(code) {
  if (typeof code !== 'string') return null;
  const plan = PLANS.find((entry) => entry.code === code.trim().toLowerCase());
  return plan ? { ...plan } : null;
}

/**
 * Convert the public plan shape into an API-safe response with explicit currency.
 * @param {{ code: string, name: string, amountKobo: number, monthlyTokens: number }} plan
 * @returns {{ code: string, name: string, currency: 'NGN', amountKobo: number, monthlyTokens: number }}
 */
export function publicPlan(plan) {
  return {
    code: plan.code,
    name: plan.name,
    currency: 'NGN',
    amountKobo: plan.amountKobo,
    monthlyTokens: plan.monthlyTokens,
  };
}
