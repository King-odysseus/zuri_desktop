/**
 * providers/chat.js - the one place Zuri talks to an AI provider in Ask mode.
 *
 * Ask mode is a single request/response with streaming: take the stored thread's
 * messages, ask the configured provider, push each token out as it arrives, and
 * append the finished reply to the thread once the stream closes. Nothing outside
 * this module knows which provider answered, so switching provider is a settings
 * change rather than a code change.
 *
 * The provider call is plain HTTP over Node's built-in `fetch` (bundled with
 * Electron's Node) with a small server-sent-events reader, rather than the
 * `openai` / `@anthropic-ai/sdk` packages. That keeps the adapter to one streaming
 * code path for both providers and adds no dependency; the wire format is stable
 * and documented, and the installer stays light for the same reason decisions.md
 * gives for skipping a headless browser.
 *
 * The API key never leaves this process and never enters an error message: provider
 * failures are reduced to a short, redacted sentence before they go near the
 * renderer.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_PROVIDER, PROVIDERS, getKey } from '../secrets.js';
import { appendMessage, findAgent, readStore } from '../store.js';
import { agentAllowedTools, runTool } from '../tools/index.js';

/**
 * Tools the model may call on its own in chat, only when the person has switched web
 * search on for the message. Each call costs another provider request, so the default
 * is no tools. Attached files are already inlined into the message, and the
 * confirmation-gated tools have no approval step in a streaming reply, so none of
 * those are offered.
 */
const CHAT_TOOLS = Object.freeze([
  {
    name: 'webSearch',
    description: 'Search the web. Use for current events, facts you are unsure of, or anything after your training data.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'webFetch',
    description: 'Read one web page by URL and return its text. Use after webSearch to read a result.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Full http or https URL.' } },
      required: ['url'],
    },
  },
]);

/**
 * Offered on every message (not only with web search on) because it costs nothing
 * unless the person asks for a file, and it only ever adds a new file to the workspace.
 */
const DOCUMENT_TOOL = Object.freeze({
  name: 'createDocument',
  description:
    'Create a downloadable Word (docx), Excel (xlsx) or PowerPoint (pptx) file when the person asks for a document, spreadsheet, deck or slides. ' +
    'Write the full content into the call; never ask them to copy text into Office themselves. After it succeeds, tell them the file is ready in one short sentence.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['docx', 'xlsx', 'pptx'], description: 'docx = Word, xlsx = Excel, pptx = PowerPoint.' },
      fileName: { type: 'string', description: 'Short file name without extension.' },
      content: {
        type: 'object',
        description:
          'docx: { title, sections: [{ heading, paragraphs: [text], bullets: [text], table: { rows: [[cell]] } }] }. ' +
          'xlsx: { sheets: [{ name, columns: [header], rows: [[value]] }] }; numbers stay numbers and a text value starting with "=" is a formula such as "=SUM(B2:B9)". ' +
          'pptx: { title, subtitle, slides: [{ title, bullets: [text], notes }] }.',
      },
    },
    required: ['kind', 'content'],
  },
});

const EDIT_TOOL = Object.freeze({
  name: 'editDocument',
  description:
    'Change an attached Word, Excel or PowerPoint file. Pass the file path shown after "Attached file" and a list of edits; the result is a new copy and the original stays untouched. ' +
    'docx/pptx edits: { find, replace } with the exact existing text. xlsx edits: { sheet, cell, value } (a value starting with "=" is a formula), { sheet, appendRow: [values] } or { find, replace }. ' +
    'Only use it when the person asks to change the file; otherwise just answer.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The attached file path.' },
      edits: { type: 'array', items: { type: 'object' }, description: 'The changes to make, in order.' },
    },
    required: ['path', 'edits'],
  },
});

/** Tools that produce a downloadable file; each success becomes a card under the reply. */
const FILE_TOOLS = Object.freeze([DOCUMENT_TOOL, EDIT_TOOL]);
const FILE_TOOL_NAMES = new Set(FILE_TOOLS.map((tool) => tool.name));

/** Every tool chat can run by name; which are offered on a given message is decided per send. */
const ALL_CHAT_TOOLS = Object.freeze([...CHAT_TOOLS, ...FILE_TOOLS]);

