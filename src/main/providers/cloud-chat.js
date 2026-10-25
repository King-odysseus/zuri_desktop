/**
 * cloud-chat.js - the chat route that spends the person's Zuri plan.
 *
 * Zuri answers through the account rather than a key pasted into Settings, so the
 * desktop never holds a supplier key for chat. This module is the whole shape of
 * that request: which Zuri model to name, what the server accepts as a
 * conversation, and how a streamed answer is turned into what the transcript
 * shows. It does no I/O of its own, so the selftest can prove all of it without a
 * network, a session or a key.
 */

/** The model the cloud answers with when Settings names none it recognises. */
export const DEFAULT_CLOUD_MODEL = 'zuri-flash';

/**
 * Supplier model id -> Zuri catalogue code.
 *
 * Settings used to store the supplier id because the app called the supplier
 * directly. People already have settings files written that way, and the cloud
 * only knows Zuri codes, so the old values are translated rather than thrown away.
 * A code that is already a Zuri one is passed through untouched.
 */
export const ZURI_MODEL_BY_SUPPLIER = Object.freeze({
  'deepseek-flash': 'zuri-flash',
  'kimi-k3': 'zuri-pro',
  'glm-5.3': 'zuri-max',
  'gpt-5.3-codex': 'zuri-code',
  'gpt-6.1-sol': 'zuri-code',
  'claude-sonnet-5-5': 'zuri-reason',
  'claude-opus-5-5': 'zuri-elite',
});

const ZURI_CODE = /^zuri-[a-z0-9-]+$/;

/**
 * The Zuri model code to ask the cloud for.
 * @param {{ model?: unknown } | null} [settings]
 * @returns {string}
 */
export function zuriModelCode(settings) {
  const saved = typeof settings?.model === 'string' ? settings.model.trim().toLowerCase() : '';
  if (saved === '') return DEFAULT_CLOUD_MODEL;
  if (ZURI_CODE.test(saved)) return saved;
  return ZURI_MODEL_BY_SUPPLIER[saved] ?? DEFAULT_CLOUD_MODEL;
}

/**
 * Turn the app's own conversation shape into the server's `messages` array.
 *
 * The server accepts `system`, `user` and `assistant` with text content only. A
 * turn carrying an attached image is sent without it rather than dropped whole,
 * so an image in the thread does not silently cost the person the conversation
 * that came before it. Attachments reaching the cloud is separate work.
 *
 * @param {{ system?: string, turns?: Array<{ role?: string, content?: unknown }> }} conversation
 * @param {string} [context] Extra system instruction, such as web search results.
 * @returns {Array<{ role: string, content: string }>}
 */
export function cloudMessages(conversation, context = '') {
  const messages = [];
  const system = typeof conversation?.system === 'string' ? conversation.system.trim() : '';
  if (system !== '') messages.push({ role: 'system', content: system });
  // After the identity and before the conversation: it is instruction, not a turn,
  // and the identity has to stay the first thing the model reads.
  const extra = typeof context === 'string' ? context.trim() : '';
  if (extra !== '') messages.push({ role: 'system', content: extra });

  for (const turn of Array.isArray(conversation?.turns) ? conversation.turns : []) {
    if (typeof turn?.content !== 'string') continue;

    // A tool result travels as its own message, addressed to the call it answers, so
    // the supplier can line it up with the request that produced it.
    if (turn.role === 'tool') {
      if (turn.toolCallId) messages.push({ role: 'tool', content: turn.content, toolCallId: turn.toolCallId });
      continue;
    }
    // The assistant turn that asked for tools repeats the calls, which is what makes
    // the results that follow legible to the model.
    if (turn.role === 'assistant' && Array.isArray(turn.toolCalls) && turn.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: turn.content, toolCalls: turn.toolCalls });
      continue;
    }
    if (turn.content === '') continue;
    messages.push({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content });
  }
  return messages;
}

/**
 * Turn a finished web search into an instruction the model can follow.
 *
 * The cloud route has no tool loop, so the search happens here, before the
 * request: the app already owns a working search, and running it locally means a
 * signed-in person is not the one user for whom the toggle silently does
 * nothing. The results are numbered so the answer can point at them, and the
 * model is told not to invent a source: a citation that leads nowhere is worse
 * than no citation.
 *
 * @param {string} query
 * @param {Array<{ title?: string, url?: string, snippet?: string }>} results
 * @returns {string}
 */
