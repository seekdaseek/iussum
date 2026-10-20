// S1: one receipt per tx_sig in the gate. S2: native-mint grants are refused.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { validateMandate } from '@iussum/core';
import { A, T0, mandate } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
test('S1 a facilitator that reports success twice for one transaction: both responses carry the identical receipt', async (tc) => {
  const facilitator = await startMockFacilitator({ fixedTx: 'DUPLICATE'.padEnd(88, 'x') });
  let n = 0;
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000 + n++, price: '10000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => T0 + 1000 });
  const r1 = await a.fetch(seller.url), r2 = await a.fetch(seller.url);
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  const h1 = r1.headers.get('x-iussum-receipt'), h2 = r2.headers.get('x-iussum-receipt');
  assert.ok(h1 && h2); assert.equal(h1, h2, 'the stored receipt bytes are returned again');
});
test('S2 a mandate whose asset is the native mint is refused', () => {
  const e = validateMandate(mandate({ asset: 'So11111111111111111111111111111111111111112' }));
  assert.equal(e.length, 1, JSON.stringify(e)); assert.match(e[0], /native/i);
});
test('S2 an ordinary mint is accepted', () => assert.deepEqual(validateMandate(mandate({ asset: A.asset })), []));
