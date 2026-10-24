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
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error('[zuri-cloud] request', error);
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'The server could not complete that request.' } }));
    }
  };
}
