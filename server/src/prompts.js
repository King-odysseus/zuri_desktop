/**
 * The prompt enhancer: rewrite a rough message into the prompt a model can answer
 * accurately, without changing what the person wants.
 *
 * Two things are asked for, and both are kept apart from the answer the person is
 * about to ask for: the rewritten message, and a short list of details they could
 * add to it. The reply is read as two named blocks rather than as free text, so a
 * model that answers the message instead of editing it cannot have that answer
 * dropped into the message box. A reply without the blocks is asked for once more,
 * then refused.
 *
 * Unlike the picture improver in images.js, a failure here is reported: the person
 * pressed a button and is waiting for a better prompt, so silently handing back their
 * own words would look like the button did nothing.
 */

export const MAX_PROMPT_LENGTH = 4000;
// Longer than a prompt should need. The reply is one rewritten message plus a few
// short suggestions, and this ceiling stops a chatty model from turning one sentence
// into an essay.
const MAX_ENHANCED_LENGTH = 4000;
// A suggestion the person is meant to read and add in one press, not a paragraph.
const MAX_SUGGESTION_LENGTH = 160;
// Three is enough to cover the usual gaps (who it is for, by when, what it should
// look like) without turning the composer into a form.
const MAX_SUGGESTIONS = 3;

/**
 * What the enhancer is asked to do.
 *
 * The opening line settles the one question a small model gets wrong here: it is an
 * editor, not the assistant. Every rule after it exists because the model drifted in
 * a way a person can see: answering the message, wrapping the ask in "please help me
 * with", or inventing a length and an audience the person never gave. Anything
 * unknown belongs in the suggestions, never guessed into the prompt.
 */
export const ENHANCER_GUIDE = [
  'You edit a person\'s rough message into the prompt that gets them a better answer. You are the editor, not the assistant: the person will send your text somewhere else, so none of the answer may appear in your reply.',
  '',
  'Writing the rewritten prompt:',
  '- Never answer the message. If it asks for a plan, an example, a draft, code, a calculation or advice, none of that is yours to write. You only improve the words of the ask.',
  '- Start with the task itself. No preface such as "Please help me with the following", and do not speak to an assistant on the person\'s behalf.',
  '- Keep the meaning exactly. Keep every name, number, date, amount, link, place and constraint the person gave, spelled the same way.',
  '- Make the ask specific using only what the person told you, or what plainly follows from it.',
  '- Never invent a length, format, tone, audience, deadline, number of examples or any other detail they did not give. A detail they left out is a suggestion, not text in the prompt.',
  '- If something essential is missing and the message cannot stand without it, mark it with a short bracketed placeholder such as [date] or [audience]. Never guess it.',
  '- Keep the person\'s own language, and their own words where they already say it well. Do not make it much longer than their message.',
  '- Keep each requirement on its own line when the message has several.',
  '- Plain hyphens only. No em dashes, no emojis, no decorative unicode, no quotation marks around the whole reply.',
  '',
  'Writing the suggestions:',
  '- Each one is a short line the person could add to the prompt, written the way it would read inside the prompt, for example "Audience: small business owners who track spending weekly." or "Show a chart of spend by month."',
  '- Name only what the message leaves open: who it is for, a deadline, the length or format, the tone, the data or source to use, an example to follow.',
  '- Never repeat what the prompt already says, never explain how to write well, and never put any part of an answer here.',
  '- Two or three lines. If the message is already clear, leave the suggestions part empty.',
  '',
  'Reply in exactly this shape, with nothing before PROMPT and nothing after the last suggestion:',
  'PROMPT:',
  '<the rewritten message the person will send>',
  'SUGGESTIONS:',
  '- <something they could add>',
  '- <something else they could add>',
].join('\n');

/**
 * The second attempt, sent only when the first reply had no blocks at all.
 *
 * A model that answered the message usually ignored the shape as well, so this names
 * the mistake it made and repeats the frame in as few words as possible.
 */
const SHAPE_REMINDER = [
  'That reply was not in the required shape. Do not answer the message and do not explain anything.',
  'Send it back as exactly these two blocks and nothing else, with the message rewritten in the first and the additions in the second:',
  'PROMPT:',
  '<the rewritten message>',
  'SUGGESTIONS:',
  '- <something they could add>',
].join('\n');

// A line that opens a block: the word, optionally emphasized or after a heading
// marker, then either a colon with the rest of the line, or nothing else. Plain prose
// such as "Prompt the model to ..." is not a marker, so it stays text.
const MARKER_LINE = /^(prompt|suggestions?)\s*(?::\s*(.*)|\s*)$/i;
// A bullet the model put in front of a suggestion.
const BULLET = /^(?:[-*+]\s+|\d+[.)]\s+)/;

/**
 * The block a line opens, or null when the line is ordinary text.
 * @param {string} line
 * @returns {{ section: 'prompt' | 'suggestions', rest: string } | null}
 */
