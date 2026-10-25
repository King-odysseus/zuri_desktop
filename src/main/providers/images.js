/**
 * providers/images.js - the one place Zuri asks an image API for a picture.
 *
 * It mirrors providers/chat.js: the key is read here and never leaves the main
 * process, every failure comes back as the { ok, error } shape the renderer
 * branches on, and a raw exception never escapes. Two things are deliberately
 * not here: the workspace and the file system. Storing the bytes is a `save`
 * function the caller injects, the same way the tool layer takes `summarize` as
 * a dependency in main.js, so this module can be checked without an app object.
 *
 * The three names below are Zuri's own picture ladder, not raw supplier models:
 * a person picks a name and a price, and the supplier and its quality setting
 * stay an implementation detail. They are kept in step with the server
 * catalogue (server/src/models.js) so desktop and web quote the same names.
 */

import { getKey } from '../secrets.js';

// Picture generation is far slower than a chat reply, so the timeout is generous.
const REQUEST_TIMEOUT_MS = 180_000;
// A 1024x1024 PNG is around 2 MB; 12 MB is a ceiling that still stops a runaway
// supplier from filling the workspace or the IPC channel with one reply.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
// Image prompts are billed per call, and very long ones are not honoured better
// than a clear sentence: capped so a pasted document cannot be sent by accident.
const MAX_PROMPT_LENGTH = 2000;

/**
 * Where each supplier's picture endpoint lives. Only the providers that sell
 * pictures appear here, so a model entry naming anything else fails before a
 * request goes out.
 */
const SUPPLIERS = Object.freeze({
  openai: Object.freeze({ label: 'OpenAI', endpoint: 'https://api.openai.com/v1/images/generations' }),
  zai: Object.freeze({ label: 'Z.ai', endpoint: 'https://api.z.ai/api/paas/v4/images/generations' }),
});

/**
 * The picture models Zuri offers, lowest tier first so a menu built straight
 * from this array reads cheapest first. `hint` is the one line the menu shows
 * under a name; `minPlan` is the web plan that includes it, kept here so the
 * desktop can say "Max plan" without asking the server.
 * @type {ReadonlyArray<{ code: string, name: string, provider: string, model: string, quality: string, size: string, quotaTokens: number, nairaPerImage: number, minPlan: string, hint: string }>}
 */
export const IMAGE_MODELS = Object.freeze([
  Object.freeze({
    code: 'zuri-sketch',
    name: 'Zuri Sketch',
    provider: 'zai',
    model: 'cogview-4',
    quality: 'standard',
    size: '1024x1024',
    quotaTokens: 48_000,
    nairaPerImage: 60,
    minPlan: 'starter',
    hint: 'Fast drafts, cheapest',
  }),
  Object.freeze({
    code: 'zuri-canvas',
    name: 'Zuri Canvas',
    provider: 'openai',
    model: 'gpt-image-2',
    quality: 'medium',
    size: '1024x1024',
    quotaTokens: 264_000,
    nairaPerImage: 330,
    minPlan: 'pro',
    hint: 'Balanced, the everyday choice',
  }),
  Object.freeze({
    code: 'zuri-studio',
    name: 'Zuri Studio',
    provider: 'openai',
    model: 'gpt-image-2',
    quality: 'high',
    size: '1024x1024',
    quotaTokens: 720_000,
    nairaPerImage: 900,
    minPlan: 'max',
    hint: 'Highest detail, Max plan',
  }),
]);

// IMAGE_MODELS runs lowest tier first, so its reverse is the preference order the
// default follows. Derived rather than written twice: one list cannot drift.
const BEST_FIRST = Object.freeze(IMAGE_MODELS.map((entry) => entry.code).reverse());

/** The MIME type the preview data URL declares, per saved extension. */
const PREVIEW_MIME = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' });

/**
 * Build the standard failure shape the store and secrets modules use, so the
 * renderer only ever branches on `ok`.
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * The picture models a person can actually use, given the providers they have
 * saved a key for. The menu builds from this, so it never offers a name that
 * would answer IMAGE_NO_KEY the moment it was picked.
 * @param {string[]} [availableProviders] Provider names with a key saved.
 * @returns {Array<typeof IMAGE_MODELS[number]>}
 */
