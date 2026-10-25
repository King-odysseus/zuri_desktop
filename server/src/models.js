import { PLANS } from './plans.js';

/** Suppliers the server can call. Customers never see these names. */
export const SUPPLIERS = Object.freeze(['deepseek', 'moonshot', 'zai', 'openai', 'anthropic']);

/** What a model sells: text by the token, or a finished picture by the image. */
export const MODEL_KINDS = Object.freeze(['text', 'image']);

/**
 * Starting catalogue, written to the database once and edited from the admin
 * dashboard after that.
 *
 * Prices and ids were checked against each supplier's own documentation (October
 * 2026), and the models test pins the ones a wrong guess would silently overspend:
 *   deepseek-flash     DeepSeek, the current name for V4.1-Flash,  $0.14 / $0.28
 *   claude-sonnet-5-5  Anthropic Sonnet 5.5,                     $2    / $10
 *   claude-opus-5-5    Anthropic Opus 5.5,                       $4    / $20
 *   glm-5.3            Z.ai GLM 5.3,                             $1.5  / $6
 *   gpt-6.1-sol        OpenAI GPT-6.1 Sol,                       $2    / $10
 *
 * This row used gpt-5.3-codex, which OpenAI now marks Deprecated: it answers today
 * but will stop, and a deprecated id fails every request the day it is switched off.
 * GPT-6.1 Sol replaces it because it is current, priced within a few cents of the old
 * model, and is OpenAI's own "balance intelligence and cost" choice. GPT-6 Astra is
 * the coding flagship but bills $10/$50, which the Pro allowance cannot carry without
 * a weight high enough to cut the monthly allowance by more than half.
 * Re-check those before any future price change: a figure below the supplier's
 * rate, or an id that no longer exists, is the failure this file is priced against.
 *
 * Prices are US dollars per million tokens, which is also micro-dollars per token,
 * so cost maths stays in whole numbers.
 *
 * Text models charge by the token. Image models charge a fixed number of quota
 * tokens per picture instead, so one monthly allowance covers both and there is
 * no second meter to reconcile.
 *
 * quotaWeight prices the prompt and outputQuotaWeight prices the reply, because
 * suppliers bill those two directions at very different rates (four to eight
 * times dearer for the reply on most of this catalogue). One shared weight sold
 * the expensive half of a request at the cheap half's price, which made the
 * output-heavy models lose money. A reply weight of 0 means "same as the prompt".
 *
 * Choosing the reply weight: keep it at or above three times outputUsdPerMillion.
 * At the cheapest plan rate (0.1 kobo per quota token) that leaves roughly half
 * the fee as margin even for an account that spends its whole allowance on
 * replies, so no customer can be cheaper than the plan they bought. The
 * catalogue test asserts this for every text model.
 */
