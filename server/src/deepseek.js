/**
 * Keep provider-specific HTTP details outside the route handler. The app only
 * receives normalized content and usage, so quota accounting stays provider
 * agnostic if another OpenAI-compatible backend is added later.
 *
 * Each client takes an optional `onDelta`. When it is given, the request asks the
 * supplier to stream and every fragment of text is handed to it as it arrives, so
 * the person watches the answer appear instead of waiting for the whole thing.
 * The returned result is identical either way: the same content and the same
 * usage, which is what the quota is committed from.
 */

/**
 * Walk a server-sent-events body and hand each `data:` payload to the caller.
 *
 * Only `data:` lines carry content; `event:` and `id:` lines are framing, and a
 * supplier may send comments as keep-alives. A chunk can also end mid-line, so
 * complete lines are parsed and the remainder waits for the next read: a frame
 * split across two network packets would otherwise be dropped or mangled.
 *
 * @param {Response} response
 * @param {(payload: unknown) => void} onPayload
 * @returns {Promise<void>}
 */
async function readSse(response, onPayload) {
  const handleLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const data = line.slice('data:'.length).trim();
    // "[DONE]" is OpenAI's end marker and carries no JSON.
    if (data === '' || data === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      // A supplier that sends something other than JSON is not worth failing a
      // reply over; the assembled text and usage decide that.
      return;
    }
    onPayload(parsed);
  };

  // A response without a readable body is possible in a test double, so fall back
  // to reading the whole thing and splitting it.
  if (!response.body || typeof response.body.getReader !== 'function') {
    const whole = await response.text();
    for (const line of whole.split('\n')) handleLine(line);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      handleLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== '') handleLine(buffer);
}

/**
 * Rough token count for the rare supplier that streams without reporting usage.
 *
 * The route commits quota from these numbers, so an estimate that is a little low
 * is a real (if small) undercharge. It is only used when the supplier sent no
 * usage block at all; the reservation already reserved the full envelope, so the
 * estimate can never let a request overspend the plan.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * The conversation as an OpenAI-compatible supplier expects it.
 *
 * The wire format the app speaks is deliberately neutral: a tool result is a
 * message with `role: "tool"` and the id of the call it answers, and an assistant
 * turn repeats the calls it made. Each supplier wants a different arrangement of
 * the same facts, so the arrangement happens here rather than in the app.
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function openAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.toolCalls.map((call, index) => ({
          id: call.id || `call_${index}`,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * The tools a supplier will accept. A name and a JSON-schema object of parameters
 * is all either API needs; anything extra on the descriptor stays in the app.
 * @param {Array<object>} tools
 * @returns {Array<object>}
 */
function openAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

/**
 * Tool calls from an OpenAI-compatible reply, in the app's neutral shape.
 * @param {any} raw
 * @returns {Array<{ id: string, name: string, arguments: string }>}
 */
function openAiToolCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call) => typeof call?.function?.name === 'string' && call.function.name !== '')
    .map((call, index) => ({
      id: typeof call.id === 'string' ? call.id : `call_${index}`,
      name: call.function.name,
      arguments: typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments ?? {}),
    }));
}
/**
 * The OpenAI-compatible suppliers (DeepSeek, Moonshot, Z.ai, OpenAI) share one
 * wire format, so they share one client.
 */
