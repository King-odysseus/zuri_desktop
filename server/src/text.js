/*
 * The house style for reply text, kept in one place so every supplier is held to
 * the same rules. Two things live here:
 *
 * 1. The instruction sent with every conversation, so the model writes plain
 *    hyphens instead of em dashes in the first place.
 * 2. A rewrite that removes a dash which slipped through anyway, because a prompt
 *    is a request and not a guarantee. A streamed reply and a stored one both pass
 *    through it, so an older thread cannot reintroduce the character either.
 *
 * Railway uploads `server/` on its own (see scripts/deploy-cloud.mjs), so this
 * module cannot be imported from the app folders. The app keeps a matching copy in
 * src/renderer-react/formatting.js, and scripts/selftest.js asserts that the two
 * produce identical output for a shared corpus.
 */

/** Em dash, en dash, figure dash, horizontal bar and the small typographic forms. */
const DASH = /[\u2012\u2013\u2014\u2015\u2E3A\u2E3B\uFE58\uFE63]/g;

/** Fenced and inline code, captured so it can be handed back untouched. */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/**
 * Rewrite the dashes in one run of prose.
 * @param {string} text
 * @returns {string}
 */
function rewriteProse(text) {
  return text
    // "10 - 20" written with a typographic dash is a range, so neither the dash
    // nor the spaces around it survive.
    .replace(/(\d)\s*[\u2012\u2013\u2014\u2015]\s*(\d)/g, '$1-$2')
    .replace(DASH, '-')
    // A dash already next to a hyphen can leave "- -", which reads as a typo.
    .replace(/(^|\s)-[ \t]+-[ \t]*(?=\s|$)/g, '$1-');
}

/**
 * Replace every typographic dash in a reply with a plain hyphen.
 *
 * Code is left byte for byte. A dash inside a string literal, a regex or a
 * command is the program's own content, and "fixing" it would silently change
 * what the person asked for.
 * @param {string} text
 * @returns {string}
 */
export function plainDashes(text) {
  if (typeof text !== 'string' || text === '') return typeof text === 'string' ? text : '';
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : rewriteProse(part)))
    .join('');
}

/**
 * The instruction every conversation carries. It is short on purpose: it is sent
 * with every request, so its length is charged against the customer's input
 * allowance on each turn.
 */
export const FORMATTING_RULES = [
  'House style for every reply:',
  'Never use em dashes or en dashes. Write a plain hyphen (-) between words, or use a comma or a full stop instead.',
  'Keep headings short, and leave one blank line between blocks so the answer is easy to scan.',
].join(' ');

/** The marker that shows the rule is already present, so it is never sent twice. */
export const FORMATTING_MARKER = 'Never use em dashes';

/**
 * Add the house style to a conversation that does not already carry it.
 *
 * The rule is a separate system turn rather than a rewrite of the caller's own,
 * so an instruction the person wrote is never edited.
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {Array<{ role: string, content: string }>}
 */
