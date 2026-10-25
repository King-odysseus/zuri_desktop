/**
 * Extra-usage packs. These are one-off purchases rather than subscriptions: a
 * customer whose plan allowance is spent can buy tokens without changing plan.
 *
 * The tokens expire, so a forgotten pack cannot sit on the balance sheet for
 * years, and they are counted into the current allowance rather than replacing
 * it. Amounts are in kobo (Naira times 100); the unit rate is deliberately a
 * little above the plan rate, because a one-off payment has none of a
 * subscription's predictability.
 */

/** How long purchased tokens stay usable. */
export const TOPUP_VALID_DAYS = 90;

export const TOPUP_PACKS = Object.freeze([
  Object.freeze({ code: 'topup-small', name: 'Small pack', tokens: 1_000_000, amountKobo: 150_000, validDays: TOPUP_VALID_DAYS }),
  Object.freeze({ code: 'topup-medium', name: 'Medium pack', tokens: 3_000_000, amountKobo: 420_000, validDays: TOPUP_VALID_DAYS }),
  Object.freeze({ code: 'topup-large', name: 'Large pack', tokens: 8_000_000, amountKobo: 1_000_000, validDays: TOPUP_VALID_DAYS }),
]);

/**
 * Look a pack up by its code.
 * @param {unknown} code
 * @returns {{ code: string, name: string, tokens: number, amountKobo: number, validDays: number } | null}
 */
export function findTopupPack(code) {
  const key = typeof code === 'string' ? code.trim().toLowerCase() : '';
  return TOPUP_PACKS.find((pack) => pack.code === key) ?? null;
}

/**
 * The fields a customer may see. The list is explicit so a later internal field
 * on a pack cannot leak into the public response by accident.
 * @param {{ code: string, name: string, tokens: number, amountKobo: number, validDays: number }} pack
 */
export function publicTopupPack(pack) {
  return {
    code: pack.code,
    name: pack.name,
    tokens: pack.tokens,
    amountKobo: pack.amountKobo,
    validDays: pack.validDays,
  };
}