export function createDeepSeekClient({ apiKey, endpoint, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null;
  const target = typeof endpoint === 'string' && endpoint.trim() !== ''
    ? endpoint.trim()
    : 'https://api.deepseek.com/chat/completions';

  return async function complete({ messages, model, maxTokens, signal, onDelta, tools = [] }) {
    const streaming = typeof onDelta === 'function';
    // A tool round is answered whole rather than streamed: the interesting part of
    // that round is the calls, not the words, and a caller waiting on a call does
    // not need it typed out.
    const offered = Array.isArray(tools) ? tools : [];
    const wire = openAiMessages(messages);
    const toolPayload = offered.length > 0 ? { tools: openAiTools(offered) } : {};
    const result = await fetchImpl(target, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        streaming
          // include_usage makes the last frame carry the token counts; without it a
          // streamed reply reports no usage and the quota would have to guess.
          ? { model, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } }
          : { model, messages, max_tokens: maxTokens, stream: false },
      ),
      signal,
    });
    if (!result.ok) {
      const error = new Error('The AI provider rejected the request.');
      error.code = 'PROVIDER_REQUEST_FAILED';
      error.status = result.status;
      throw error;
    }

    if (!streaming) {
      const payload = await result.json();
      const rawMessage = payload?.choices?.[0]?.message;
      const message = rawMessage?.content;
      const toolCalls = openAiToolCalls(rawMessage?.tool_calls);
      // A reply that asks for a tool often carries no text at all, so an empty
      // string is only a fault when nothing was asked for either.
      if (typeof message !== 'string' && toolCalls.length === 0) {
        const error = new Error('The AI provider returned an incomplete response.');
        error.code = 'PROVIDER_RESPONSE_INVALID';
        throw error;
      }
      const inputTokens = Number(payload?.usage?.prompt_tokens);
      const outputTokens = Number(payload?.usage?.completion_tokens);
      return {
        id: typeof payload?.id === 'string' ? payload.id : '',
        model: typeof payload?.model === 'string' ? payload.model : model,
        content: typeof message === 'string' ? message : '',
        toolCalls,
        usage: {
          inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? Math.floor(inputTokens) : 0,
          outputTokens: Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.floor(outputTokens) : 0,
        },
      };
    }

    let content = '';
    let repliedModel = model;
    let usage = null;
    // Tool calls arrive the same way as text: in fragments, each naming its index.
    // The name comes once and the argument JSON is split across frames, so they are
    // gathered per index and only parsed once the stream ends.
    const partialCalls = new Map();
    await readSse(result, (payload) => {
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta !== '') {
        content += delta;
        onDelta(delta);
      }
      for (const fragment of Array.isArray(payload?.choices?.[0]?.delta?.tool_calls) ? payload.choices[0].delta.tool_calls : []) {
        const index = Number.isInteger(fragment?.index) ? fragment.index : partialCalls.size;
        const current = partialCalls.get(index) ?? { id: '', name: '', arguments: '' };
        if (typeof fragment?.id === 'string' && fragment.id !== '') current.id = fragment.id;
        if (typeof fragment?.function?.name === 'string' && fragment.function.name !== '') current.name = fragment.function.name;
        if (typeof fragment?.function?.arguments === 'string') current.arguments += fragment.function.arguments;
        partialCalls.set(index, current);
      }
      // The final frame repeats the model and carries usage with an empty choices
      // list, so it is read outside the delta branch.
      if (typeof payload?.model === 'string' && payload.model !== '') repliedModel = payload.model;
      if (payload?.usage && typeof payload.usage === 'object') usage = payload.usage;
    });

    const toolCalls = [...partialCalls.values()]
      .filter((call) => call.name !== '')
      .map((call, index) => ({ id: call.id || `call_${index}`, name: call.name, arguments: call.arguments || '{}' }));
    if (content === '' && toolCalls.length === 0) {
      const error = new Error('The AI provider returned an incomplete response.');
      error.code = 'PROVIDER_RESPONSE_INVALID';
      throw error;
    }
    const promptTokens = Number(usage?.prompt_tokens);
    const completionTokens = Number(usage?.completion_tokens);
    return {
      id: '',
      model: repliedModel,
      content,
      toolCalls,
      usage: {
        inputTokens: Number.isFinite(promptTokens) && promptTokens >= 0
          ? Math.floor(promptTokens)
          : estimateTokens(messages.map((message) => message.content).join(' ')),
        outputTokens: Number.isFinite(completionTokens) && completionTokens >= 0
          ? Math.floor(completionTokens)
          : estimateTokens(content),
      },
    };
  };
}

/**
 * Adapt Anthropic's Messages API to the same normalized result used by the
 * OpenAI-compatible suppliers. Anthropic keeps system content outside the
 * messages array, so split it here instead of leaking provider details into
 * the route handler.
 */
