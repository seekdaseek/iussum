// N1 (review v2-new.mjs, v2-new3.mjs): the allowance cross-check compares ALL debits since the grant, so the history it is fed must reach the grant;
// it must not be cut at the start of the period of the disputed payment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { mandateId } from '@iussum/core';
import { A, T0, SRC, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';
import { service, dustCredit } from './helpers.mjs';

const M = mandate({ per_payment_max: '1000', period_budget: '100000', nonce: 'a1'.repeat(16) });
const G = sig('G');
for (const n of [50, 150]) {
  test(`N1 ${n} in-scope payments in period 0, then an honest in-scope payment in period 1: in_scope, principal`, async () => {
    const c = chainSim(); c.add('G', grantAt(M, 1000));
    for (let i = 1; i <= n; i++) c.add(`P${i}`, payAt(1000 + i, { amount: '100' }));
    c.add('Z', payAt(90000, { amount: '100' })); c.setAccount(SRC, live(M));
    const { svc } = service(c);
    const v = await svc.dispute({ tx_sig: sig('Z'), mandate: M, grant_tx: G, receipt: receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('Z'), amount: '100', settled_at: T0 + 90000 }) });
    assert.equal(v.reason, 'in_scope', JSON.stringify(v)); assert.equal(v.liable, 'principal');
  });
}
test('N1 anyone can push the history past one page with dust credits; an honest payment is still judged', async () => {
  const c = chainSim(); c.add('G', grantAt(M, 1000));
  for (let i = 1; i <= 5; i++) c.add(`P${i}`, payAt(1000 + i, { amount: '100' })); // honest, period 0
  for (let i = 1; i <= 150; i++) c.add(`D${i}`, dustCredit(2000 + i)); // a stranger's dust, newer, still period 0
  c.add('Z', payAt(90000, { amount: '100' })); c.setAccount(SRC, live(M)); // honest, period 1
  const { svc } = service(c);
  const v = await svc.dispute({ tx_sig: sig('Z'), mandate: M, grant_tx: G, receipt: receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('Z'), amount: '100', settled_at: T0 + 90000 }) });
  assert.equal(v.reason, 'in_scope', JSON.stringify(v));
});
test('N1 an honest agent restarted in period 1 after 150 in-scope payments in period 0 still pays', async (tc) => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 90000, price: '100' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { per_payment_max: '1000', period_budget: '100000' } });
  const c = chainSim(); c.add('G', grantAt(s.mandate, 1000));
  for (let i = 1; i <= 150; i++) c.add(`P${i}`, payAt(1000 + i, { amount: '100', authority: s.signer.address }));
  c.setAccount(SRC, live(s.mandate)); c.setAccount(A.asset, { data: { parsed: { info: { decimals: 6 } } } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: G, signer: s.signer, rpc: c, getBlockhash: blockhash, now: () => T0 + 90000 });
  assert.equal((await a.fetch(seller.url)).status, 200);
});