/** Each extra round is another paid model call, so the loop is capped hard. */
const MAX_TOOL_ROUNDS = 4;

/** A tool result is trimmed before going back to the model to keep the extra call cheap. */
const TOOL_RESULT_LIMIT = 8_000;

/**
 * Channel main pushes token events on. It is a one-way push, not an `invoke`
 * channel, so it stays out of the CHANNELS list in preload.js.
 */
export const CHAT_STREAM_CHANNEL = 'chat:stream';

/** Longest a single reply may run before the request is abandoned. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Reply cap for providers that require one (Anthropic does; OpenAI defaults it). */
const MAX_REPLY_TOKENS = 4096;

/**
 * Longest document body sent for a summary. A 200k-character read is well inside
 * every current context window, but trimming here keeps the request sane and the
 * saved summary notes when only part of the file was read.
 */
const SUMMARY_TEXT_LIMIT = 120_000;

/** What a document summary must contain, so Files shows the same shape every time. */
const SUMMARY_SYSTEM_PROMPT = [
  'You summarize documents for a busy professional.',
  'Start with one sentence saying what the document is and why it matters.',
  'Then give 3 to 6 short bullet points of the key facts, decisions or figures.',
  'Then a short "Action items" list, or state that there are none.',
  'Quote concrete names, numbers and dates from the document; never invent details.',
  'Write in English by default. Use another language only when the extra instruction explicitly requests it.',
  'Answer in Markdown with no preamble.',
].join(' ');

/**
 * This policy is appended after stored and agent prompts so a custom agent can
 * shape the answer without accidentally making the API switch languages.
 * Another language is allowed only when the person explicitly asks for it.
 */
const RESPONSE_LANGUAGE_POLICY = [
  'Language policy:',
  'Respond in clear English by default.',
  'Use another language only when the user explicitly asks you to respond, translate, or continue in that language.',
  'Do not mix languages unless the user explicitly requests a bilingual answer or the original text must be quoted.',
  'Keep names, code, file names, and quoted source text unchanged when they are not English.',
].join(' ');

/** Provider error bodies are trimmed to this before they reach a bubble. */
const MAX_ERROR_DETAIL = 240;

/**
 * These models have no clock of their own, so without this they refuse questions
 * like "what day is it" even though the desktop knows. The date is read per
 * request rather than at module load so a long-running window stays correct.
 * @param {Date} [now]
 * @returns {string}
 */
function currentTimeContext(now = new Date()) {
  const date = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `Current local date and time where the user is: ${date}, ${time} (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Use this whenever the user asks about today, the date, the day or the time. You still cannot see live websites or page contents unless a tool gives them to you.`;
}

/**
 * Everything that differs between providers. One entry per provider in
 * secrets.PROVIDERS, so a new provider is a table entry, plus a delta reader only
 * when the provider does not speak the OpenAI dialect.
 */
const PROVIDER_CONFIG = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    version: '2024-06-01',
    modelPattern: /^(gpt-|chatgpt-|o1|o3)/,
  }),
  anthropic: Object.freeze({
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-5-haiku-latest',
    version: '2023-06-01',
    modelPattern: /^claude-/,
  }),
  // DeepSeek, Kimi and GLM all speak the OpenAI chat-completions dialect, so each
  // needs no delta reader or request body of its own: requestBody, requestHeaders
  // and deltaText take the OpenAI branch for them, and a provider stays a table
  // entry. A reasoning model may also stream reasoning_content, which the reader
  // ignores, so thinking models work without a second code path.
  deepseek: Object.freeze({
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    // `deepseek-flash` is the current id and is served by DeepSeek-V4.1-Flash-1017.
    // The older `deepseek-chat` and `deepseek-reasoner` aliases were retired in July
    // 2026, so they must not be used as a fallback or a default.
    defaultModel: 'deepseek-flash',
    version: '2024-06-01',
    modelPattern: /^deepseek-/,
  }),
  moonshot: Object.freeze({
    label: 'Kimi',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    defaultModel: 'kimi-k3',
    version: '2024-06-01',
    modelPattern: /^kimi-/,
  }),
  zai: Object.freeze({
    label: 'Z.ai GLM',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.3',
    version: '2024-06-01',
    modelPattern: /^glm-/,
  }),
});

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
 * Trim a provider's error text to something a person can act on. Applied to every
 * string that comes back from the network: a provider echoing part of the request
 * must not put a key in a log line or a chat bubble.
 * @param {unknown} value
 * @returns {string}
 */
