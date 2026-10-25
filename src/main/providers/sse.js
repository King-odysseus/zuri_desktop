/**
 * sse.js - read a server-sent-events body from `/api/chat`.
 *
 * The reply is sent as `data:` frames: a `delta` for each piece of text, then one
 * `done` carrying the saved message, or one `error`. This lives in its own module
 * rather than inside main.js so the selftest can feed it frames without a network,
 * a session or an Electron window: a parser that only gets exercised against a
 * live server is a parser nobody has proven.
 */

/**
 * Turn an event-stream response into deltas plus a final answer.
 *
 * A chunk can end mid-frame and a frame can end mid-chunk, so complete lines are
 * parsed and the remainder waits for the next read. Getting this wrong shows up as
 * text that is silently dropped, which is why the split-frame case is tested.
 *
 * @param {Response} response
 * @param {(text: string) => void} onDelta
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: { code: string, message: string } }>}
 */
export async function readChatStream(response, onDelta) {
  let settled = null;
  let streamError = null;

  const handleLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const data = line.slice('data:'.length).trim();
    // "[DONE]" is the usual end marker and carries no JSON.
    if (data === '' || data === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      // Framing we do not understand is not worth failing a reply over; the
      // `done` frame is what decides whether the reply succeeded.
      return;
    }
    if (event?.type === 'delta' && typeof event.text === 'string') {
      if (event.text !== '') onDelta(event.text);
      return;
    }
    if (event?.type === 'done') {
      settled = event.data;
      return;
    }
    if (event?.type === 'error') {
      streamError = event.error ?? { code: 'CHAT_CLOUD_FAILED', message: 'Zuri could not answer. Try again.' };
    }
  };

  // A response without a readable body is possible in a test double, so fall back
  // to reading the whole thing and splitting it.
  if (!response.body || typeof response.body.getReader !== 'function') {
    for (const line of (await response.text()).split('\n')) handleLine(line);
  } else {
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

  // Both an error frame and a done frame can be present if a failure happened after
  // text was already sent. The error wins: nothing was committed for the request, so
  // the person should not be left with a half answer presented as complete.
  if (streamError) return { ok: false, error: streamError };
  if (settled === null) {
    return { ok: false, error: { code: 'CHAT_STREAM_ENDED', message: 'The reply stopped before it finished. Try again.' } };
  }
  return { ok: true, data: settled };
}
