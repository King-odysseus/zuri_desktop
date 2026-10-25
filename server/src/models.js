import { PLANS } from './plans.js';

/** Suppliers the server can call. Customers never see these names. */
export const SUPPLIERS = Object.freeze(['deepseek', 'moonshot', 'zai', 'openai']);

/**
 * Starting catalogue, written to the database once and edited from the admin
 * dashboard after that. The supplier prices are placeholders: check them against
 * each supplier's current price list before charging customers.
 *
 * Prices are US dollars per million tokens, which is also micro-dollars per token,
 * so cost maths stays in whole numbers.
 */
export const DEFAULT_MODELS = Object.freeze([
  Object.freeze({ code: 'zuri-flash', name: 'Zuri Flash', supplier: 'deepseek', supplierModel: 'deepseek-flash', inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28, quotaWeight: 1, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 1 }),
  Object.freeze({ code: 'zuri-pro', name: 'Zuri Pro', supplier: 'moonshot', supplierModel: 'kimi-k3', inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5, quotaWeight: 5, minPlan: 'starter', rateFactor: 0.5, isActive: true, sortOrder: 2 }),
  Object.freeze({ code: 'zuri-max', name: 'Zuri Max', supplier: 'zai', supplierModel: 'glm-5.3', inputUsdPerMillion: 1.5, outputUsdPerMillion: 6, quotaWeight: 12, minPlan: 'pro', rateFactor: 0.25, isActive: true, sortOrder: 3 }),
]);

export const DEFAULT_MODEL_CODE = 'zuri-flash';

const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SUPPLIER_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,80}$/;

/** Position of a plan in the price ladder; an unknown code ranks below every plan. */
export function planRank(planCode) {
  return PLANS.findIndex((plan) => plan.code === planCode);
}

/** @param {{ minPlan: string }} model @param {string} planCode */
export function canUseModel(model, planCode) {
  const needed = planRank(model?.minPlan);
  const have = planRank(planCode);
  return needed !== -1 && have !== -1 && have >= needed;
}

/** Quota tokens a request uses: a dearer model burns the monthly allowance faster. */
export function quotaTokens(model, inputTokens, outputTokens) {
  const raw = Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0);
  return Math.ceil(raw * Math.max(0, Number(model?.quotaWeight) || 1));
}

/** What the supplier charges for one request, in micro-dollars. */
export function supplierCostMicroUsd(model, inputTokens, outputTokens) {
  const input = Math.max(0, Number(inputTokens) || 0) * (Number(model?.inputUsdPerMillion) || 0);
  const output = Math.max(0, Number(outputTokens) || 0) * (Number(model?.outputUsdPerMillion) || 0);
  // Trimmed before rounding up: 100 * 0.14 is 14.000000000000002 in floating point,
  // which would otherwise be charged as 15.
  return Math.ceil(Number((input + output).toFixed(6)));
}

/** Micro-dollars to kobo at the given naira-per-dollar rate. */
export function microUsdToKobo(microUsd, nairaPerUsd) {
  return Math.round((Number(microUsd) / 1_000_000) * Number(nairaPerUsd) * 100);
}

/** Expensive models get a smaller share of the plan's request allowance. */
export function limitsForModel(planLimits, model) {
  const factor = Math.min(1, Math.max(0.05, Number(model?.rateFactor) || 1));
  return {
    ...planLimits,
    requestsPerMinute: Math.max(1, Math.floor(planLimits.requestsPerMinute * factor)),
    maxConcurrent: Math.max(1, Math.floor(planLimits.maxConcurrent * factor)),
  };
}

/** Pick the requested model, or the default when none was asked for. */
export function findModel(models, code) {
  const wanted = typeof code === 'string' && code.trim() !== '' ? code.trim() : DEFAULT_MODEL_CODE;
  return models.find((model) => model.code === wanted && model.isActive) ?? null;
}

/** What a customer may see: the Zuri name and its tier, never the supplier. */
export function publicModel(model, planCode) {
  return {
    code: model.code,
    name: model.name,
    minPlan: model.minPlan,
    quotaWeight: model.quotaWeight,
    available: canUseModel(model, planCode),
  };
}

/**
 * Validate an admin edit. Returns the clean model or the first problem found, so
 * a typo in the dashboard is refused instead of saved.
 * @returns {{ ok: true, model: object } | { ok: false, message: string }}
 */
export function validateModelInput(input) {
  const code = typeof input?.code === 'string' ? input.code.trim().toLowerCase() : '';
  if (!CODE_PATTERN.test(code)) return { ok: false, message: 'The model code needs 2 to 40 lowercase letters, numbers or hyphens.' };
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '' || name.length > 40) return { ok: false, message: 'The model needs a name of up to 40 characters.' };
  if (!SUPPLIERS.includes(input.supplier)) return { ok: false, message: `The supplier must be one of ${SUPPLIERS.join(', ')}.` };
  const supplierModel = typeof input.supplierModel === 'string' ? input.supplierModel.trim() : '';
  if (!SUPPLIER_MODEL_PATTERN.test(supplierModel)) return { ok: false, message: 'The supplier model name is not valid.' };
  if (planRank(input.minPlan) === -1) return { ok: false, message: 'The minimum plan does not exist.' };

  const inputUsd = Number(input.inputUsdPerMillion);
  const outputUsd = Number(input.outputUsdPerMillion);
  if (![inputUsd, outputUsd].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)) {
    return { ok: false, message: 'Prices must be between 0 and 1000 dollars per million tokens.' };
  }
  const quotaWeight = Number(input.quotaWeight);
  if (!Number.isFinite(quotaWeight) || quotaWeight < 0.1 || quotaWeight > 100) {
    return { ok: false, message: 'The quota weight must be between 0.1 and 100.' };
  }
  const rateFactor = Number(input.rateFactor);
  if (!Number.isFinite(rateFactor) || rateFactor < 0.05 || rateFactor > 1) {
    return { ok: false, message: 'The rate factor must be between 0.05 and 1.' };
  }
  const sortOrder = Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 100;

  return {
    ok: true,
    model: {
      code,
      name,
      supplier: input.supplier,
      supplierModel,
      inputUsdPerMillion: inputUsd,
      outputUsdPerMillion: outputUsd,
      quotaWeight,
      minPlan: input.minPlan,
      rateFactor,
      isActive: input.isActive !== false,
      sortOrder,
    },
  };
}
