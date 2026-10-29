/**
 * Tool requests a supplier writes as text instead of as a tool call.
 *
 * Every spelling of this has to be read here, or the request is shown to the person
 * as if it were the answer and the tool never runs. Two shapes occur in practice:
 * DeepSeek writes DSML markup (`<|DSML| function_calls> ... invoke name="webSearch"`),
 * and the OpenAI-compatible models write
 * `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`.
 *
 * Ported from the desktop app's own reader, which has handled this in chat for weeks.
 * The rule is the same in both places: markup ends the readable part, because a model
 * that writes a call says nothing after it.
 */

const TOOL_MARKUP_START = /<[|｜\s]*DSML|<tool_call>/i;
const TOOL_CALL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
// A "<" that may be the first character of a tool block still arriving in the next
// chunk is not painted until it is known to be ordinary text.
const TOOL_MARKUP_HOLD_BACK = 16;

/**
 * How much of a half-arrived reply is safe to paint: everything before a tool block,
 * and none of a trailing "<" that a later chunk may turn into one.
 * @param {string} text
 * @returns {number}
 */
export function visiblePrefixLength(text) {
  if (typeof text !== 'string' || text === '') return 0;
  const marker = text.search(TOOL_MARKUP_START);
  if (marker !== -1) return marker;
  const tail = text.lastIndexOf('<');
  return tail !== -1 && text.length - tail < TOOL_MARKUP_HOLD_BACK ? tail : text.length;
}

/**
 * One `<tool_call>` body as a call. Its arguments arrive as an object where every
 * other call carries them as a JSON string, so they are put back into that shape.
 * @param {string} body
 * @param {number} index
 * @returns {{ id: string, name: string, arguments: string } | null}
 */
function textToolCall(body, index) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON, so not a call. The block is still markup and is dropped with it.
    return null;
  }
  const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
  if (name === '') return null;
  const args = parsed.arguments ?? parsed.parameters ?? {};
  return {
    // The tool turn has to quote the id the assistant turn used as well, and a call
    // written into the text has none, so it is given one the supplier cannot reuse.
    id: `call_text_${index}`,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
  };
}

/**
 * Split reply text into what the person should read and any tool calls written into
 * it as markup.
 * @param {string} text
 * @returns {{ visible: string, calls: { id: string, name: string, arguments: string }[] }}
 */
export function splitToolCalls(text) {
  const source = typeof text === 'string' ? text : '';
  const start = source.search(TOOL_MARKUP_START);
  if (start === -1) return { visible: source, calls: [] };

  const calls = [];
  // DSML names the tool on an invoke tag and its arguments on parameter tags.
  const chunks = source.slice(start).split(/invoke\s+name="/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.slice(0, chunk.indexOf('"'));
    if (name === '') continue;
    const args = {};
    for (const match of chunk.matchAll(/parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\s*\/[^>]*?parameter\s*>/g)) {
      args[match[1]] = match[2].trim();
    }
    calls.push({ id: `call_text_${calls.length}`, name, arguments: JSON.stringify(args) });
  }
  // The simpler spelling wraps the whole call, name and arguments, in JSON.
  for (const block of source.matchAll(TOOL_CALL_BLOCK)) {
    const call = textToolCall(block[1], calls.length);
    if (call !== null) calls.push(call);
  }
  return { visible: source.slice(0, start).trimEnd(), calls };
}

/**
 * The readable part of a reply on its own, for a path that cannot act on a call.
 * @param {string} text
 * @returns {string}
 */
export function visibleText(text) {
  return splitToolCalls(text).visible;
}
