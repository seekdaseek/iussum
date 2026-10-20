// M7 (Addendum M): the devnet demo's usdc() maps only "the account does not exist" to 0 and throws on anything else, so a failed read cannot pass a "balances unchanged" check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdc } from '../../scripts/demo-lib.mjs';

const ctx = (call) => ({ rpc: { call } });
test('M7 usdc(): a missing account is 0, a rate limit or any other error throws, a malformed answer throws (s16-usdc)', async () => {
  assert.equal(await usdc(ctx(async () => ({ value: { amount: '1234' } })), 'FzJq9YfJAr1Xsa7uYJ1k2bZcSq1fE8g3zRk5wH9hQvZb'), 1234n);
  assert.equal(await usdc(ctx(async () => { throw new Error('getTokenAccountBalance: Invalid param: could not find account'); }), 'FzJq9YfJAr1Xsa7uYJ1k2bZcSq1fE8g3zRk5wH9hQvZb'), 0n);
  for (const err of ['rpc http 429', 'getTokenAccountBalance: Too many requests for a specific RPC call', 'fetch failed', 'rpc http 503']) {
    await assert.rejects(() => usdc(ctx(async () => { throw new Error(err); }), 'FzJq9YfJAr1Xsa7uYJ1k2bZcSq1fE8g3zRk5wH9hQvZb'), new RegExp(err.slice(-8)), err);
  }
  await assert.rejects(() => usdc(ctx(async () => ({ value: {} })), 'FzJq9YfJAr1Xsa7uYJ1k2bZcSq1fE8g3zRk5wH9hQvZb'), /no amount/);
});
