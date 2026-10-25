// Temporary local preview server for the Zuri Cloud web UI.
// Serves server/public plus sample API responses so the signed-in views can be reviewed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'server', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const plans = [
  { code: 'starter', name: 'Starter', currency: 'NGN', amountKobo: 250000, monthlyTokens: 2000000 },
  { code: 'pro', name: 'Pro', currency: 'NGN', amountKobo: 600000, monthlyTokens: 6000000 },
  { code: 'power', name: 'Power', currency: 'NGN', amountKobo: 1500000, monthlyTokens: 12000000 },
  { code: 'max', name: 'Max', currency: 'NGN', amountKobo: 4000000, monthlyTokens: 40000000 },
];
const usage = { planCode: 'pro', monthlyTokens: 6000000, usedTokens: 4050000, remainingTokens: 1950000, percentUsed: 68, overQuota: false, nearLimit: false };
const subscription = { id: 'sub-1', planCode: 'pro', planName: 'Pro', monthlyTokens: 6000000, currentPeriodStart: '2026-10-01T00:00:00.000Z', currentPeriodEnd: '2026-11-01T00:00:00.000Z' };

// Sample admin report; PREVIEW_ADMIN=1 makes the sample account an administrator.
const isAdmin = process.env.PREVIEW_ADMIN === '1';
const adminOverview = {
  days: 30, nairaPerUsd: 1600, users: 128, revenueKobo: 18_500_000, costKobo: 4_120_000, marginKobo: 14_380_000,
  models: [
    { code: 'zuri-flash', name: 'Zuri Flash', supplier: 'deepseek', supplierModel: 'deepseek-flash', inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28, quotaWeight: 1, minPlan: 'starter', rateFactor: 1, isActive: true, sortOrder: 1 },
    { code: 'zuri-pro', name: 'Zuri Pro', supplier: 'moonshot', supplierModel: 'kimi-k3', inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5, quotaWeight: 5, minPlan: 'starter', rateFactor: 0.5, isActive: true, sortOrder: 2 },
    { code: 'zuri-max', name: 'Zuri Max', supplier: 'zai', supplierModel: 'glm-5.3', inputUsdPerMillion: 1.5, outputUsdPerMillion: 6, quotaWeight: 12, minPlan: 'pro', rateFactor: 0.25, isActive: false, sortOrder: 3 },
  ],
  spendByModel: [
    { modelCode: 'zuri-pro', requests: 5200, inputTokens: 9_000_000, outputTokens: 3_000_000, quotaTokens: 60_000_000, costMicroUsd: 1_900_000_000, costKobo: 3_040_000 },
    { modelCode: 'zuri-flash', requests: 21000, inputTokens: 40_000_000, outputTokens: 12_000_000, quotaTokens: 52_000_000, costMicroUsd: 675_000_000, costKobo: 1_080_000 },
  ],
  plans: [
    { code: 'starter', name: 'Starter', amountKobo: 250000, monthlyTokens: 2000000, subscribers: 22, limits: { requestsPerMinute: 30, maxConcurrent: 2 } },
    { code: 'pro', name: 'Pro', amountKobo: 600000, monthlyTokens: 6000000, subscribers: 12, limits: { requestsPerMinute: 60, maxConcurrent: 3 } },
    { code: 'power', name: 'Power', amountKobo: 1500000, monthlyTokens: 12000000, subscribers: 3, limits: { requestsPerMinute: 120, maxConcurrent: 4 } },
    { code: 'max', name: 'Max', amountKobo: 4000000, monthlyTokens: 40000000, subscribers: 1, limits: { requestsPerMinute: 240, maxConcurrent: 8 } },
  ],
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8') || '{}';
}

function json(response, data) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ ok: true, data }));
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/api/plans') return json(response, plans);
  if (url.pathname === '/api/admin/overview') return json(response, adminOverview);
  if (url.pathname === '/api/admin/models') return json(response, JSON.parse(await readBody(request)));
  if (url.pathname === '/api/public-config') return json(response, { googleClientId: '' });
  if (url.pathname === '/api/me') return json(response, { user: { id: 'u1', email: 'adedayo@example.com', displayName: 'Adedayo Balogun', status: 'active', isAdmin, createdAt: '2026-08-14T09:20:00.000Z' }, subscription });
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
