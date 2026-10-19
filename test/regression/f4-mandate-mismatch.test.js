// Finding 4: the disputer must not choose which mandate is judged. A receipt that binds a mandate id fixes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandateId } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from './chainsim.mjs';

const M1 = mandate({ nonce: '01'.repeat(16), allow: { pay_to: [A.sellerA, A.sellerC], resource_prefix: ['https://api.example.test/v1/'] } }); // older, broader: allows seller C
const M2 = mandate({ nonce: '02'.repeat(16), allow: { pay_to: [A.sellerA], resource_prefix: ['https://api.example.test/v1/'] } });          // current, narrower
const G1 = sig('G1'), G2 = sig('G2'), PAY = sig('PAY');

test('F4: a seller files first with the older broader mandate: mandate_mismatch, not stored; the principal\'s own dispute is then judged, not a duplicate', async () => {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000)); c.add('G2', grantAt(M2, 1100)); c.add('PAY', payAt(1200, { payTo: A.sellerC }));
  c.setAccount(SRC, live(M2));
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  const rc = receipt({ mandate_id: mandateId(M2), grant_tx: G2, tx_sig: PAY, pay_to: A.sellerC, settled_at: T0 + 1200 }); // seller C saw M2
  const first = await service.dispute({ tx_sig: PAY, mandate: M1, grant_tx: G1, receipt: rc });
  assert.equal(first.reason, 'mandate_mismatch'); assert.equal(first.liable, null); assert.equal(store.count(), 0);
  const second = await service.dispute({ tx_sig: PAY, mandate: M2, grant_tx: G2, receipt: rc });
  assert.notEqual(second.reason, 'duplicate_dispute');
  assert.equal(second.verdict, 'valid'); assert.equal(second.reason, 'pay_to_not_allowed'); assert.equal(second.liable, 'seller');
});
