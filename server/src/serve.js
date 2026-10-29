/**
 * The single place where the Fetch-style app meets Node's HTTP server.
 *
 * Response bodies are copied as bytes: `Response.text()` decodes as UTF-8, so
 * a PNG, JPEG or font came back as replacement characters, larger than the
 * file on disk and unreadable by the browser.
 */

/**
 * @param {{ app: (request: Request) => Promise<Response>, port: number }} options
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>}
 */
export function createRequestListener({ app, port }) {
  return async function serve(request, response) {
    const protocol = request.headers['x-forwarded-proto'] ?? 'http';
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request;

    try {
      const result = await app(new Request(`${protocol}://${host}${request.url ?? '/'}`, {
        method: request.method,
        headers: request.headers,
        body,
        duplex: body ? 'half' : undefined,
      }));
      response.statusCode = result.status;
      result.headers.forEach((value, name) => response.setHeader(name, value));
      const cookies = result.headers.getSetCookie?.();
      if (Array.isArray(cookies) && cookies.length > 0) response.setHeader('set-cookie', cookies);
      // Bytes, not text: see the note at the top of this file.
      //
      // Written as they arrive rather than collected first. Collecting held every
      // delta of a streamed reply until the whole answer existed, so the window sat
      // blank through the whole wait and then received the answer in one dump, which
      // is exactly the delay streaming was added to remove.
      if (!result.body) {
        response.end();
        return;
      }
      const reader = result.body.getReader();
      let gone = false;
      // A closed window or a Stop must end the read too, or the supplier keeps
      // generating into a stream nobody is listening to.
      response.on('close', () => {
        gone = true;
        reader.cancel().catch(() => {});
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (gone) return;
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        // Backpressure: a slow reader gets a pause rather than an unbounded buffer.
        if (!response.write(Buffer.from(value))) {
          await new Promise((resolve) => response.once('drain', resolve));
        }
      }
      response.end();
    } catch (error) {
      console.error('[zuri-cloud] request', error);
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'The server could not complete that request.' } }));
    }
  };
}
