/**
 * Keep provider-specific HTTP details outside the route handler. The app only
 * receives normalized content and usage, so quota accounting stays provider
 * agnostic if another OpenAI-compatible backend is added later.
 */
export function createDeepSeekClient({ apiKey, endpoint, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null;
  const target = typeof endpoint === 'string' && endpoint.trim() !== ''
    ? endpoint.trim()
    : 'https://api.deepseek.com/chat/completions';

  return async function complete({ messages, model, maxTokens, signal }) {
    const result = await fetchImpl(target, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false }),
      signal,
    });
    if (!result.ok) {
      const error = new Error('The AI provider rejected the request.');
      error.code = 'PROVIDER_REQUEST_FAILED';
      error.status = result.status;
      throw error;
    }
    const payload = await result.json();
    const message = payload?.choices?.[0]?.message?.content;
    if (typeof message !== 'string') {
      const error = new Error('The AI provider returned an incomplete response.');
      error.code = 'PROVIDER_RESPONSE_INVALID';
      throw error;
    }
    const inputTokens = Number(payload?.usage?.prompt_tokens);
    const outputTokens = Number(payload?.usage?.completion_tokens);
    return {
      id: typeof payload?.id === 'string' ? payload.id : '',
      model: typeof payload?.model === 'string' ? payload.model : model,
      content: message,
      usage: {
        inputTokens: Number.isFinite(inputTokens) && inputTokens >= 0 ? Math.floor(inputTokens) : 0,
        outputTokens: Number.isFinite(outputTokens) && outputTokens >= 0 ? Math.floor(outputTokens) : 0,
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

  return async function complete({ messages, model, maxTokens, signal }) {
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const conversation = messages.filter((message) => message.role !== 'system');
    const result = await fetchImpl(target, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: conversation }),
      signal,
    });
    if (!result.ok) {
      const error = new Error('The AI provider rejected the request.');
      error.code = 'PROVIDER_REQUEST_FAILED';
      error.status = result.status;
      throw error;
    }
    const payload = await result.json();
    const content = Array.isArray(payload?.content)
      ? payload.content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
      : '';
    if (content === '') {
      const error = new Error('The AI provider returned an incomplete response.');
      error.code = 'PROVIDER_RESPONSE_INVALID';
      throw error;
    }
    return {
      id: typeof payload?.id === 'string' ? payload.id : '',
      model: typeof payload?.model === 'string' ? payload.model : model,
      content,
      usage: {
        inputTokens: Number.isFinite(Number(payload?.usage?.input_tokens)) ? Math.floor(Number(payload.usage.input_tokens)) : 0,
        outputTokens: Number.isFinite(Number(payload?.usage?.output_tokens)) ? Math.floor(Number(payload.usage.output_tokens)) : 0,
      },
    };
  };
}