function redact(value) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DETAIL);
}

/**
 * Which provider and model a send should use.
 *
 * Order: the provider named in settings, then the first provider that actually has
 * a key, then the default. Falling back to a provider that has a key is what makes
 * a stored Anthropic key work without the user also having to name it.
 * A model is only reused when it belongs to the provider that won, so a model name
 * can never be sent to the wrong API.
 * @param {any} settings The store's settings object.
 * @returns {{ provider: 'openai'|'anthropic'|'deepseek'|'moonshot'|'zai', model: string }}
 */
export function resolveChatTarget(settings) {
  const configured = PROVIDERS.includes(settings?.provider) ? settings.provider : null;
  const provider = configured ?? PROVIDERS.find((name) => getKey(name) !== null) ?? DEFAULT_PROVIDER;

  // Ownership, not equality, decides this. Settings carry a model even when the
  // provider changed afterwards (the defaults hold gpt-4o), so trusting the saved
  // name would send gpt-4o to DeepSeek or Anthropic and fail a request the person
  // cannot fix from the error. A name that does not belong falls back instead.
  const savedModel = typeof settings?.model === 'string' ? settings.model.trim() : '';
  const model =
    savedModel !== '' && PROVIDER_CONFIG[provider].modelPattern.test(savedModel)
      ? savedModel
      : PROVIDER_CONFIG[provider].defaultModel;

  return { provider, model };
}

/**
 * Turn stored messages into the `{ role, content }` pairs both APIs accept.
 * Empty entries are dropped rather than sent: the store rejects empty content, but
 * a hand-edited chats.json could still carry one, and a provider would fail the
 * whole request over it.
 * @param {any[]} messages
 * @returns {{ system: string, turns: { role: string, content: string }[] }}
 */
function splitMessages(messages) {
  const system = [];
  const turns = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (content === '') continue;

    if (message.role === 'system') system.push(content);
    else {
      turns.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
        ...(Array.isArray(message.images) && message.images.length > 0 ? { images: message.images } : {}),
      });
    }
  }

  return { system: system.join('\n\n'), turns };
}

const IMAGE_MEDIA_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

/** Larger than this is refused by the providers or wastes a lot of tokens. */
const IMAGE_SIZE_LIMIT = 5 * 1024 * 1024;

/**
 * Replace each turn's saved image paths with the image parts its provider expects.
 * Only OpenAI and Anthropic models are known to read images; for the others the
 * images are left out and the model is told, so it does not pretend to see them.
 * The `images` key is always removed, because no provider accepts it on a message.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {{ role: string, content: string, images?: { name: string, path: string }[] }[]} turns
 * @returns {Promise<{ role: string, content: unknown }[]>}
 */
async function withImageParts(provider, turns) {
  const result = [];
  for (const { images, ...turn } of turns) {
    if (!Array.isArray(images) || images.length === 0) {
      result.push(turn);
      continue;
    }

    const parts = [];
    const skipped = [];
    for (const image of images) {
      const mediaType = IMAGE_MEDIA_TYPES[path.extname(image.path).toLowerCase()];
      const supported = provider === 'openai' || provider === 'anthropic';
      let bytes = null;
      if (supported && mediaType) {
        try {
          const info = await stat(image.path);
          if (info.size <= IMAGE_SIZE_LIMIT) bytes = await readFile(image.path);
        } catch (error) {
          console.warn('[zuri:chat] image', error?.message ?? error);
        }
      }
      if (bytes === null) {
        skipped.push(image.name || path.basename(image.path));
        continue;
      }
      const data = bytes.toString('base64');
      parts.push(
        provider === 'anthropic'
          ? { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
          : { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } },
      );
    }

    const note = skipped.length > 0
      ? `\n\n(The image ${skipped.join(', ')} could not be shown to you: this model cannot read images, or the file is missing or over 5 MB. Say so if it matters.)`
      : '';
    result.push({ ...turn, content: [...parts, { type: 'text', text: `${turn.content}${note}` }] });
  }
  return result;
}

