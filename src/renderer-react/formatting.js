/*
 * The app's copy of the reply house style.
 *
 * The server owns the rule (server/src/text.js): it sends the instruction with
 * every conversation and rewrites the answer before streaming it. This copy is the
 * safety net on the reading side, for three cases the server cannot reach:
 *
 * - a reply saved before the rule existed,
 * - a reply produced by a local model rather than the account,
 * - a file written by a tool, which never passes through the chat endpoint.
 *
 * It must behave exactly like the server's copy. scripts/selftest.js compares the
 * two over a shared corpus, so the two can never drift apart quietly.
 */

/** Em dash, en dash, figure dash, horizontal bar and the small typographic forms. */
const DASH = /[\u2012\u2013\u2014\u2015\u2E3A\u2E3B\uFE58\uFE63]/g;

/** Fenced and inline code, captured so it can be handed back untouched. */
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;

function rewriteProse(text) {
  return text
    .replace(/(\d)\s*[\u2012\u2013\u2014\u2015]\s*(\d)/g, '$1-$2')
    .replace(DASH, '-')
    .replace(/(^|\s)-[ \t]+-[ \t]*(?=\s|$)/g, '$1-');
}

/**
 * Replace every typographic dash in a reply with a plain hyphen, leaving code
 * alone.
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
