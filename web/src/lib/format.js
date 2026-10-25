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

/**
 * The headline on an image card. One wording for every image price keeps the
 * unit next to the number, so "NGN 60 per image" is never read as a plan price.
 * @param {unknown} amountKobo
 */
export function imagePriceLine(amountKobo) {
  return `${formatNaira(amountKobo)} per image`;
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
 * (prompts and replies, in that order: 1/1, 5/8, 12/18, 10/42, 10/30 and 20/60)
 * and the per-plan guardrails in `server/src/limits.js`. Max holds the highest
 * limits, which is why Power does not claim to.
 *
 * Replies are named separately because they are charged separately: a supplier
 * bills the reply at four to eight times the prompt's rate, so a plan's allowance
 * lasts fewer replies than prompts. Stating one number for both would be selling
 * an allowance the account cannot actually reach.
 */
const PLAN_FEATURES = {
  starter: ['Zuri Flash: prompts 1x, replies 1x', 'Zuri Pro: prompts 5x, replies 8x', '2 requests at a time, 30 a minute'],
  pro: ['Zuri Max: prompts 12x, replies 18x', 'Zuri Code and Zuri Reason: prompts 10x, replies 30x', '3 requests at a time, 60 a minute'],
  power: ['Every model except Zuri Elite', 'The same model weights as Pro', '4 requests at a time, 120 a minute', 'Up to 64,000 input and 8,000 output tokens per request'],
  max: ['Zuri Elite: prompts 20x, replies 60x', 'Every Zuri model is available', '8 requests at a time, 240 a minute'],
};

/** @param {string} code */
export function planFeatures(code) {
  return PLAN_FEATURES[code] ?? ['Tokens on your plan'];
}

/*
 * The plan ladder, cheapest first. Which image models a plan includes is read
 * from each model's `minPlan` in the server catalogue, never from a table here,
 * so a rate or a floor change on the server shows up on the page untouched.
 */
const PLAN_LADDER = ['starter', 'pro', 'power', 'max'];

/** @param {string} code @returns {number} Position on the ladder, or -1 if unknown. */
export function planRank(code) {
  return PLAN_LADDER.indexOf(String(code ?? '').toLowerCase());
}

/**
 * The server's own plan name when the caller has the plan list, else the code
 * with its first letter raised, so a card never shows "pro" to a customer.
 * @param {string} code
 * @param {Array<{ code: string, name: string }>} [plans]
 */
export function planLabel(code, plans = []) {
  const normalised = String(code ?? '').toLowerCase();
  if (!normalised) return '';
  const match = (Array.isArray(plans) ? plans : []).find(
    (plan) => String(plan?.code ?? '').toLowerCase() === normalised,
  );
  if (match?.name) return match.name;
  return `${normalised.charAt(0).toUpperCase()}${normalised.slice(1)}`;
}

/** @param {Array<{ code: string }>} [plans] The highest plan this catalogue knows. */
export function highestPlanRank(plans = []) {
  const ranks = (Array.isArray(plans) ? plans : [])
    .map((plan) => planRank(plan?.code))
    .filter((rank) => rank !== -1);
  return ranks.length > 0 ? Math.max(...ranks) : PLAN_LADDER.length - 1;
}

/** "a, b or c". Never "and": these counts are alternatives, not a sum. */
function listed(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** "a, b and c", for clauses that all hold at once. */
function joined(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Up to two short lines for a plan tile, or none when the image catalogue did
 * not load.
 *
 * The counts are the plan's token allowance divided by the image model's quota
 * cost, so they are alternatives: nobody can spend the whole allowance on
 * messages and on images at those maximum counts. That is why the models are
 * joined with "or", and why a model above the plan is named with the plan that
 * unlocks it rather than being counted in.
 * @param {string} planCode
 * @param {Array<object>} imagePrices The /api/image-prices catalogue.
 * @param {Array<{ code: string, name: string }>} [plans] For the plan names.
 * @returns {string[]}
 */
export function planImageLines(planCode, imagePrices, plans = []) {
  const code = String(planCode ?? '').toLowerCase();
  const rank = planRank(code);
  const models = (Array.isArray(imagePrices) ? imagePrices : []).filter(
    (model) => model && typeof model.name === 'string' && Array.isArray(model.plans),
  );
  if (rank === -1 || models.length === 0) return [];

  const imagesOn = (model) => {
    const entry = model.plans.find((plan) => String(plan?.code ?? '').toLowerCase() === code);
    const images = Math.floor(Number(entry?.images));
    return Number.isFinite(images) && images > 0 ? images : 0;
  };

  const included = [];
  const locked = [];
  for (const model of models) {
    const floor = planRank(model.minPlan);
    // A model whose floor is not on the ladder cannot be placed, so it is left
    // out rather than guessed at.
    if (floor === -1) continue;
    (floor <= rank ? included : locked).push({ model, floor });
  }

  const lines = [];

  // Highest model first, which is also the order the plans themselves climb.
  const counted = included
    .sort((a, b) => b.floor - a.floor || imagesOn(a.model) - imagesOn(b.model))
    .map(({ model }) => ({ name: model.name, images: imagesOn(model) }))
    .filter((entry) => entry.images > 0);

  if (counted.length > 0) {
    const words = counted.map((entry) => `${formatTokens(entry.images)} ${entry.name}`);
    const noun = counted.length === 1 && counted[0].images === 1 ? 'image' : 'images';
    lines.push(`About ${listed(words)} ${noun} a month`);
  }

  if (locked.length > 0) {
    const byPlan = new Map();
    for (const { model, floor } of locked.sort((a, b) => a.floor - b.floor)) {
      const plan = PLAN_LADDER[floor];
      byPlan.set(plan, [...(byPlan.get(plan) ?? []), model.name]);
    }
    const clauses = [...byPlan].map(
      ([plan, names]) => `${joined(names)} ${names.length === 1 ? 'unlocks' : 'unlock'} on ${planLabel(plan, plans)}`,
    );
    lines.push(joined(clauses));
  }

  return lines.slice(0, 2);
}
