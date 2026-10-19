// B3 (review d2-agent-mismatch.mjs): a payment the agent did not sign, or one made before the grant, is not under this mandate:
// tx_mismatch, liable null, nothing stored. It must not be put on the agent operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, SRC, mandate } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

const M = mandate({ nonce: 'ef'.repeat(16) });
const G = sig('G');
async function judge(build) {
  const c = chainSim(); build(c); c.setAccount(SRC, live(M));
  const { svc, store } = service(c);
  const v = await svc.dispute({ tx_sig: sig('Q'), mandate: M, grant_tx: G, receipt: null });
  return { v, store };
}
const principalPays = (slot) => payAt(slot, { authority: A.principal, payTo: A.sellerC, amount: '10000' });
test('B3 the principal\'s own transfer 100 slots BEFORE the grant is tx_mismatch, liable null, not stored', async () => {
  const { v, store } = await judge((c) => { c.add('Q', principalPays(900)); c.add('G', grantAt(M, 1000)); });
  assert.equal(v.reason, 'tx_mismatch', JSON.stringify(v)); assert.equal(v.liable, null); assert.equal(store.count(), 0);
});
test('B3 the principal\'s own transfer after the grant (not signed by the agent) is tx_mismatch, liable null, not stored', async () => {
  const { v, store } = await judge((c) => { c.add('G', grantAt(M, 1000)); c.add('Q', principalPays(1100)); });
  assert.equal(v.reason, 'tx_mismatch', JSON.stringify(v)); assert.equal(v.liable, null); assert.equal(store.count(), 0);
});
test('B3 an agent payment executed BEFORE the grant in the grant\'s own slot is tx_mismatch (position, not slot)', async () => {
  const { v, store } = await judge((c) => { c.add('Q', payAt(1000, { payTo: A.sellerC })); c.add('G', grantAt(M, 1000)); });
  assert.equal(v.reason, 'tx_mismatch', JSON.stringify(v)); assert.equal(v.liable, null); assert.equal(store.count(), 0);
});