export function createAnthropicClient({ apiKey, endpoint = 'https://api.anthropic.com/v1/messages', fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null;
  const target = typeof endpoint === 'string' && endpoint.trim() !== '' ? endpoint.trim() : 'https://api.anthropic.com/v1/messages';

  /**
   * Anthropic wants the calls and their results as typed content blocks, and it
   * wants every result for one round inside a single user turn.
   * @param {Array<object>} messages
   * @returns {Array<object>}
   */
  function anthropicMessages(messages) {
    const turns = [];
    for (const message of messages) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') {
        const block = {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
        };
        // Results belong together: join the user turn that already holds some.
        const last = turns.at(-1);
        if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
        else turns.push({ role: 'user', content: [block] });
        continue;
      }
      if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        turns.push({
          role: 'assistant',
          content: [
            ...(message.content ? [{ type: 'text', text: message.content }] : []),
            ...message.toolCalls.map((call, index) => ({
              type: 'tool_use',
              id: call.id || `toolu_${index}`,
              name: call.name,
              input: parseArguments(call.arguments),
            })),
          ],
        });
        continue;
      }
      turns.push({ role: message.role, content: message.content });
    }
    return turns;
  }

  return async function complete({ messages, model, maxTokens, signal, onDelta, tools = [] }) {
    const streaming = typeof onDelta === 'function';
    const offered = Array.isArray(tools) ? tools : [];
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const conversation = anthropicMessages(messages);
    const toolPayload = offered.length > 0
      ? {
        tools: offered.map((tool) => ({
          name: tool.name,
          description: tool.description ?? '',
          input_schema: tool.parameters ?? { type: 'object', properties: {} },
        })),
      }
      : {};
    const result = await fetchImpl(target, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: conversation,
        ...toolPayload,
        ...(streaming ? { stream: true } : {}),
      }),
      signal,
    });
    if (!result.ok) {
      const error = new Error('The AI provider rejected the request.');
      error.code = 'PROVIDER_REQUEST_FAILED';
      error.status = result.status;
      throw error;
    }

    if (!streaming) {
      const payload = await result.json();
      const blocks = Array.isArray(payload?.content) ? payload.content : [];
      const content = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('');
      const toolCalls = blocks
        .filter((block) => block?.type === 'tool_use' && typeof block.name === 'string')
        .map((block, index) => ({
          id: typeof block.id === 'string' ? block.id : `toolu_${index}`,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        }));
      if (content === '' && toolCalls.length === 0) {
        const error = new Error('The AI provider returned an incomplete response.');
        error.code = 'PROVIDER_RESPONSE_INVALID';
        throw error;
      }
      return {
        id: typeof payload?.id === 'string' ? payload.id : '',
        model: typeof payload?.model === 'string' ? payload.model : model,
        content,
        toolCalls,
        usage: {
          inputTokens: Number.isFinite(Number(payload?.usage?.input_tokens)) ? Math.floor(Number(payload.usage.input_tokens)) : 0,
          outputTokens: Number.isFinite(Number(payload?.usage?.output_tokens)) ? Math.floor(Number(payload.usage.output_tokens)) : 0,
        },
      };
    }

    // Anthropic streams named events: the text arrives in content_block_delta, the
    // input count in message_start and the final output count in message_delta.
    let content = '';
    let repliedModel = model;
    let inputTokens = null;
    let outputTokens = null;
    let streamError = null;
    // A tool_use block streams as a start naming the tool, then JSON fragments.
    const partialTools = new Map();
    await readSse(result, (payload) => {
      const type = payload?.type;
      if (type === 'content_block_start' && payload?.content_block?.type === 'tool_use') {
        const index = Number.isInteger(payload.index) ? payload.index : partialTools.size;
        partialTools.set(index, {
          id: typeof payload.content_block.id === 'string' ? payload.content_block.id : '',
          name: payload.content_block.name,
          arguments: '',
        });
        return;
      }
      if (type === 'content_block_delta' && payload?.delta?.type === 'input_json_delta') {
        const index = Number.isInteger(payload.index) ? payload.index : 0;
        const current = partialTools.get(index);
        if (current && typeof payload.delta.partial_json === 'string') current.arguments += payload.delta.partial_json;
        return;
      }
      if (type === 'content_block_delta' && typeof payload?.delta?.text === 'string') {
        content += payload.delta.text;
        onDelta(payload.delta.text);
        return;
      }
      if (type === 'message_start') {
        if (typeof payload?.message?.model === 'string' && payload.message.model !== '') repliedModel = payload.message.model;
        const started = Number(payload?.message?.usage?.input_tokens);
        if (Number.isFinite(started) && started >= 0) inputTokens = Math.floor(started);
        return;
      }
      if (type === 'message_delta') {
        const finished = Number(payload?.usage?.output_tokens);
        if (Number.isFinite(finished) && finished >= 0) outputTokens = Math.floor(finished);
        return;
      }
      if (type === 'error') {
        streamError = new Error('The AI provider rejected the request.');
        streamError.code = 'PROVIDER_REQUEST_FAILED';
      }
    });

    if (streamError) throw streamError;
    const toolCalls = [...partialTools.values()]
      .filter((call) => typeof call.name === 'string' && call.name !== '')
      .map((call, index) => ({ id: call.id || `toolu_${index}`, name: call.name, arguments: call.arguments || '{}' }));
    if (content === '' && toolCalls.length === 0) {
      const error = new Error('The AI provider returned an incomplete response.');
      error.code = 'PROVIDER_RESPONSE_INVALID';
      throw error;
    }
    return {
      id: '',
      model: repliedModel,
      content,
      toolCalls,
      usage: {
        inputTokens: inputTokens ?? estimateTokens(conversation.map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content))).join(' ')),
        outputTokens: outputTokens ?? estimateTokens(content),
      },
    };
  };
}

/**
 * A tool call's arguments as an object. A malformed payload must not take the whole
 * reply down: the tool then reports its own missing-argument error, which the model
 * can read and correct.
 * @param {string} [json]
 * @returns {Record<string, any>}
 */
function parseArguments(json) {
  try {
    const parsed = JSON.parse(json || '{}');
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