export function withFormattingRules(messages) {
  const already = messages.some(
    (message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes(FORMATTING_MARKER),
  );
  if (already) return messages;
  return [{ role: 'system', content: FORMATTING_RULES }, ...messages];
}

/**
 * Who the assistant is. Without it a model answers "I am DeepSeek" or "I am Claude"
 * in the browser and the phone app, because nothing told it otherwise. The desktop
 * app sends its own, longer version, which carries the same marker and is respected.
 */
export const ZURI_IDENTITY = 'You are Zuri, an AI assistant made by Tijha. Describe yourself as Zuri whenever you are asked who you are or who made you, and never name another AI company as your maker.';

/**
 * When to reach for the web, and when to ask first.
 *
 * The browser and the phone can search now, but a model given a tool does not use
 * it unless told when, so it answered from memory and hedged about being unable to
 * browse. This block is what makes it behave the way a person expects: look it up
 * yourself when the answer changes over time, and ask one sharp question when what
 * they asked cannot be searched well.
 *
 * The desktop app carries the same sentences in its own prompt. scripts/check-chat-sync.mjs
 * asserts the distinctive line is in both, so the two cannot drift apart.
 */
export const RESEARCH_RULES = [
  'You have a web search tool. Decide for yourself when to search, without waiting to be asked: if the answer depends on something that changes, search first and answer from what you find.',
  'That includes jobs and vacancies, prices, news, opening hours, travel times, availability, who currently holds a role, and any product, service or place someone might ask about.',
  'Never say you cannot browse the web, and never tell the person to look something up themselves while you can search for them.',
  'Never claim to have searched when you have not. If a search finds nothing useful, say so in one short sentence, then give what you already knew and say that is what it is.',
  'If what they asked is too vague to search well, such as asking for a job with no role or no place, ask one short question and offer a sensible default so a one-word answer is enough. Ask once, then act.',
  'If they already said enough to act on, act: search using the best reading of their words, and say in one short line what you searched for.',
  'When you give results, name the few that fit, with the site, one line on why each suits them, and a link. Do not paste long lists.',
].join(' ');

/** The marker that shows the research rules are already present. */
export const RESEARCH_MARKER = 'Decide for yourself when to search';

/**
 * Add the research rules to a conversation that does not already carry them.
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {Array<{ role: string, content: string }>}
 */
export function withResearchRules(messages) {
  const already = messages.some(
    (message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes(RESEARCH_MARKER),
  );
  if (already) return messages;
  return [{ role: 'system', content: RESEARCH_RULES }, ...messages];
}

/** The marker that shows the identity is already present, so it is never sent twice. */
export const IDENTITY_MARKER = 'You are Zuri';

/**
 * Put the identity first in a conversation that does not already carry it.
 * @param {Array<{ role: string, content: string }>} messages
 * @returns {Array<{ role: string, content: string }>}
 */
export function withZuriIdentity(messages) {
  const already = messages.some(
    (message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes(IDENTITY_MARKER),
  );
  if (already) return messages;
  return [{ role: 'system', content: ZURI_IDENTITY }, ...messages];
}

/**
 * How a good answer is shaped, the same for every model. The desktop app builds a
 * longer version from the person's saved style choices; the browser and phone app
 * have no such settings yet, so they get these defaults. Kept short because it is
 * charged as input on every turn.
 */
export const ANSWER_RULES = [
  'How to answer:',
  'Start with the answer itself, never a restatement of the question or a preamble such as "Great question".',
  'Match the length to the question: a greeting or simple fact gets a sentence or two, a hard problem gets the reasoning, steps and any caveat that changes what the person should do.',
  'Markdown is rendered. Use bullets for separate facts, numbered steps for a procedure, a table only to compare the same attributes across two or more things, and a fenced code block with a language tag for code. Never wrap a whole answer in a code fence and never use emoji.',
  'If the request is ambiguous in a way that changes the answer, state your assumption or ask one short question.',
  'Never invent facts, names, links or quotes, and say plainly when you do not know.',
  'When web search results are given, say which source each claim comes from and put its link next to it; if the results do not answer the question, say so instead of guessing.',
].join(' ');

/** The marker that shows the answer rules are already present. */
export const ANSWER_MARKER = 'How to answer:';

/** The opening line of the desktop app's own, longer style block. */
const DESKTOP_STYLE_MARKER = 'How to write this reply:';

/**
 * Short per-supplier corrections for habits each family of models is known for.
 * Keyed by the supplier the catalogue names, so a new Zuri model on an existing
 * supplier inherits the note without a code change.
 */
export const MODEL_NOTES = Object.freeze({
  deepseek: 'Do not show your reasoning or any <think> text; give only the final answer. Reply in the language the person wrote in, not Chinese by default.',
  moonshot: 'Do not pad with caveats or a closing summary of what you just said. Reply in the language the person wrote in.',
  zai: 'Do not show your reasoning. Prefer short paragraphs over long nested lists, and reply in the language the person wrote in.',
  openai: 'Do not end with an offer such as "Let me know if you want more"; stop when the answer is complete.',
  anthropic: 'Do not open with an apology or an acknowledgement of the request, and do not add a closing summary of what you just said.',
});

/**
 * Put the answer rules, plus the note for the model's supplier, ahead of the
 * conversation. A client that already sent the rules is respected, as with the
 * house style and identity.
 * @param {Array<{ role: string, content: string }>} messages
 * @param {string} supplier The catalogue's supplier for the chosen Zuri model.
 * @returns {Array<{ role: string, content: string }>}
 */
export function withAnswerStyle(messages, supplier) {
  const carries = (marker) => messages.some(
    (message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes(marker),
  );
  if (carries(ANSWER_MARKER)) return messages;
  const note = Object.hasOwn(MODEL_NOTES, supplier) ? MODEL_NOTES[supplier] : '';
  // The desktop app sends its own longer style block, built from the person's saved
  // choices. It keeps that block and gets only the supplier note, so the two never
  // contradict each other.
  const rules = carries(DESKTOP_STYLE_MARKER) ? '' : ANSWER_RULES;
  const content = [rules, note].filter((part) => part !== '').join(' ');
  if (content === '') return messages;
  // A project's own context stays first, since it is the person's standing wish for
  // this work and the rest of the system turns are the app's.
  const lead = messages[0]?.role === 'system' && String(messages[0].content).startsWith('You are answering inside the project') ? 1 : 0;
  return [...messages.slice(0, lead), { role: 'system', content }, ...messages.slice(lead)];
}

/** Characters withAnswerStyle adds for a supplier, so the allowance counts them. */
export function answerStyleLength(supplier) {
  return ANSWER_RULES.length + (Object.hasOwn(MODEL_NOTES, supplier) ? MODEL_NOTES[supplier].length + 1 : 0);
}
