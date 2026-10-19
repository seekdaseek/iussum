// B2 (review d6-supersede-unreadable.mjs): a transaction the scan cannot read must not count as "does not supersede". The scan throws,
// callers fail closed, and the checker does not advance past it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker, mandateId } from '@iussum/core';
import { A, SRC, T0, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

const M1 = mandate({ total_cap: '1000000', per_payment_max: '50000', nonce: '01'.repeat(16) });
const M2 = mandate({ total_cap: '500000', per_payment_max: '20000', nonce: '02'.repeat(16) });
function chain() {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000)); c.add('G2', grantAt(M2, 1200)); c.add('P', payAt(1300, { amount: '40000' })); // 40000: inside M1, over M2's cap
  c.setAccount(SRC, live(M2));
  let hideG2 = true; const orig = c.getTransaction.bind(c);
  c.getTransaction = async (s) => (hideG2 && s === sig('G2') ? null : orig(s));
  return { c, recover: () => { hideG2 = false; }, hide: () => { hideG2 = true; } };
}
test('B2 the grant check of a superseded M1 does not pass while G2 is unreadable, and stays failed after the RPC recovers', async () => {
  const { c, recover } = chain();
  const checker = createGrantChecker(c);
  const first = await checker.check(M1, sig('G1'), { active: true });
  assert.equal(first.ok, false); assert.equal(first.reason, 'grant_inactive'); assert.match(first.detail, /could not verify/);
  recover();
  const again = await checker.check(M1, sig('G1'), { active: true });
  assert.equal(again.ok, false); assert.match(again.detail, /superseded by /);
  const fresh = await createGrantChecker(c).check(M1, sig('G1'), { active: true });
  assert.equal(fresh.ok, false);
});
test('B2 the resolver does not judge a payment under the superseded M1 while G2 is unreadable (history_incomplete, nothing stored), so the M2 dispute is not locked out', async () => {
  const { c, recover } = chain();
  const { svc, store } = service(c);
  const rc = receipt({ mandate_id: mandateId(M1), grant_tx: sig('G1'), tx_sig: sig('P'), amount: '40000', settled_at: T0 + 1300 });
  const v = await svc.dispute({ tx_sig: sig('P'), mandate: M1, grant_tx: sig('G1'), receipt: rc });
  assert.equal(v.reason, 'history_incomplete'); assert.equal(v.liable, null); assert.equal(store.count(), 0);
  recover();
  const v2 = await svc.dispute({ tx_sig: sig('P'), mandate: M2, grant_tx: sig('G2'), receipt: null });
  assert.notEqual(v2.reason, 'duplicate_dispute');
  assert.equal(v2.reason, 'amount_over_cap'); assert.equal(v2.liable, 'agent_operator');
});
test('B2 the earliest superseding transaction is chosen by position, not by signature string', async () => {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000));
  // two superseding revokes in the same slot: the one executed FIRST has the larger signature string
  const rv = (slot) => ({ slot, blockTime: T0 + slot, meta: { err: null }, transaction: { message: { accountKeys: [], instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'spl-token', parsed: { type: 'revoke', info: { source: SRC, owner: A.principal } } }] } } });
  c.add('Zfirst', rv(1100)); c.add('Asecond', rv(1100));
  c.setAccount(SRC, live(M1));
  const checker = createGrantChecker(c);
  const r = await checker.check(M1, sig('G1'), { active: true });
  assert.equal(r.ok, false); assert.match(r.detail, new RegExp(`superseded by ${sig('Zfirst')}`));
});
