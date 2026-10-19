// N3 (review v2-new.mjs, v2-new3.mjs): a delegate self-transfer does not lower the allowance and moves nothing, so it is neither a debit nor a credit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandate, SRC, A } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service, selfTransfer } from './helpers.mjs';
import { parseDebits } from '@iussum/core';

const M = mandate({ nonce: 'a3'.repeat(16) });
const G = sig('G');
for (const kind of ['transferChecked', 'transfer']) {
  test(`N3 after one agent self-transfer (${kind}) an in-scope P1 and an out-of-scope P2 are still judged`, async () => {
    const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P1', payAt(1100, { amount: '10000' }));
    c.add('SELF', selfTransfer(kind, { slot: 1150 }));
    c.add('P2', payAt(1200, { amount: '10000', payTo: A.sellerC })); c.setAccount(SRC, live(M));
    const { svc } = service(c);
    const v2 = await svc.dispute({ tx_sig: sig('P2'), mandate: M, grant_tx: G, receipt: null });
    const v1 = await svc.dispute({ tx_sig: sig('P1'), mandate: M, grant_tx: G, receipt: null });
    assert.equal(v2.reason, 'pay_to_not_allowed', JSON.stringify(v2)); assert.equal(v2.liable, 'agent_operator');
    assert.equal(v1.reason, 'in_scope', JSON.stringify(v1)); assert.equal(v1.liable, 'principal');
  });
  test(`N3 a disputed transaction whose only agent instruction on the source is a self-transfer (${kind}) is tx_mismatch, liable null: nothing moved`, async () => {
    const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('SELF', selfTransfer(kind, { slot: 1150 })); c.setAccount(SRC, live(M));
    const { svc, store } = service(c);
    const v = await svc.dispute({ tx_sig: sig('SELF'), mandate: M, grant_tx: G, receipt: null });
    assert.equal(v.reason, 'tx_mismatch', JSON.stringify(v)); assert.equal(v.liable, null); assert.equal(store.count(), 0);
  });
}
test('N3 parseDebits skips a transfer whose source equals its destination, but not a burn', () => {
  assert.equal(parseDebits(selfTransfer('transferChecked', { slot: 5 })).length, 0);
  assert.equal(parseDebits(selfTransfer('transfer', { slot: 5 })).length, 0);
});
