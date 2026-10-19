// N5 (review v2-new2.mjs): a balance entry missing on one side (the account was created or closed in that transaction) counts as 0. Closing the
// emptied source account must not make earlier payments unjudgeable for good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { A, T0, SRC, mandate, payTx } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig, tokenIx } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

const M = mandate({ nonce: 'a5'.repeat(16) });
const G = sig('G');
function chain({ close }) {
  const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P', payAt(1100, { amount: '10000', payTo: A.sellerC }));
  if (close) {
    c.add('EMPTY', payTx({ slot: 1200, blockTime: T0 + 1200, authority: A.principal, payTo: A.sellerB, amount: '4990000' })); // the principal moves the rest out
    const ct = tokenIx('closeAccount', { account: SRC, destination: A.principal, owner: A.principal }, 1201);
    ct.meta.preTokenBalances = [{ accountIndex: 1, mint: A.asset, owner: A.principal, uiTokenAmount: { amount: '0', decimals: 6 } }]; ct.meta.postTokenBalances = [];
    c.add('CLOSE', ct);
  }
  c.setAccount(SRC, close ? null : live(M));
  return c;
}
for (const close of [false, true]) {
  test(`N5 ${close ? 'the principal later empties and closes the account' : 'control'}: the earlier out-of-scope payment is still pay_to_not_allowed, agent operator`, async () => {
    const { svc } = service(chain({ close }));
    const v = await svc.dispute({ tx_sig: sig('P'), mandate: M, grant_tx: G, receipt: null });
    assert.equal(v.reason, 'pay_to_not_allowed', JSON.stringify(v)); assert.equal(v.liable, 'agent_operator');
  });
}
test('N5 an account created in the transaction (no pre balance) counts as 0 before; a real mismatch still fails closed', async () => {
  const { parsePayment, reconcileAccount } = await import('@iussum/core');
  const created = payTx({ slot: 5, amount: '10', moved: 0 }); created.meta.preTokenBalances = []; created.meta.postTokenBalances = [{ accountIndex: 2, mint: A.asset, owner: A.principal, uiTokenAmount: { amount: '0', decimals: 6 } }];
  assert.equal(reconcileAccount({ ...parsePayment(created), debits: [], credits: [] }, SRC).ok, true);
  const bad = payTx({ slot: 5, amount: '10', moved: 0 }); bad.meta.preTokenBalances = []; bad.meta.postTokenBalances = [{ accountIndex: 2, mint: A.asset, owner: A.principal, uiTokenAmount: { amount: '7', decimals: 6 } }];
  assert.equal(reconcileAccount({ ...parsePayment(bad), debits: [], credits: [] }, SRC).ok, false, 'funds appeared from nowhere');
});
