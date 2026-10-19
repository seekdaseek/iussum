// Finding 3: with no receipt the chain alone still proves some violations; R3 says the agent operator bears them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from './chainsim.mjs';

const M = mandate({ nonce: '0b'.repeat(16) }); // allows seller A and B only
const G = sig('G');
function build(payOpts) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000)); c.add('PAY', payAt(1100, payOpts)); c.setAccount(SRC, live(M));
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  return { store, dispute: (b = {}) => service.dispute({ tx_sig: sig('PAY'), mandate: M, grant_tx: G, receipt: null, ...b }) };
}
test('F3: no receipt, pay_to outside the mandate: valid, agent_operator, resource unjudged', async () => {
  const v = await build({ payTo: A.sellerC }).dispute();
  assert.equal(v.verdict, 'valid'); assert.equal(v.reason, 'pay_to_not_allowed'); assert.equal(v.liable, 'agent_operator');
  assert.deepEqual(v.unjudged, ['resource']);
});
test('F3: no receipt, amount over the cap: valid, agent_operator', async () => {
  const v = await build({ amount: '60000' }).dispute();
  assert.equal(v.verdict, 'valid'); assert.equal(v.reason, 'amount_over_cap'); assert.equal(v.liable, 'agent_operator');
});
test('F3: no receipt, nothing the chain can prove is wrong: invalid, principal, resource unjudged', async () => {
  const v = await build({}).dispute();
  assert.equal(v.verdict, 'invalid'); assert.equal(v.reason, 'in_scope'); assert.equal(v.liable, 'principal');
  assert.deepEqual(v.unjudged, ['resource']);
});
test('F3: no receipt and no mandate is still mandate_missing, liable null', async () => {
  const v = await build({}).dispute({ mandate: null });
  assert.equal(v.reason, 'mandate_missing'); assert.equal(v.liable, null);
});
