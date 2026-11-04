/**
 * The prompt enhancer: rewrite a rough message into the prompt a model can answer
 * accurately, without changing what the person wants.
 *
 * Unlike the picture improver in images.js, a failure here is reported: the person
 * pressed a button and is waiting for a better prompt, so silently handing back their
 * own words would look like the button did nothing.
 */

export const MAX_PROMPT_LENGTH = 4000;
// Longer than a prompt should need. The reply is one rewritten message, and this
// ceiling stops a chatty model from turning one sentence into an essay.
const MAX_ENHANCED_LENGTH = 4000;

/**
 * What the enhancer is asked to do. Written as rules rather than as an example so it
 * keeps working for any kind of request, and so it never invents facts: an unknown
 * detail becomes a bracketed placeholder the person can fill in.
 */
export const ENHANCER_GUIDE = [
  'You rewrite a person\'s rough message into the prompt that gets them the answer they actually want.',
  'Rules:',
  '- Keep the meaning exactly. Never answer the request, never carry it out, never add a preface or a closing line.',
  '- Keep every name, number, date, amount, link, place and constraint the person gave, spelled the same way.',
  '- Make the ask specific: say what the goal is, who it is for, what the result should look like (list, table, email, code, short answer), how long it should be, and any tone or deadline that follows from the message.',
  '- When the message has several parts, keep each one as its own clearly separated requirement.',
  '- If something is genuinely needed and missing, mark it with a short bracketed placeholder such as [date], so the person can fill it in. Never guess it.',
  '- Keep the person\'s own language, and their own words where they already say it well.',
  '- Use plain hyphens, no em dashes, no emojis, no decorative unicode, no quotation marks around the whole reply.',
  'Reply with the rewritten prompt and nothing else.',
].join('\n');

function enhancerFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Drop the wrappers a model likes to add around a rewritten prompt: a fenced block,
 * or one matching pair of straight or curly quotes.
 * @param {string} text
 * @returns {string}
 */
function unwrap(text) {
  let value = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(value);
  if (fenced) value = fenced[1].trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  if (quoted && quoted[2].trim() !== '') value = quoted[2].trim();
  return value;
}

/**
 * @param {{ chatProvider: Function, prompt: string }} input
 * @returns {Promise<string>} the rewritten prompt
 */
export async function enhancePrompt({ chatProvider, prompt }) {
  if (typeof chatProvider !== 'function') {
    throw enhancerFailure('The prompt enhancer is not switched on yet.', 'ENHANCER_NOT_CONFIGURED');
  }

  let result;
  try {
    result = await chatProvider({
      // The cheapest text model in the house: rewriting a sentence is not a job that
      // needs the model that answers the chat.
      supplier: 'deepseek',
      model: 'deepseek-flash',
      maxTokens: 900,
      signal: AbortSignal.timeout(20_000),
      messages: [
        { role: 'system', content: ENHANCER_GUIDE },
        { role: 'user', content: prompt },
      ],
    });
  } catch (error) {
    console.error('[zuri-cloud] prompt enhancer', error?.code ?? '', error?.message ?? error);
    throw enhancerFailure('The prompt could not be improved right now. Try again.', 'PROVIDER_REQUEST_FAILED');
  }

  const improved = unwrap(typeof result?.content === 'string' ? result.content : '');
  if (improved === '') {
    throw enhancerFailure('The enhancer sent back nothing. Try again, or reword your message yourself.', 'ENHANCER_EMPTY');
  }
  if (improved.length > MAX_ENHANCED_LENGTH) {
    throw enhancerFailure(`The improved prompt came back too long. Keep your message under ${MAX_PROMPT_LENGTH} characters.`, 'ENHANCER_TOO_LONG');
  }
  return improved;
}
