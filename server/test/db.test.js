import assert from 'node:assert/strict';
import { createRepository } from '../src/db.js';

const queries = [];
const client = {
  async query(text, values = []) {
    queries.push({ text, values });
    if (text.startsWith('SELECT id, subscription_id')) {
      return { rows: [{ id: 'reservation-1', subscription_id: 'subscription-1', reserved_tokens: '2000', status: 'reserved' }] };
    }
    return { rows: [] };
  },
  release() {},
};
const repository = createRepository({ connect: async () => client });

await repository.commitUsage({
  reservationId: 'reservation-1',
  userId: 'user-1',
  model: 'gpt-5.3-codex',
  modelCode: 'zuri-code',
  supplier: 'openai',
  inputTokens: 100,
  outputTokens: 50,
  quotaTokens: 1_500,
  costMicroUsd: 875,
  requestId: 'request-1',
});

const insert = queries.find((entry) => entry.text.startsWith('INSERT INTO usage_events'));
assert.ok(insert, 'usage events should be inserted');
assert.match(insert.text, /provider, model, model_code, input_tokens, output_tokens, quota_tokens, cost_micro_usd, request_id/);
assert.deepEqual(insert.values, ['user-1', 'subscription-1', 'openai', 'gpt-5.3-codex', 'zuri-code', 100, 50, 1500, 875, 'request-1']);

console.log('PASS database usage event fields');

// A top-up is granted, not subscribed: the pack adds tokens and nothing else,
// so a customer who buys extra usage keeps the plan they already pay for.
const topupQueries = [];
const topupClient = {
  async query(text, values = []) {
    topupQueries.push({ text, values });
    if (text.startsWith('SELECT p.*, u.email')) {
      return {
        rows: [{
          id: 'payment-2',
          user_id: 'user-1',
          plan_code: null,
          kind: 'topup',
          pack_code: 'topup-medium',
          tokens_granted: '3000000',
          amount_kobo: '420000',
          status: 'initialized',
          email: 'user@example.com',
        }],
      };
    }
    return { rows: [] };
  },
  release() {},
};
const topupRepository = createRepository({ connect: async () => topupClient });
const granted = await topupRepository.applySuccessfulPayment({
  reference: 'zuri-topup-1',
  transaction: { id: 77, status: 'success', reference: 'zuri-topup-1', amount: 420_000, currency: 'NGN', customer: { email: 'user@example.com' } },
});
assert.equal(granted.applied, true);
assert.equal(granted.packCode, 'topup-medium');
assert.equal(granted.tokensGranted, 3_000_000);
const credit = topupQueries.find((entry) => entry.text.startsWith('INSERT INTO usage_credits'));
assert.ok(credit, 'the pack should be granted');
assert.deepEqual(credit.values.slice(0, 4), ['user-1', 'payment-2', 'topup-medium', 3_000_000]);
assert.equal(credit.values[4], 90, 'the pack expires after 90 days');
assert.ok(topupQueries.some((entry) => entry.text === 'COMMIT'), 'the grant commits');
assert.ok(!topupQueries.some((entry) => entry.text.startsWith('UPDATE subscriptions')), 'a top-up never changes the plan');

console.log('PASS database top-up grants tokens only');