export function webSearchContext(query, results) {
  const asked = typeof query === 'string' ? query.trim() : '';
  const usable = (Array.isArray(results) ? results : []).filter(
    (entry) => typeof entry?.url === 'string' && entry.url !== '',
  );
  if (usable.length === 0) {
    return [
      'A web search was run for this question but returned nothing usable.',
      'Say plainly that you could not find current information, and do not guess or invent sources.',
    ].join(' ');
  }

  const lines = usable.slice(0, 6).map((entry, index) => {
    const title = typeof entry.title === 'string' && entry.title !== '' ? entry.title.trim() : entry.url;
    const snippet = typeof entry.snippet === 'string' ? entry.snippet.trim().replace(/\s+/g, ' ') : '';
    return `${index + 1}. ${title}` + `\n   ${entry.url}` + (snippet === '' ? '' : `\n   ${snippet}`);
  });

  return [
    `The person switched web search on, and these live results were just fetched for: "${asked}".`,
    'Answer from them where they cover the question.',
    'Cite a result by its number in square brackets, like [1], right after the fact it supports.',
    'Never cite a number that is not in this list, and never invent a source or a URL.',
    'If the results do not answer the question, say so instead of filling the gap from memory.',
    // Numbers alone leave the person unable to see what [1] or [4] actually is, so
    // the answer ends by naming the sources it used as real links. The URLs are
    // already above; this asks for the readable list at the foot of the reply.
    'End the answer with a line reading "Sources", then one line per result you actually used, as a markdown link: [title](url).',
    'List only the ones you cited, and leave the section out entirely if you used none.',
    'Results:',
    ...lines,
  ].join('\n');
}

/**
 * The question a search should answer: the last thing the person typed.
 *
 * The newest user turn is the one that mentions the topic, and older turns are
 * context. An inlined attachment rides along in that turn, so its text is dropped
 * rather than searched for: the file body is not a sensible query.
 * @param {{ turns?: Array<{ role?: string, content?: unknown }> }} conversation
 * @returns {string}
 */
export function lastQuestion(conversation) {
  const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === 'assistant') continue;
    const content = typeof turns[index]?.content === 'string' ? turns[index].content : '';
    // Everything from the attachment marker onwards is the file, not the question.
    const question = content.split('\n\nAttached file:')[0].split('\n\nAttached folder:')[0];
    const flat = question.replace(/\s+/g, ' ').trim();
    if (flat !== '') return flat.slice(0, 300);
  }
  return '';
}

/**
 * Ask the account for one reply.
 *
 * `postChat` is injected so this stays testable: in the app it is a signed POST to
 * `/api/chat` that reads the event stream, and in the checks it is a stub that
 * records what would have been sent.
 *
 * The reply arrives as deltas. A server that has not been updated answers one
 * plain JSON body instead, which postChat hands back whole; the text is then
 * emitted once here, so the transcript fills the same way on either.
 *
 * @param {{
 *   conversation: { system?: string, turns?: Array<object> },
 *   settings: object,
 *   signal?: AbortSignal,
 *   postChat: (
 *     body: { model: string, messages: Array<{ role: string, content: string }>, stream: boolean },
 *     options: { signal?: AbortSignal, onDelta: (text: string) => void },
 *   ) => Promise<object>,
 *   emit?: (event: { delta?: string }) => void,
 * }} request
 * @returns {Promise<{ ok: true, data: { content: string, modelCode: string, modelName: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function replyThroughAccount({ conversation, settings, signal, postChat, emit = () => {}, context = '', tools = [] }) {
  const messages = cloudMessages(conversation, context);
  // The server refuses an empty conversation, so say why here rather than letting a
  // 400 come back for a chat that has nothing to send.
  if (messages.every((message) => message.role === 'system')) {
    return { ok: false, error: { code: 'CHAT_EMPTY_THREAD', message: 'There is nothing in this chat to reply to yet.' } };
  }

  const model = zuriModelCode(settings);
  // Text already handed to the window. Deltas are counted rather than assumed, so
  // a non-streaming answer is not emitted twice.
  let streamed = '';
  const result = await postChat(
    {
      model,
      messages,
      stream: true,
      // Omitted entirely when there are none, so a plain chat stays a plain chat and
      // the server keeps its streaming path.
      ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    },
    {
      signal,
      onDelta: (text) => {
        if (typeof text !== 'string' || text === '') return;
        streamed += text;
        emit({ delta: text });
      },
    },
  );
  if (result?.ok !== true) {
    return {
      ok: false,
      error: result?.error ?? { code: 'CHAT_CLOUD_FAILED', message: 'Zuri could not answer. Try again.' },
    };
  }

  const content = typeof result.data?.content === 'string' ? result.data.content : streamed;
  const toolCalls = Array.isArray(result.data?.toolCalls) ? result.data.toolCalls : [];
  if (content.trim() === '' && toolCalls.length === 0) {
    return { ok: false, error: { code: 'CHAT_EMPTY_REPLY', message: 'Zuri sent an empty reply. Try again.' } };
  }
  // Nothing was streamed, so any text is the whole of it and arrives at once.
  if (streamed === '' && content !== '') emit({ delta: content });

  return {
    ok: true,
    data: {
      content,
      toolCalls,
      usage: result.data?.usage ?? null,
      modelCode: typeof result.data?.model === 'string' ? result.data.model : model,
      modelName: typeof result.data?.modelName === 'string' ? result.data.modelName : '',
    },
  };
}