export const DEFAULT_MODELS = Object.freeze([
  Object.freeze({ code: 'zuri-flash', name: 'Zuri Flash', supplier: 'deepseek', supplierModel: 'deepseek-flash', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28, quotaWeight: 1, outputQuotaWeight: 1, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 1 }),
  Object.freeze({ code: 'zuri-pro', name: 'Zuri Pro', supplier: 'moonshot', supplierModel: 'kimi-k3', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5, quotaWeight: 5, outputQuotaWeight: 8, minPlan: 'starter', rateFactor: 0.5, isActive: true, sortOrder: 2 }),
  Object.freeze({ code: 'zuri-max', name: 'Zuri Max', supplier: 'zai', supplierModel: 'glm-5.3', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 1.5, outputUsdPerMillion: 6, quotaWeight: 12, outputQuotaWeight: 18, minPlan: 'pro', rateFactor: 0.25, isActive: true, sortOrder: 3 }),
  // Sold as Zuri Core: it is an OpenAI general model priced with Zuri Reason, not a
  // coding model, so the name promises nothing the supplier ladder cannot keep. The
  // code stays 'zuri-code' because usage history and saved settings already name it,
  // and rewriting the key would orphan both without changing anything a person sees.
  Object.freeze({ code: 'zuri-code', name: 'Zuri Core', supplier: 'openai', supplierModel: 'gpt-6.1-sol', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 2, outputUsdPerMillion: 10, quotaWeight: 10, outputQuotaWeight: 30, minPlan: 'pro', rateFactor: 0.4, isActive: true, sortOrder: 4 }),
  Object.freeze({ code: 'zuri-reason', name: 'Zuri Reason', supplier: 'anthropic', supplierModel: 'claude-sonnet-5-5', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 2, outputUsdPerMillion: 10, quotaWeight: 10, outputQuotaWeight: 30, minPlan: 'pro', rateFactor: 0.4, isActive: true, sortOrder: 5 }),
  Object.freeze({ code: 'zuri-elite', name: 'Zuri Elite', supplier: 'anthropic', supplierModel: 'claude-opus-5-5', kind: 'text', usdPerImage: 0, quotaTokensPerImage: 0, inputUsdPerMillion: 4, outputUsdPerMillion: 20, quotaWeight: 20, outputQuotaWeight: 60, minPlan: 'max', rateFactor: 0.2, isActive: true, sortOrder: 6 }),
  Object.freeze({ code: 'zuri-sketch', name: 'Zuri Sketch', supplier: 'zai', supplierModel: 'cogview-4', kind: 'image', usdPerImage: 0.012, quotaTokensPerImage: 48000, imageQuality: 'standard', minPlan: 'starter', rateFactor: 0.4, quotaWeight: 1, outputQuotaWeight: 0, inputUsdPerMillion: 0, outputUsdPerMillion: 0, isActive: true, sortOrder: 7 }),
  Object.freeze({ code: 'zuri-canvas', name: 'Zuri Canvas', supplier: 'openai', supplierModel: 'gpt-image-2', kind: 'image', usdPerImage: 0.07, quotaTokensPerImage: 264000, imageQuality: 'medium', minPlan: 'pro', rateFactor: 0.3, quotaWeight: 1, outputQuotaWeight: 0, inputUsdPerMillion: 0, outputUsdPerMillion: 0, isActive: true, sortOrder: 8 }),
  Object.freeze({ code: 'zuri-studio', name: 'Zuri Studio', supplier: 'openai', supplierModel: 'gpt-image-2', kind: 'image', usdPerImage: 0.19, quotaTokensPerImage: 720000, imageQuality: 'high', minPlan: 'max', rateFactor: 0.2, quotaWeight: 1, outputQuotaWeight: 0, inputUsdPerMillion: 0, outputUsdPerMillion: 0, isActive: true, sortOrder: 9 }),
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

/**
 * The weight the reply is charged at: its own when one is set, otherwise the
 * prompt's, which is how every model was billed before the two were split.
 * @param {{ quotaWeight?: number, outputQuotaWeight?: number }} model
 */
export function outputWeightFor(model) {
  const stated = Number(model?.outputQuotaWeight);
  if (Number.isFinite(stated) && stated > 0) return stated;
  return Math.max(0, Number(model?.quotaWeight) || 1);
}

/**
 * Quota tokens a request uses: a dearer model burns the monthly allowance faster.
 * The prompt and the reply are counted with their own weights, so a long reply
 * costs the allowance what it costs us.
 */
export function quotaTokens(model, inputTokens, outputTokens) {
  const inputWeight = Math.max(0, Number(model?.quotaWeight) || 1);
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return Math.ceil(input * inputWeight + output * outputWeightFor(model));
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

/** An image model bills per picture, so every caller must know which meter applies. */
export function isImageModel(model) {
  return typeof model?.kind === 'string' && model.kind.trim().toLowerCase() === 'image';
}

/** What the supplier charges for one picture, in micro-dollars. */
export function imageSupplierCostMicroUsd(model) {
  const usdPerImage = Number(model?.usdPerImage) || 0;
  // Trimmed before rounding up for the same reason supplierCostMicroUsd does it:
  // 0.07 * 1e6 is 70000.00000000001 in floating point, which would bill 70001.
  return Math.ceil(Number((Math.max(0, usdPerImage) * 1_000_000).toFixed(6)));
}

/**
 * The plan's own naira rate for a million quota tokens. Deriving it from the plan
 * (rather than a fixed price list) keeps image prices in step with plan pricing.
 * @param {{ amountKobo?: number, monthlyTokens?: number }} plan
 */
export function koboPerMillionQuotaTokens(plan) {
  const amountKobo = Number(plan?.amountKobo);
  const monthlyTokens = Number(plan?.monthlyTokens);
  if (!Number.isFinite(amountKobo) || amountKobo < 0) return 0;
  // Without an allowance there is no rate to divide by, and a silent Infinity
  // would price every picture at nothing.
  if (!Number.isFinite(monthlyTokens) || monthlyTokens <= 0) return 0;
  return amountKobo / (monthlyTokens / 1_000_000);
}

/** What one picture costs the customer on this plan, in whole kobo. */
export function imagePriceKobo(model, plan) {
  const perImage = Number(model?.quotaTokensPerImage);
  if (!Number.isFinite(perImage) || perImage <= 0) return 0;
  return Math.round((perImage / 1_000_000) * koboPerMillionQuotaTokens(plan));
}

/** How many pictures the plan's whole allowance buys; 0 when the model is not billed per image. */
export function imagesPerMonth(model, plan) {
  if (!isImageModel(model)) return 0;
  const perImage = Number(model?.quotaTokensPerImage);
  const monthlyTokens = Number(plan?.monthlyTokens);
  if (!Number.isFinite(perImage) || perImage <= 0) return 0;
  if (!Number.isFinite(monthlyTokens) || monthlyTokens <= 0) return 0;
  return Math.floor(monthlyTokens / perImage);
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
    kind: isImageModel(model) ? 'image' : 'text',
    minPlan: model.minPlan,
    quotaWeight: model.quotaWeight,
    outputQuotaWeight: outputWeightFor(model),
    quotaTokensPerImage: Number(model.quotaTokensPerImage) || 0,
    available: canUseModel(model, planCode),
  };
}

/**
 * The public view of an image model: what one picture costs and how many the
 * allowance buys, per plan, with nothing that names the supplier.
 * @param {object} model
 * @param {Array<{ code: string, amountKobo: number, monthlyTokens: number }>} plans
 */
export function publicImageModel(model, plans) {
  const ladder = Array.isArray(plans) ? plans : [];
  return {
    code: model.code,
    name: model.name,
    kind: 'image',
    minPlan: model.minPlan,
    quotaTokensPerImage: Number(model.quotaTokensPerImage) || 0,
    plans: ladder.map((plan) => ({
      code: plan.code,
      priceKobo: imagePriceKobo(model, plan),
      images: imagesPerMonth(model, plan),
    })),
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

  // A blank kind means the dashboard left the field out, which is a text model;
  // anything else must name a kind we can bill for.
  const rawKind = typeof input.kind === 'string' ? input.kind.trim().toLowerCase() : '';
  const kind = rawKind === '' ? 'text' : rawKind;
  if (!MODEL_KINDS.includes(kind)) return { ok: false, message: `The model kind must be one of ${MODEL_KINDS.join(', ')}.` };
  const imageQuality = typeof input.imageQuality === 'string' ? input.imageQuality.trim() : '';
  if (imageQuality.length > 20) return { ok: false, message: 'The image quality label can be up to 20 characters.' };

  const inputUsd = Number(input.inputUsdPerMillion);
  const outputUsd = Number(input.outputUsdPerMillion);
  if (![inputUsd, outputUsd].every((value) => Number.isFinite(value) && value >= 0 && value <= 1000)) {
    return { ok: false, message: 'Prices must be between 0 and 1000 dollars per million tokens.' };
  }
  let usdPerImage = 0;
  let quotaTokensPerImage = 0;
  if (kind === 'image') {
    usdPerImage = Number(input.usdPerImage);
    if (!Number.isFinite(usdPerImage) || usdPerImage < 0 || usdPerImage > 100) {
      return { ok: false, message: 'The price per image must be between 0 and 100 dollars.' };
    }
    quotaTokensPerImage = Number(input.quotaTokensPerImage);
    if (!Number.isInteger(quotaTokensPerImage) || quotaTokensPerImage < 1000 || quotaTokensPerImage > 4_000_000) {
      return { ok: false, message: 'The quota tokens per image must be a whole number between 1000 and 4000000.' };
    }
  }
  const quotaWeight = Number(input.quotaWeight);
  if (!Number.isFinite(quotaWeight) || quotaWeight < 0.1 || quotaWeight > 100) {
    return { ok: false, message: 'The quota weight must be between 0.1 and 100.' };
  }
  // Blank or 0 means "charge replies at the prompt's weight", which is what a
  // dashboard that predates this field sends and what an image model wants.
  const rawOutputWeight = input.outputQuotaWeight;
  const outputQuotaWeight = rawOutputWeight === undefined || rawOutputWeight === null || rawOutputWeight === ''
    ? 0
    : Number(rawOutputWeight);
  if (!Number.isFinite(outputQuotaWeight) || (outputQuotaWeight !== 0 && (outputQuotaWeight < 0.1 || outputQuotaWeight > 100))) {
    return { ok: false, message: 'The reply weight must be 0 (same as prompts) or between 0.1 and 100.' };
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
      kind,
      imageQuality,
      // Forced to zero for text models: a per-image price on a text model would
      // bill the same request twice.
      usdPerImage,
      quotaTokensPerImage,
      inputUsdPerMillion: inputUsd,
      outputUsdPerMillion: outputUsd,
      quotaWeight,
      outputQuotaWeight,
      minPlan: input.minPlan,
      rateFactor,
      isActive: input.isActive !== false,
      sortOrder,
    },
  };
}
