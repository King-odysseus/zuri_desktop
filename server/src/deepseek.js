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
