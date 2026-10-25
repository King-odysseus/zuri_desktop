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

/** Feature bullets shown on each plan card. */
const PLAN_FEATURES = {
  starter: ['Everyday questions and longer conversations', 'Zuri Flash uses 1x allowance', 'Two requests at a time'],
  pro: ['Zuri Max uses 12x allowance', 'Zuri Code and Zuri Reason use 10x', 'Higher per-minute limits'],
  power: ['The largest input and output limits', 'More room for weighted models', 'Built for heavy workloads'],
  max: ['Zuri Elite uses 20x allowance', 'Every Zuri model is available', 'The highest limits we offer'],
};

/** @param {string} code */
export function planFeatures(code) {
  return PLAN_FEATURES[code] ?? ['Tokens on your plan'];
}
