/**
 * Picture suppliers behind one small function, and the prompt improver.
 *
 * Nothing here writes to disk or to a database. A picture is made, handed back
 * to the app once as base64, and forgotten: the person's own device is the only
 * place a picture is kept, the way a private image library should work.
 */

const REQUEST_TIMEOUT_MS = 180_000;
// A 1024 PNG is about 2 MB; this ceiling stops a runaway supplier from filling the reply.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** The shapes a person can ask for, mapped to each supplier's own size strings. */
export const IMAGE_SHAPES = Object.freeze({
  square: Object.freeze({ openai: '1024x1024', zai: '1024x1024' }),
  portrait: Object.freeze({ openai: '1024x1536', zai: '768x1344' }),
  landscape: Object.freeze({ openai: '1536x1024', zai: '1344x768' }),
});

export const MAX_IMAGE_PROMPT_LENGTH = 2000;

function failure(message) {
  const error = new Error(message);
  error.code = 'PROVIDER_REQUEST_FAILED';
  return error;
}

function invalidReply() {
  const error = new Error('The picture supplier sent no picture.');
  error.code = 'PROVIDER_RESPONSE_INVALID';
  return error;
}

/**
 * @param {{ openaiApiKey?: string, zaiApiKey?: string, fetchImpl?: typeof fetch }} keys
 * @returns {(request: { supplier: string, supplierModel: string, quality: string, shape: string, prompt: string, signal?: AbortSignal }) => Promise<{ mime: string, base64: string }>}
 */
export function createImageClient({ openaiApiKey = '', zaiApiKey = '', fetchImpl = globalThis.fetch } = {}) {
  return async function makeImage({ supplier, supplierModel, quality, shape, prompt, signal }) {
    const sizes = IMAGE_SHAPES[shape] ?? IMAGE_SHAPES.square;
    const combined = AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);

    if (supplier === 'openai') {
      if (openaiApiKey === '') throw failure('This picture model is not switched on yet.');
      const reply = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { authorization: `Bearer ${openaiApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: supplierModel, prompt, size: sizes.openai, quality, n: 1 }),
        signal: combined,
      });
      if (!reply.ok) throw failure('The picture could not be made. Try again.');
      const body = await reply.json();
      const base64 = body?.data?.[0]?.b64_json;
      if (typeof base64 !== 'string' || base64 === '') throw invalidReply();
      return { mime: 'image/png', base64 };
    }

    if (supplier === 'zai') {
      if (zaiApiKey === '') throw failure('This picture model is not switched on yet.');
      const reply = await fetchImpl('https://api.z.ai/api/paas/v4/images/generations', {
        method: 'POST',
        headers: { authorization: `Bearer ${zaiApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: supplierModel, prompt, size: sizes.zai, quality }),
        signal: combined,
      });
      if (!reply.ok) throw failure('The picture could not be made. Try again.');
      const body = await reply.json();
      const address = body?.data?.[0]?.url;
      if (typeof address !== 'string' || !address.startsWith('https://')) throw invalidReply();
      // The supplier hosts the file briefly; fetching it here means the app never
      // has to trust or keep a supplier link.
      const file = await fetchImpl(address, { signal: combined });
      if (!file.ok) throw failure('The picture could not be fetched. Try again.');
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) throw failure('The picture was empty or too large.');
      const type = file.headers.get('content-type') ?? '';
      return { mime: /^image\/(png|jpeg|webp)$/.test(type) ? type : 'image/png', base64: bytes.toString('base64') };
    }

    throw failure('This picture model is not switched on yet.');
  };
}

/** Prompt advice per image supplier: CogView likes short, gpt-image likes detailed. */
export const PROMPT_GUIDES = Object.freeze({
  zai: 'Rewrite the request as one short, concrete prompt of at most 40 words: subject, setting, style, lighting. No lists.',
  openai: 'Rewrite the request as a detailed prompt of 60 to 120 words: subject, setting, composition, camera or art style, lighting, colour palette and mood. State any text that must appear inside the picture exactly, in quotes.',
});

/**
 * Ask a cheap chat model to rewrite a picture request for the chosen supplier.
 * Any failure returns the person's own words, so a picture is never blocked by
 * the improver.
 * @param {{ chatProvider: Function, prompt: string, supplier: string }} input
 * @returns {Promise<string>}
 */
export async function improveImagePrompt({ chatProvider, prompt, supplier }) {
  const guide = PROMPT_GUIDES[supplier];
  if (!guide || typeof chatProvider !== 'function') return prompt;
  try {
    const result = await chatProvider({
      supplier: 'deepseek',
      model: 'deepseek-flash',
      maxTokens: 300,
      signal: AbortSignal.timeout(20_000),
      messages: [
        { role: 'system', content: `You write prompts for an AI picture maker. ${guide} Keep the meaning and any names or text the person gave. Reply with the prompt only, no preface, no quotes around it, and only plain hyphens.` },
        { role: 'user', content: prompt },
      ],
    });
    const improved = typeof result?.content === 'string' ? result.content.trim() : '';
    if (improved === '' || improved.length > MAX_IMAGE_PROMPT_LENGTH) return prompt;
    return improved;
  } catch (error) {
    console.error('[zuri-cloud] prompt improver', error?.message ?? error);
    return prompt;
  }
}