function readMarker(line) {
  const cleaned = line
    .trim()
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*|__/g, '');
  const marker = MARKER_LINE.exec(cleaned.trim());
  if (!marker) return null;
  return {
    section: marker[1].toLowerCase().startsWith('suggestion') ? 'suggestions' : 'prompt',
    rest: (marker[2] ?? '').trim(),
  };
}

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
  const quoted = /^["'“”‘’]([\s\S]*)["'“”‘’]$/.exec(value);
  if (quoted && quoted[1].trim() !== '') value = quoted[1].trim();
  return value;
}

/**
 * Read the suggestion lines into a short list of additions.
 *
 * Anything the model wrote as prose is kept only if it looks like one line to add:
 * bullets and numbers are stripped, a repeated line is dropped, and the list stops at
 * three so the composer does not fill with advice.
 * @param {string[]} lines
 * @returns {string[]}
 */
function readSuggestions(lines) {
  const suggestions = [];
  const seen = new Set();
  for (const raw of lines) {
    let line = unwrap(raw.trim().replace(BULLET, ''));
    if (line.length < 4) continue;
    if (line.length > MAX_SUGGESTION_LENGTH) line = `${line.slice(0, MAX_SUGGESTION_LENGTH - 3).trimEnd()}...`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(line);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

/**
 * Split a reply into the rewritten prompt and the suggestions.
 *
 * Text before the first marker is dropped on purpose: a model that opens with "Sure,
 * here is a clearer prompt" or with its own answer, then repeats itself inside the
 * blocks, must not have the opening glued onto the message the person sends.
 * @param {string} content
 * @returns {{ shaped: boolean, prompt: string, suggestions: string[] }}
 */
export function readEnhancerReply(content) {
  const lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const promptLines = [];
  const suggestionLines = [];
  let section = '';
  let shaped = false;
  for (const line of lines) {
    const marker = readMarker(line);
    if (marker) {
      if (marker.section === 'suggestions') {
        section = 'suggestions';
        if (marker.rest !== '') suggestionLines.push(marker.rest);
      } else {
        section = 'prompt';
        shaped = true;
        if (marker.rest !== '') promptLines.push(marker.rest);
      }
      continue;
    }
    if (section === 'prompt') promptLines.push(line);
    else if (section === 'suggestions') suggestionLines.push(line);
  }
  return {
    shaped,
    prompt: unwrap(promptLines.join('\n')),
    suggestions: readSuggestions(suggestionLines),
  };
}

/**
 * @param {{ chatProvider: Function, prompt: string }} input
 * @returns {Promise<{ prompt: string, suggestions: string[] }>} the rewrite, and what
 *   the person could add to it
 */
export async function enhancePrompt({ chatProvider, prompt }) {
  if (typeof chatProvider !== 'function') {
    throw enhancerFailure('The prompt enhancer is not switched on yet.', 'ENHANCER_NOT_CONFIGURED');
  }

  // The cheapest text model in the house: rewriting a sentence is not a job that
  // needs the model that answers the chat. A second try is only paid for when the
  // first reply could not be read, so the ordinary press is still one call.
  const ask = async (content) => {
    try {
      return await chatProvider({
        supplier: 'deepseek',
        model: 'deepseek-flash',
        maxTokens: 900,
        signal: AbortSignal.timeout(20_000),
        messages: [
          { role: 'system', content: ENHANCER_GUIDE },
          { role: 'user', content },
        ],
      });
    } catch (error) {
      console.error('[zuri-cloud] prompt enhancer', error?.code ?? '', error?.message ?? error);
      throw enhancerFailure('The prompt could not be improved right now. Try again.', 'PROVIDER_REQUEST_FAILED');
    }
  };

  const first = await ask(prompt);
  const said = typeof first?.content === 'string' ? first.content.trim() : '';
  if (said === '') {
    throw enhancerFailure('The enhancer sent back nothing. Try again, or reword your message yourself.', 'ENHANCER_EMPTY');
  }

  let read = readEnhancerReply(said);
  if (!read.shaped || read.prompt === '') {
    const second = await ask(`${prompt}\n\n${SHAPE_REMINDER}`);
    read = readEnhancerReply(typeof second?.content === 'string' ? second.content : '');
  }

  // No prompt block means the reply was not an edit of the message, whatever it said,
  // so it is refused rather than shown. An answer must never reach the message box.
  if (!read.shaped || read.prompt === '') {
    throw enhancerFailure('The enhancer did not send back a usable prompt. Try again, or reword your message yourself.', 'ENHANCER_FORMAT');
  }
  if (read.prompt.length > MAX_ENHANCED_LENGTH) {
    throw enhancerFailure(`The improved prompt came back too long. Keep your message under ${MAX_PROMPT_LENGTH} characters.`, 'ENHANCER_TOO_LONG');
  }
  return { prompt: read.prompt, suggestions: read.suggestions };
}