export function imageModelsFor(availableProviders) {
  const available = Array.isArray(availableProviders) ? availableProviders : [];
  return IMAGE_MODELS.filter((entry) => available.includes(entry.provider));
}

/**
 * The best model the person can use right now: Studio, then Canvas, then Sketch.
 * Null when no image provider has a key, which the caller shows as "add a key"
 * rather than as a broken default.
 * @param {string[]} [availableProviders] Provider names with a key saved.
 * @returns {typeof IMAGE_MODELS[number] | null}
 */
export function defaultImageModel(availableProviders) {
  const usable = imageModelsFor(availableProviders);
  for (const code of BEST_FIRST) {
    const model = usable.find((entry) => entry.code === code);
    if (model) return model;
  }
  return null;
}

/**
 * Ask a supplier for one picture and hand the bytes to `save`.
 *
 * Every path returns the { ok } shape: a missing prompt, an unknown model, a
 * missing key, a supplier error, an empty reply, an oversized image. The `save`
 * function owns the file system, and its own failure is returned unchanged so a
 * workspace refusal keeps its TOOL_ code.
 * @param {{ prompt?: string, modelCode?: string, providers?: string[], save?: (bytes: Buffer, extension: string) => Promise<object> }} [request]
 * @returns {Promise<{ ok: true, data: { model: { code: string, name: string }, image: any, previewUrl: string, nairaPerImage: number } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function generateImage({ prompt, modelCode, providers, save } = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text === '') {
    return failure('IMAGE_PROMPT_REQUIRED', 'Describe the picture you want first.');
  }
  if (text.length > MAX_PROMPT_LENGTH) {
    return failure('IMAGE_PROMPT_REQUIRED', `Keep the picture description to ${MAX_PROMPT_LENGTH} characters or fewer.`);
  }

  // Fail before spending a request: the bytes have to be stored somewhere and this
  // module has no idea where. A missing save is a wiring mistake, not a user input.
  if (typeof save !== 'function') {
    return failure('IMAGE_SAVE_FAILED', 'The picture could not be stored because no save step was supplied.');
  }

  const requested = typeof modelCode === 'string' ? modelCode.trim() : '';
  const model = requested === '' ? defaultImageModel(providers) : IMAGE_MODELS.find((entry) => entry.code === requested);
  if (!model) {
    // No code asked for resolves to the default, and the default is null for one
    // reason only: no image provider has a key saved. That is a missing key, not a
    // wrong name, so it gets its own wording and code.
    if (requested === '') {
      return failure('IMAGE_NO_KEY', 'Add an OpenAI or a Z.ai key in Settings to generate pictures.');
    }
    return failure('IMAGE_UNKNOWN_MODEL', `"${requested}" is not a picture model Zuri offers.`);
  }

  const supplier = SUPPLIERS[model.provider];
  if (!supplier) {
    // Unreachable with the catalogue above, but a mistyped provider in a model entry
    // must fail here rather than reach fetch with an undefined endpoint.
    return failure('IMAGE_UNKNOWN_MODEL', `${model.name} names a picture service Zuri does not call.`);
  }

  let key = null;
  try {
    key = getKey(model.provider);
  } catch {
    // A key store that cannot be read is the same dead end as no key at all, and
    // both are fixed from Settings. Letting this throw would surface as a picture
    // failure with no next step in it.
    return failure('IMAGE_NO_KEY', 'Zuri could not read your ' + supplier.label + ' key. Open Settings and save it again.');
  }
  if (key === null) {
    return failure('IMAGE_NO_KEY', `Add your ${supplier.label} key in Settings to use ${model.name}.`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  /** @type {Buffer | undefined} */
  let bytes;
  try {
    const response = await fetch(supplier.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The key rides in the header only: it never goes into the body, a URL or a log.
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody(model, text)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await supplierMessage(response);
      return failure(
        'IMAGE_PROVIDER_FAILED',
        detail === ''
          ? `${supplier.label} could not make that picture (HTTP ${response.status}). Try again.`
          : `${supplier.label} could not make that picture: ${detail}`,
      );
    }

    const body = await readJson(response);
    if (body === null) {
      return failure('IMAGE_PROVIDER_FAILED', `${supplier.label} answered with something Zuri could not read. Try again.`);
    }

    const first = Array.isArray(body?.data) ? body.data[0] : undefined;
    const encoded = typeof first?.b64_json === 'string' ? first.b64_json : '';
    const link = typeof first?.url === 'string' ? first.url : '';

    if (encoded !== '') {
      bytes = Buffer.from(encoded, 'base64');
    } else if (link !== '') {
      // The second reply shape is a link that expires, so the bytes are taken now:
      // a saved file must not stop opening because the URL aged out.
      const download = await fetch(link, { signal: controller.signal });
      if (!download.ok) {
        return failure('IMAGE_PROVIDER_FAILED', `${supplier.label} sent a picture link that could not be downloaded (HTTP ${download.status}).`);
      }
      bytes = Buffer.from(await download.arrayBuffer());
    }
  } catch (error) {
    // Abort is the timeout firing (a controller abort reports AbortError, a native
    // timeout reports TimeoutError); anything else is the network. Both are worth a
    // retry, so both get a plain message rather than a stack trace.
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      return failure('IMAGE_PROVIDER_FAILED', `${supplier.label} did not send the picture in time. Try again.`);
    }
    return failure('IMAGE_PROVIDER_FAILED', `Could not reach ${supplier.label}. Check your connection and try again.`);
  } finally {
    clearTimeout(timeout);
  }

  if (bytes === undefined || bytes.length === 0) {
    return failure('IMAGE_EMPTY', `${supplier.label} answered without a picture. Try a different description.`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    return failure(
      'IMAGE_TOO_LARGE',
      `That picture came back at ${Math.round(bytes.length / (1024 * 1024))} MB, which is over the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB limit.`,
    );
  }

  const extension = extensionOf(bytes);

  let stored;
  try {
    stored = await save(bytes, extension);
  } catch (error) {
    // save is main-process code, so this is a file-system fault it did not catch.
    return failure('IMAGE_SAVE_FAILED', String(error?.message ?? error));
  }
  // The caller's own refusal already carries its code and wording; pass it through,
  // but a save that answered nothing still has to come back as a shape to show.
  if (stored?.ok !== true) return stored ?? failure('IMAGE_SAVE_FAILED', 'The picture was not saved.');

  return {
    ok: true,
    data: {
      model: { code: model.code, name: model.name },
      image: stored.data,
      // The renderer shows the picture from memory: the workspace file may be outside
      // the renderer's reach, and a data URL needs no file protocol allowance.
      previewUrl: `data:${PREVIEW_MIME[extension] ?? 'image/png'};base64,${bytes.toString('base64')}`,
      nairaPerImage: model.nairaPerImage,
    },
  };
}

