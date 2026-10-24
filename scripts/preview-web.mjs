// Temporary local preview server for the Zuri Cloud web UI.
// Serves server/public plus sample API responses so the signed-in views can be reviewed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'server', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const plans = [
  { code: 'free', name: 'Free', currency: 'NGN', amountKobo: 0, monthlyTokens: 100000 },
  { code: 'starter', name: 'Starter', currency: 'NGN', amountKobo: 250000, monthlyTokens: 2000000 },
  { code: 'pro', name: 'Pro', currency: 'NGN', amountKobo: 600000, monthlyTokens: 6000000 },
  { code: 'power', name: 'Power', currency: 'NGN', amountKobo: 1500000, monthlyTokens: 12000000 },
];
const usage = { planCode: 'pro', monthlyTokens: 6000000, usedTokens: 4050000, remainingTokens: 1950000, percentUsed: 68, overQuota: false, nearLimit: false };
const subscription = { id: 'sub-1', planCode: 'pro', planName: 'Pro', monthlyTokens: 6000000, currentPeriodStart: '2026-10-01T00:00:00.000Z', currentPeriodEnd: '2026-11-01T00:00:00.000Z' };

function json(response, data) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: true, data }));
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/plans') return json(response, plans);
  if (url.pathname === '/api/public-config') return json(response, { googleClientId: '' });
  if (url.pathname === '/api/me') return json(response, { user: { id: 'u1', email: 'adedayo@example.com', displayName: 'Adedayo Balogun', status: 'active', isAdmin: false, createdAt: '2026-08-14T09:20:00.000Z' }, subscription });
  if (url.pathname === '/api/me/usage') return json(response, usage);
  if (url.pathname === '/api/me/limits') return json(response, { planCode: 'pro', limits: { requestsPerMinute: 60, maxConcurrent: 3, maxInputTokens: 32000, maxOutputTokens: 4000 }, usage });
  if (url.pathname === '/api/me/billing') return json(response, {
    subscription: { id: 'sub-1', plan_code: 'pro', status: 'active' },
    payments: [
      { reference: 'ZURI-9F3K21', plan_code: 'pro', amount_kobo: 600000, currency: 'NGN', status: 'success', paid_at: '2026-10-01T08:12:00.000Z' },
      { reference: 'ZURI-7T2M55', plan_code: 'starter', amount_kobo: 250000, currency: 'NGN', status: 'success', paid_at: '2026-09-01T07:45:00.000Z' },
    ],
  });
  if (url.pathname === '/api/billing/checkout') return json(response, { authorizationUrl: '#' });

  const name = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  const filePath = path.resolve(ROOT, name);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(400).end('bad path');
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(8099, '127.0.0.1', () => console.log('preview on http://127.0.0.1:8099'));
