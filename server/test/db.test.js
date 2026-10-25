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
