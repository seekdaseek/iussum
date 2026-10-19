// B1 (review d1-history.mjs): the spend history must count EVERY debit the agent made out of the granted account, reconcile each transaction
// against the balance change, and never report a history complete that it could not read. A debit that cannot have gone through x402
// (a plain Transfer, a burn, a CPI debit, two debits in one transaction) is the agent operator's: debit_not_x402.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandateId } from '@iussum/core';
import { A, T0, SRC, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service, debitTx } from './helpers.mjs';

const M = mandate({ per_payment_max: '50000', period_budget: '100000', nonce: 'cd'.repeat(16) });
const G = sig('G');

async function run(kind) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000));
  const hSlot = kind === 'sameSlotAsGrant' ? 1000 : 1001;
  c.add('H', ['control', 'unreadable', 'sameSlotAsGrant'].includes(kind) ? payAt(hSlot, { amount: '50000' }) : debitTx(kind, { slot: hSlot }));
  c.add('P1', payAt(1002, { amount: '40000' }));
  c.add('P2', payAt(1003, { amount: '20000' }));
  c.setAccount(SRC, live(M));
  if (kind === 'unreadable') { const orig = c.getTransaction.bind(c); c.getTransaction = async (s) => (s === sig('H') ? null : orig(s)); }
  const { svc, store } = service(c);
  const rc = receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('P2'), amount: '20000', settled_at: T0 + 1003 });
  const v2 = await svc.dispute({ tx_sig: sig('P2'), mandate: M, grant_tx: G, receipt: rc });
  const vh = await svc.dispute({ tx_sig: sig('H'), mandate: M, grant_tx: G, receipt: null });
  return { v2, vh, store };
}

test('B1 control: a plain x402-shaped payment as the earlier debit: P2 crosses the budget, agent operator', async () => {
  const { v2, vh } = await run('control');
  assert.equal(v2.reason, 'period_over_budget'); assert.equal(v2.liable, 'agent_operator'); assert.equal(v2.verdict, 'valid');
  assert.equal(vh.reason, 'in_scope'); assert.equal(vh.liable, 'principal');
});
for (const kind of ['transfer', 'burnChecked', 'burn', 'cpi', 'twoTransfers']) {
  test(`B1 hidden debit as ${kind}: the later payment is still period_over_budget (agent operator) and the debit itself is debit_not_x402`, async () => {
    const { v2, vh } = await run(kind);
    assert.equal(v2.reason, 'period_over_budget', JSON.stringify(v2)); assert.equal(v2.liable, 'agent_operator');
    assert.equal(vh.verdict, 'valid'); assert.equal(vh.reason, 'debit_not_x402', JSON.stringify(vh)); assert.equal(vh.liable, 'agent_operator');
    assert.ok(vh.delta.length >= 1 && vh.delta.every((d) => d.code === 'debit_not_x402'), 'the delta lists each debit');
  });
}
test('B1 an unreadable transaction in the history makes the later payment history_incomplete, never in_scope; nothing is stored', async () => {
  const { v2, vh, store } = await run('unreadable');
  assert.equal(v2.reason, 'history_incomplete', JSON.stringify(v2)); assert.equal(v2.liable, null);
  assert.match(JSON.stringify(v2.delta), new RegExp(sig('H').slice(0, 20)), 'the reason names the signature');
  assert.equal(vh.reason, 'tx_not_found'); assert.equal(vh.liable, null); assert.equal(store.count(), 0);
});
test('B1 a debit in the grant\'s own slot, after the grant, counts (position, not slot)', async () => {
  const { v2 } = await run('sameSlotAsGrant');
  assert.equal(v2.reason, 'period_over_budget'); assert.equal(v2.liable, 'agent_operator');
});
test('B1 reconcile: a transaction whose balance drop no parsed instruction explains makes the history incomplete and names the signature', async () => {
  const { v2, vh } = await run('unparsed');
  assert.equal(v2.reason, 'history_incomplete', JSON.stringify(v2)); assert.equal(v2.liable, null);
  assert.match(JSON.stringify(v2.delta), new RegExp(sig('H').slice(0, 20)));
  assert.equal(vh.liable, null); assert.equal(vh.reason, 'history_incomplete');
});