/**
 * Request body per provider. Kept together so a second provider's shape sits
 * next to the first rather than in a second code path.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} model
 * @param {{ system: string, turns: { role: string, content: string }[] }} conversation
 * @returns {Record<string, unknown>}
 */
function requestBody(provider, model, conversation, tools = []) {
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: MAX_REPLY_TOKENS,
      stream: true,
      // Anthropic takes the system prompt as its own field, not as a message.
      ...(conversation.system ? { system: conversation.system } : {}),
      messages: conversation.turns,
    };
  }

  return {
    model,
    stream: true,
    messages: [
      ...(conversation.system ? [{ role: 'system', content: conversation.system }] : []),
      ...conversation.turns,
    ],
    ...(tools.length > 0
      ? { tools: tools.map((tool) => ({ type: 'function', function: tool })) }
      : {}),
  };
}

/**
 * Auth headers per provider. The key is written here and nowhere else.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} key
 * @returns {Record<string, string>}
 */
function requestHeaders(provider, key) {
  if (provider === 'anthropic') {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': PROVIDER_CONFIG.anthropic.version,
    };
  }

  return {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${key}`,
  };
}

/**
 * The text in one streamed event, or '' when the event carries none.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {any} event Parsed JSON from one `data:` line.
 * @returns {string}
 */
function deltaText(provider, event) {
  if (!event || typeof event !== 'object') return '';

  if (provider === 'anthropic') {
    if (event.type === 'content_block_delta' && typeof event.delta?.text === 'string') {
      return event.delta.text;
    }
    return '';
  }

  const choice = Array.isArray(event.choices) ? event.choices[0] : null;
  return typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
}

/**
 * An error the provider reported inside the stream itself. Both APIs can send one
 * after a 200 response, so the stream reader has to look for it.
 * @param {any} event
 * @returns {string} The provider's message, or '' when the event is not an error.
 */
function streamedError(event) {
  if (event?.type === 'error') return redact(event.error?.message ?? event.message);
  if (event?.error) return redact(event.error.message ?? event.error);
  return '';
}

/**
 * Read a server-sent-events response and hand each data payload to `onEvent`.
 * SSE frames are separated by a blank line; a chunk boundary can fall anywhere,
 * so the incomplete tail is carried into the next read.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(event: any) => void} onEvent
 * @returns {Promise<void>}
 */
async function readEventStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '' || payload === '[DONE]') continue;
          try {
            onEvent(JSON.parse(payload));
          } catch {
            // A provider may send a keep-alive that is not JSON. Ignoring it is
            // correct: the reply text is in the frames that do parse.
          }
        }

        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // Release the socket even when the caller threw part-way through.
    reader.releaseLock();
  }
}

// DeepSeek sometimes writes its tool request into the reply text as DSML markup
// (`<｜DSML｜function_calls>...`) instead of a real tool_calls field. Left alone it
// would show up in the chat, so the markup is cut from the text and read as calls.
const DSML_START = /<[|｜\s]*DSML/;
const DSML_HOLD_BACK = 16;

/**
 * Split reply text into what the person should read and any DSML tool calls.
 * @param {string} text
 * @returns {{ visible: string, calls: { id: string, name: string, arguments: string }[] }}
 */
export function splitDsml(text) {
  const start = text.search(DSML_START);
  if (start === -1) return { visible: text, calls: [] };

  const calls = [];
  const chunks = text.slice(start).split(/invoke\s+name="/).slice(1);
  for (const chunk of chunks) {
    const name = chunk.slice(0, chunk.indexOf('"'));
    if (name === '') continue;
    const args = {};
    for (const match of chunk.matchAll(/parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\s*\/[^>]*?parameter\s*>/g)) {
      args[match[1]] = match[2].trim();
    }
    calls.push({ id: '', name, arguments: JSON.stringify(args) });
  }
  return { visible: text.slice(0, start).trimEnd(), calls };
}

/**
 * Send one conversation to the configured provider and collect the streamed reply.
 * This is the single request path: chat and document summaries both come through
 * it, so the provider's error mapping lives in one place.
 * @param {'openai'|'anthropic'|'deepseek'|'moonshot'|'zai'} provider
 * @param {string} model
 * @param {string} key
 * @param {{ system: string, turns: { role: string, content: string }[] }} conversation
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, onDelta?: (text: string) => void }} [options]
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: { code: string, message: string } }>}
 */
async function streamReply(provider, model, key, conversation, options = {}) {
  const config = PROVIDER_CONFIG[provider];
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  // Reaching this line takes a few milliseconds (the thread and the key are read
  // first), so Stop can land while the reply is still being prepared. Nothing is left
  // to ask for then: report the stop and send nothing. Guarding here also keeps the
  // request from going out with a signal that has already fired.
  if (options.signal?.aborted) {
    return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
  }

  let response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: requestHeaders(provider, key),
      body: JSON.stringify(requestBody(provider, model, conversation, options.tools ?? [])),
      // Stop and the request timeout are separate reasons to give up, so both drive
      // the same fetch: whichever fires first ends the request. AbortSignal.any keeps
      // the caller's signal from removing the timeout.
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A rejected fetch is a network problem (offline, DNS, proxy, timeout). It is
    // the one failure a person can retry, so it gets its own wording.
    if (error?.name === 'TimeoutError') {
      return failure('CHAT_TIMEOUT', `${config.label} did not answer in time. Try again.`);
    }
    // Stop aborts the request on purpose, so it must not read as a network fault.
    if (options.signal?.aborted) {
      return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
    }
    return failure(
      'CHAT_NETWORK_ERROR',
      `Could not reach ${config.label}. Check your connection and try again.`,
    );
  }

  if (!response.ok) {
    const detail = redact(await response.text().catch(() => ''));
    if (response.status === 401 || response.status === 403) {
      return failure(
        'CHAT_KEY_REJECTED',
        `${config.label} rejected the saved key. Update it in Settings.`,
      );
    }
    if (response.status === 429) {
      return failure(
        'CHAT_RATE_LIMITED',
        `${config.label} is rate limiting this key. Wait a moment and try again.`,
      );
    }
    return failure(
      'CHAT_PROVIDER_ERROR',
      `${config.label} returned ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  if (!response.body) {
    return failure('CHAT_PROVIDER_ERROR', `${config.label} returned no reply.`);
  }

  let reply = '';
  let streamedLength = 0;
  let reasoning = '';
  let streamedFailure = '';
  /** @type {{ id: string, name: string, arguments: string }[]} */
  const toolCalls = [];

  try {
    await readEventStream(response.body, (event) => {
      const problem = streamedError(event);
      if (problem !== '') {
        streamedFailure = problem;
        return;
      }

      // Tool calls arrive in pieces keyed by index; the name comes first, the JSON
      // arguments are spread over later events.
      const delta = Array.isArray(event?.choices) ? event.choices[0]?.delta : null;
      if (typeof delta?.reasoning_content === 'string') reasoning += delta.reasoning_content;
      for (const piece of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
        const slot = (toolCalls[piece.index ?? 0] ??= { id: '', name: '', arguments: '' });
        if (piece.id) slot.id = piece.id;
        if (piece.function?.name) slot.name += piece.function.name;
        if (typeof piece.function?.arguments === 'string') slot.arguments += piece.function.arguments;
      }

      const text = deltaText(provider, event);
      if (text === '') return;

      reply += text;
      if (typeof options.onDelta !== 'function') return;

      // Stream only what comes before any DSML markup, and hold back a trailing "<"
      // that might be the start of one split across two chunks.
      const marker = reply.search(DSML_START);
      let limit = marker;
      if (marker === -1) {
        const tail = reply.lastIndexOf('<');
        limit = tail !== -1 && reply.length - tail < DSML_HOLD_BACK ? tail : reply.length;
      }
      if (limit > streamedLength) {
        options.onDelta(reply.slice(streamedLength, limit));
        streamedLength = limit;
      }
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      return failure('CHAT_TIMEOUT', `${config.label} stopped responding. Try again.`);
    }
    // The person pressed Stop mid-stream: the partial answer is thrown away with it.
    if (options.signal?.aborted) {
      return failure('CHAT_STOPPED', 'That reply was stopped before it arrived.');
    }
    return failure('CHAT_NETWORK_ERROR', `The reply from ${config.label} was cut off. Try again.`);
  }

  if (streamedFailure !== '') {
    return failure('CHAT_PROVIDER_ERROR', `${config.label} reported: ${streamedFailure}`);
  }

  const split = splitDsml(reply);
  // Markup calls only count when tools were offered; otherwise the model is asking for
  // something this turn cannot do, so the markup is dropped and the rest is shown.
  const offeredNames = (options.tools ?? []).map((tool) => tool.name);
  const calls = [
    ...toolCalls.filter((call) => call?.name),
    ...split.calls.filter((call) => offeredNames.includes(call.name)),
  ];
  if (split.visible.trim() === '' && calls.length === 0) {
    return failure('CHAT_EMPTY_REPLY', `${config.label} sent an empty reply. Try again.`);
  }

  // Whatever was held back (a trailing "<" that turned out to be plain text) goes out now.
  if (typeof options.onDelta === 'function' && split.visible.length > streamedLength) {
    options.onDelta(split.visible.slice(streamedLength));
  }

  return { ok: true, text: split.visible, reasoning, toolCalls: calls };
}

/**
 * Run the tool calls the model asked for and append the exchange to the conversation.
 * DeepSeek's thinking mode rejects the next request unless the assistant message that
 * made the calls carries its reasoning_content back, so it is kept here.
 */
async function answerToolCalls(conversation, reply, allowedTools, onStatus = () => {}, offeredTools = ALL_CHAT_TOOLS) {
  /** Files built by createDocument in this round, handed back so the reply can carry them. */
  const files = [];
  conversation.turns.push({
    role: 'assistant',
    content: reply.text,
    ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
    tool_calls: reply.toolCalls.map((call, index) => ({
      id: call.id || `call_${index}`,
      type: 'function',
      function: { name: call.name, arguments: call.arguments || '{}' },
    })),
  });

  for (const [index, call] of reply.toolCalls.entries()) {
    let args = {};
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      args = {};
    }
    // Only the chat tool list is reachable; the model cannot name another tool.
    const offered = offeredTools.some((tool) => tool.name === call.name);
    if (offered) {
      if (call.name === 'createDocument') {
        onStatus(`Creating your ${String(args.kind ?? 'document').toLowerCase()} file`);
      } else if (call.name === 'editDocument') {
        onStatus('Editing a copy of your file');
      } else {
        const target = String(args.query ?? args.url ?? '').slice(0, 80);
        onStatus(call.name === 'webFetch' ? `Reading ${target}` : `Searching the web for ${target}`);
      }
    }
    const result = offered
      ? await runTool(call.name, args, { allowedTools })
      : failure('TOOL_UNKNOWN', `${call.name} is not available in chat.`);
    const madeFile = FILE_TOOL_NAMES.has(call.name) && result.ok;
    if (madeFile) {
      const { path: filePath, name, kind, bytes } = result.data;
      files.push({ path: filePath, name, kind, bytes });
    }
    conversation.turns.push({
      role: 'tool',
      tool_call_id: call.id || `call_${index}`,
      // The model only needs to know it worked; the full disk path is not useful to it.
      content: JSON.stringify(
        madeFile
          ? {
              ok: true,
              data: {
                name: result.data.name,
                kind: result.data.kind,
                ...(result.data.changes !== undefined ? { changes: result.data.changes, notFound: result.data.notFound } : {}),
                note: 'The file is ready and shown to the person as a download card.',
              },
            }
          : result,
      ).slice(0, TOOL_RESULT_LIMIT),
    });
  }
  return files;
}

