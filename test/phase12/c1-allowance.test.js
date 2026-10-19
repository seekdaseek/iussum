// C1: while the grant is current, the agent's debits since the grant must add up to total_cap minus the source account's current
// delegated amount. A debit the history missed, whatever the cause, shows up as a mismatch: history_incomplete, both numbers in the delta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { mandateId } from '@iussum/core';
import { A, T0, SRC, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';
import { service } from './helpers.mjs';

const M = mandate({ per_payment_max: '50000', period_budget: '100000', total_cap: '1000000', nonce: 'c1'.repeat(16) });
const G = sig('G');
function build({ hide = null } = {}) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000)); c.add('H', payAt(1001, { amount: '30000' })); c.add('P', payAt(1002, { amount: '10000' }));
  c.setAccount(SRC, live(M)); // the allowance on the account follows the real chain: 1000000 - 40000
  if (hide) c.hideFromListing.add(sig(hide)); // the node's signature listing omits a transaction (cause irrelevant)
  return { c, ...service(c) };
}
const dispute = (t) => t.svc.dispute({ tx_sig: sig('P'), mandate: M, grant_tx: G, receipt: receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('P'), amount: '10000', settled_at: T0 + 1002 }) });
test('C1 control: the history adds up to the allowance that is gone: judged', async () => {
  const v = await dispute(build());
  assert.equal(v.reason, 'in_scope'); assert.equal(v.liable, 'principal');
});
test('C1 a debit missing from the history: history_incomplete with both numbers, liable null, not stored', async () => {
  const t = build({ hide: 'H' });
  const v = await dispute(t);
  assert.equal(v.reason, 'history_incomplete', JSON.stringify(v)); assert.equal(v.liable, null); assert.equal(t.store.count(), 0);
  const d = JSON.stringify(v.delta);
  assert.match(d, /40000/, 'expected (cap minus what is left)'); assert.match(d, /10000/, 'found in the history');
});
test('C1 an allowance that ran out (delegate cleared by the token program) is 0 left: the debits must add up to the whole cap', async () => {
  const m = mandate({ per_payment_max: '30000', period_budget: '100000', total_cap: '40000', nonce: 'c2'.repeat(16) });
  const c = chainSim();
  c.add('G', grantAt(m, 1000)); c.add('H', payAt(1001, { amount: '30000' })); c.add('P', payAt(1002, { amount: '10000' }));
  c.setAccount(SRC, { data: { parsed: { info: { owner: m.principal, mint: m.asset, delegate: null, delegatedAmount: { amount: '0' } } } } });
  const { svc } = service(c);
  const v = await svc.dispute({ tx_sig: sig('P'), mandate: m, grant_tx: G, receipt: receipt({ mandate_id: mandateId(m), grant_tx: G, tx_sig: sig('P'), amount: '10000', settled_at: T0 + 1002 }) });
  assert.equal(v.reason, 'in_scope', JSON.stringify(v));
});
test('C1 the agent\'s ledger rebuild uses the same check: a restarted agent whose history misses a debit refuses to pay (history_incomplete)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 1000, price: '10000' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000', total_cap: '1000000' } });
  const c = chainSim();
  c.add('G', grantAt(s.mandate, 1000)); c.add('H', payAt(1001, { amount: '30000', authority: s.signer.address }));
  c.setAccount(SRC, live(s.mandate)); c.hideFromListing.add(sig('H'));
  const agentRpc = { ...c, getTransaction: c.getTransaction, getSignaturesForAddress: c.getSignaturesForAddress, getAccountInfoParsed: c.getAccountInfoParsed, getAccountContext: c.getAccountContext, getBlockSignatures: c.getBlockSignatures, call: seller.rpc.call };
  const a = await createAgent({ mandate: s.mandate, grant_tx: sig('G'), signer: s.signer, rpc: agentRpc, getBlockhash: blockhash, now: () => T0 + 1000 });
  await assert.rejects(() => a.fetch(seller.url), (e) => e.reason === 'history_incomplete');
  facilitator.close(); seller.close();
});
