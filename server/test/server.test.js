import assert from 'node:assert/strict';
import { handleRequest } from '../src/app.js';
import { canConsume, usageStatus } from '../src/usage.js';

const fixedNow = () => new Date('2026-10-24T12:00:00.000Z');

const health = await handleRequest(new Request('https://cloud.example.com/api/health'), { now: fixedNow });
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  ok: true,
  service: 'zuri-cloud',
  time: '2026-10-24T12:00:00.000Z',
});

const plans = await handleRequest(new Request('https://cloud.example.com/api/plans'));
assert.equal(plans.status, 200);
const planBody = await plans.json();
assert.equal(planBody.ok, true);
assert.deepEqual(planBody.data.map((plan) => plan.code), ['free', 'starter', 'pro', 'power']);
assert.equal(planBody.data[1].currency, 'NGN');
assert.equal(planBody.data[1].amountKobo, 250_000);

const missing = await handleRequest(new Request('https://cloud.example.com/api/unknown'));
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error.code, 'NOT_FOUND');

const usage = usageStatus({ code: 'starter', monthlyTokens: 2_000_000 }, 1_650_001);
assert.deepEqual(usage, {
  planCode: 'starter',
  monthlyTokens: 2_000_000,
  usedTokens: 1_650_001,
  remainingTokens: 349_999,
  percentUsed: 83,
  overQuota: false,
  nearLimit: true,
});
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 349_999), { allowed: true, reason: 'ok' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 350_000), { allowed: false, reason: 'quota_exceeded' });
assert.deepEqual(canConsume({ monthlyTokens: 2_000_000 }, 1_650_001, 'bad'), { allowed: false, reason: 'invalid_tokens' });

console.log('PASS server contract');