/**
 * Summarize a document's text with the configured provider. Used by the
 * `summarizeDocument` tool through the injected `summarize` dependency, so the
 * tool layer never imports this module (that would be a cycle: this file selects
 * tools). Nothing is streamed to a chat: the summary is returned once, complete.
 * @param {{ text?: string, fileName?: string, instruction?: string }} [document]
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, data: { summary: string, provider: string, model: string, label: string, truncated: boolean } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function summarizeText(document = {}, options = {}) {
  const fullText = typeof document.text === 'string' ? document.text.trim() : '';
  if (fullText === '') {
    return failure('SUMMARY_EMPTY_DOCUMENT', 'There is no text in that document to summarize.');
  }

  const settings = await readStore('settings');
  if (!settings.ok) return settings;

  const { provider, model } = resolveChatTarget(settings.data);
  const config = PROVIDER_CONFIG[provider];

  const key = getKey(provider);
  if (key === null) {
    return failure('SUMMARY_NO_KEY', `No ${config.label} key is saved. Add one in Settings, then try again.`);
  }

  const name = typeof document.fileName === 'string' && document.fileName.trim() !== '' ? document.fileName.trim() : 'the document';
  const instruction = typeof document.instruction === 'string' ? document.instruction.trim() : '';
  const truncated = fullText.length > SUMMARY_TEXT_LIMIT;
  const body = truncated ? fullText.slice(0, SUMMARY_TEXT_LIMIT) : fullText;

  const prompt = [
    instruction === '' ? null : `Extra instruction from the person: ${instruction}`,
    `Document name: ${name}`,
    '',
    'Document text:',
    body,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const reply = await streamReply(provider, model, key, {
    system: SUMMARY_SYSTEM_PROMPT,
    turns: [{ role: 'user', content: prompt }],
  }, options);
  if (!reply.ok) return reply;

  return {
    ok: true,
    data: {
      summary: reply.text.trim(),
      provider,
      model,
      label: `${config.label} ${model}`,
      truncated,
    },
  };
}

const WORD_ADDIN_SYSTEM_PROMPT =
  'You are Zuri, working inside Microsoft Word. Do what the person asks using the document text they give you. ' +
  'Reply with only the text to put in the document: no greeting, no explanation, no markdown fences.';

/** Longest slice of a document sent along with an add-in request; every character is billed. */
const ADDIN_CONTEXT_LIMIT = 30_000;

