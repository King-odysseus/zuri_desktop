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