/**
 * The JSON body for one supplier. Each supplier takes its own subset: Z.ai's
 * CogView endpoint rejects a quality field it does not know, and only OpenAI
 * can promise base64 instead of a link.
 * @param {typeof IMAGE_MODELS[number]} model
 * @param {string} prompt
 * @returns {Record<string, unknown>}
 */
function requestBody(model, prompt) {
  if (model.provider === 'openai') {
    return {
      model: model.model,
      prompt,
      n: 1,
      size: model.size,
      quality: model.quality,
      response_format: 'b64_json',
    };
  }
  return { model: model.model, prompt, size: model.size };
}

/**
 * The supplier's own complaint, when there is one, cut to something that fits in
 * a reply. A body that cannot be read simply has no detail to add.
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function supplierMessage(response) {
  const body = await response.text().catch(() => '');
  if (body === '') return '';
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message ?? parsed?.message ?? '';
    return typeof message === 'string' ? message.trim().slice(0, 300) : '';
  } catch {
    // Not JSON: some suppliers answer a bad key with a plain text or HTML page.
    return body.trim().slice(0, 300);
  }
}

/**
 * Parse a supplier's success body, keeping "not JSON" distinct from "no picture":
 * only the caller knows which message helps.
 * @param {Response} response
 * @returns {Promise<any | null>}
 */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    // A body that is not JSON is not a second failure: the caller turns null into
    // "answered with something Zuri could not read", which is the actionable line.
    return null;
  }
}

/**
 * The file suffix for these bytes, read from the bytes rather than the URL: both
 * suppliers hand back a link with no extension in it, and a PNG saved as .jpg
 * does not open in every viewer. Anything unrecognised is treated as PNG, which
 * is what both suppliers return most of the time.
 * @param {Buffer} bytes
 * @returns {'png' | 'jpg' | 'webp'}
 */
function extensionOf(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'png';
}