/**
 * One question from the Word add-in: an instruction plus the selected text or the
 * document, answered once with the configured provider. Not saved to any chat.
 * @param {{ prompt?: string, context?: string }} request
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, data: { text: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function askForAddin(request = {}, options = {}) {
  const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (prompt === '') return failure('ADDIN_EMPTY_PROMPT', 'Type what you want Zuri to do first.');

  const settings = await readStore('settings');
  if (!settings.ok) return settings;
  const { provider, model } = resolveChatTarget(settings.data);
  const key = getKey(provider);
  if (key === null) {
    return failure('ADDIN_NO_KEY', `No ${PROVIDER_CONFIG[provider].label} key is saved. Add one in Zuri Settings, then try again.`);
  }

  const context = typeof request.context === 'string' ? request.context.slice(0, ADDIN_CONTEXT_LIMIT) : '';
  const content = context === '' ? prompt : `${prompt}\n\nDocument text:\n${context}`;
  const reply = await streamReply(provider, model, key, {
    system: [WORD_ADDIN_SYSTEM_PROMPT, currentTimeContext()].join('\n\n'),
    turns: [{ role: 'user', content }],
  }, options);
  if (!reply.ok) return reply;
  return { ok: true, data: { text: reply.text.trim() } };
}

/**
 * Ask the configured provider for a reply to `threadId` and stream it out.
 *
 * Tokens are pushed through `emit({ threadId, delta })` as they arrive; the final
 * event is `emit({ threadId, done: true })`, sent after the reply has been saved.
 * The resolved value carries the saved thread so the caller can repaint from the
 * store's copy rather than from what it streamed.
 *
 * @param {string} threadId
 * @param {{ emit?: (event: object) => void, fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 *   `emit` is the push channel; `fetchImpl` exists so the selftest can drive the
 *   stream against a fake without network access.
 * @returns {Promise<{ ok: true, data: { thread: any, message: any, provider: string, model: string } } | { ok: false, error: { code: string, message: string } }>}
 */
