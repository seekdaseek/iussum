// Finding 2: period history must be complete, and a partial history must never produce in_scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandateId } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from './chainsim.mjs';

const M = mandate({ per_payment_max: '5000', period_budget: '100000', total_cap: '1000000', nonce: '0a'.repeat(16) }); // 100 payments of 1000 fit, the 101st crosses
const G = sig('G');
function build(n = 260, { failPage = null, hideFromHistory = null } = {}) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000));
  for (let i = 1; i <= n; i++) c.add(`PAY${i}`, payAt(1000 + i, { amount: '1000' }));
  c.setAccount(SRC, live(M));
  if (failPage) c.failPage = failPage;
  if (hideFromHistory) { const orig = c.getSignaturesForAddress.bind(c); c.getSignaturesForAddress = async (a, o) => (await orig(a, o)).filter((x) => x.signature !== sig(hideFromHistory)); }
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 99999 });
  const dispute = (i) => service.dispute({ tx_sig: sig(`PAY${i}`), mandate: M, grant_tx: G, receipt: receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig(`PAY${i}`), amount: '1000', settled_at: T0 + 1000 + i }) });
  return { c, store, dispute };
}

test('F2: the payment that crosses the budget is period_over_budget even when 160 newer payments follow it', async () => {
  const t = build();
  const v = await t.dispute(101); // cumulative 101000 > 100000
  assert.equal(v.reason, 'period_over_budget'); assert.equal(v.liable, 'agent_operator'); assert.equal(v.verdict, 'valid');
});
test('F2: payment 100 (exactly at the budget) is still in scope', async () => {
  const t = build();
  const v = await t.dispute(100);
  assert.equal(v.reason, 'in_scope'); assert.equal(v.liable, 'principal');
});
test('F2: a disputed payment that is not in the history window yields history_incomplete, liable null, not stored (never in_scope)', async () => {
  const t = build(260, { hideFromHistory: 'PAY5' });
  const v = await t.dispute(5);
  assert.equal(v.reason, 'history_incomplete'); assert.equal(v.liable, null); assert.equal(t.store.count(), 0);
});
test('F2: if a history page cannot be read, completeness cannot be shown: history_incomplete, liable null, not stored, resubmittable', async () => {
  const t = build(260, { failPage: 2 });
  const v = await t.dispute(101);
  assert.equal(v.reason, 'history_incomplete'); assert.equal(v.liable, null); assert.equal(t.store.count(), 0);
});
