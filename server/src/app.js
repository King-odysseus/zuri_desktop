import { PLANS, publicPlan } from './plans.js';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

/** @param {unknown} value @returns {string} */
function json(value) {
  return JSON.stringify(value);
}

/**
 * Handle the public HTTP contract without binding the tests to a live Railway
 * process. Authenticated routes are intentionally not present until sessions
 * and Google identity verification are implemented in the next slice.
 * @param {Request} request
 * @param {{ now?: () => Date }} [dependencies]
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, dependencies = {}) {
  const url = new URL(request.url);
  const now = dependencies.now ?? (() => new Date());

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return new Response(json({ ok: true, service: 'zuri-cloud', time: now().toISOString() }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/plans') {
    return new Response(json({ ok: true, data: PLANS.map(publicPlan) }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  return new Response(json({ ok: false, error: { code: 'NOT_FOUND', message: 'That endpoint does not exist.' } }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}