export async function sendChatMessage(threadId, options = {}) {
  if (typeof threadId !== 'string' || threadId === '') {
    return failure('CHAT_INVALID_THREAD', 'A reply needs a chat to go in.');
  }

  const emit = typeof options.emit === 'function' ? options.emit : () => {};
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const listed = await readStore('chats');
  if (!listed.ok) return listed;

  const thread = listed.data.find((entry) => entry?.id === threadId);
  if (!thread) return failure('CHAT_NOT_FOUND', 'That chat no longer exists.');

  const conversation = splitMessages(thread.messages);
  if (conversation.turns.length === 0) {
    return failure('CHAT_EMPTY_THREAD', 'There is nothing in this chat to reply to yet.');
  }

  const settings = (await readStore('settings')).data;
  const { provider, model } = resolveChatTarget(settings);
  const config = PROVIDER_CONFIG[provider];
  conversation.turns = await withImageParts(provider, conversation.turns);

  // An agent's system prompt rides in front of any the thread already carries, so
  // the picked agent decides how the reply is written without losing the thread's own.
  const agent = findAgent(settings, options.agentId);
  if (agent !== null && agent.systemPrompt.trim() !== '') {
    conversation.system = [agent.systemPrompt.trim(), conversation.system]
      .filter((part) => part !== '')
      .join('\n\n');
  }
  conversation.system = [conversation.system, currentTimeContext(), RESPONSE_LANGUAGE_POLICY]
    .filter((part) => part !== '')
    .join('\n\n');

  const key = getKey(provider);
  if (key === null) {
    return failure(
      'CHAT_NO_KEY',
      `No ${config.label} key is saved. Add one in Settings to get replies.`,
    );
  }

  // Anthropic uses a different tool format, so tools are offered on the OpenAI-style
  // providers only. An agent's allow-list narrows what the model can call.
  const allowedTools = agentAllowedTools(settings, options.agentId);
  const candidateTools = options.webSearch === true ? ALL_CHAT_TOOLS : FILE_TOOLS;
  const tools =
    provider === 'anthropic'
      ? []
      : candidateTools.filter((tool) => allowedTools === null || allowedTools.includes(tool.name));
  const builtFiles = [];

  // Text from every round is kept because it was all streamed to the window, so the
  // saved message matches what the person watched arrive.
  let fullText = '';
  let nudged = false;
  for (let round = 0; ; round += 1) {
    const toolsOffered = round < MAX_TOOL_ROUNDS ? tools : [];

    // Once tools are withdrawn (or a round came back empty) the model must be told to
    // answer; otherwise it keeps writing tool markup that is stripped to nothing.
    if (round > 0 && !nudged && (toolsOffered.length === 0 || conversation.needsAnswer === true)) {
      conversation.turns.push({ role: 'user', content: 'Answer now in plain text using the search results above. Do not call any tools.' });
      nudged = true;
    }

    const reply = await streamReply(provider, model, key, conversation, {
      fetchImpl,
      signal: options.signal,
      tools: toolsOffered,
      onDelta: (text) => emit({ threadId, delta: text }),
    });

    if (!reply.ok) {
      // An empty round after tools ran is not worth losing the text already shown.
      if (reply.error.code === 'CHAT_EMPTY_REPLY' && round > 0) {
        if (fullText.trim() !== '') break;
        if (!nudged) {
          conversation.needsAnswer = true;
          continue;
        }
      }
      return reply;
    }

    // Rounds are joined with a blank line so "...licence." and "Let me read" do not run together.
    if (fullText !== '' && reply.text !== '') {
      emit({ threadId, delta: '\n\n' });
      fullText += '\n\n';
    }
    fullText += reply.text;
    if (reply.toolCalls.length === 0) break;
    const made = await answerToolCalls(conversation, reply, allowedTools, (status) => emit({ threadId, status }), tools);
    emit({ threadId, status: '' });
    if (made.length > 0) {
      builtFiles.push(...made);
      emit({ threadId, files: made });
    }
  }

  if (fullText.trim() === '') {
    return failure('CHAT_EMPTY_REPLY', `${config.label} sent an empty reply. Try again.`);
  }

  const saved = await appendMessage(threadId, { role: 'assistant', content: fullText, files: builtFiles });
  if (!saved.ok) return saved;

  emit({ threadId, done: true });
  return { ok: true, data: { ...saved.data, provider, model } };
}
