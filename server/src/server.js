import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { handleRequest } from './app.js';

const config = readConfig();

/**
 * Adapt Node's incoming request to the Fetch Request contract used by the app
 * handler. Keeping this edge thin makes route tests fast and avoids a framework
 * dependency before authenticated routes need one.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {Promise<void>}
 */
async function serve(request, response) {
  const protocol = request.headers['x-forwarded-proto'] ?? 'http';
  const host = request.headers.host ?? `127.0.0.1:${config.port}`;
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request;

  try {
    const result = await handleRequest(new Request(`${protocol}://${host}${request.url ?? '/'}`, {
      method: request.method,
      headers: request.headers,
      body,
      duplex: body ? 'half' : undefined,
    }));
    response.statusCode = result.status;
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(await result.text());
  } catch (error) {
    console.error('[zuri-cloud] request', error);
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'The server could not complete that request.' } }));
  }
}

createServer((request, response) => {
  void serve(request, response);
}).listen(config.port, '0.0.0.0', () => {
  console.log(`[zuri-cloud] listening on ${config.port}`);
});
