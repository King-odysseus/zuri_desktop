// Presentation helpers shared by the marketing pages and the dashboard.
const NUMBER = new Intl.NumberFormat('en-NG');

/** @param {unknown} value */
export function formatTokens(value) {
  return NUMBER.format(Math.max(0, Math.floor(Number(value) || 0)));
}

/** @param {unknown} amountKobo Paystack stores amounts in kobo (1/100 of a naira). */
export function formatNaira(amountKobo) {
  return `NGN ${NUMBER.format(Math.round((Number(amountKobo) || 0) / 100))}`;
}

/** @param {unknown} value */
export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** @param {string} [displayName] @param {string} [email] */
export function initialsFor(displayName, email) {
  const source = (displayName || email || 'Z').trim();
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0].toUpperCase()).join('');
  return initials || 'Z';
}

/*
 * These bullets must agree with two server tables, so a customer is never sold
 * a limit the API will refuse: the model weights in `server/src/models.js`
 * (1, 5, 12, 10, 10 and 20) and the per-plan guardrails in
 * `server/src/limits.js`. Max holds the highest limits, which is why Power
 * does not claim to.
 */
const PLAN_FEATURES = {
  starter: ['Zuri Flash uses 1x allowance', 'Zuri Pro uses 5x', '2 requests at a time, 30 a minute'],
  pro: ['Zuri Max uses 12x allowance', 'Zuri Code and Zuri Reason use 10x', '3 requests at a time, 60 a minute'],
  power: ['Every model except Zuri Elite', '4 requests at a time, 120 a minute', 'Up to 64,000 input and 8,000 output tokens per request'],
  max: ['Zuri Elite uses 20x allowance', 'Every Zuri model is available', '8 requests at a time, 240 a minute'],
};

/** @param {string} code */
export function planFeatures(code) {
  return PLAN_FEATURES[code] ?? ['Tokens on your plan'];
}
