// S7 (review d7-sameslot-order.mjs): payments in one slot are ordered by their position in the block, never by signature string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodSpendAt, mandateId } from '@iussum/core';
import { A, T0, SRC, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

test('S7 periodSpendAt keeps the order it is given within a slot (execution order), whatever the signature strings say', () => {
  const m = mandate({ period_budget: '100000', per_payment_max: '100000' });
  const a = { tx_sig: '5zzA', slot: 1500, block_time: T0 + 1500, amount: '20000' }, b = { tx_sig: '3aaB', slot: 1500, block_time: T0 + 1500, amount: '90000' };
  const ra = periodSpendAt(m, [a, b], a.tx_sig), rb = periodSpendAt(m, [a, b], b.tx_sig);
  assert.equal(ra.over, false); assert.equal(ra.spent, 20000n);
  assert.equal(rb.over, true); assert.equal(rb.spent, 110000n);
});
const M = mandate({ period_budget: '100000', per_payment_max: '100000', total_cap: '1000000', nonce: '5a'.repeat(16) });
function build({ hideBlock = false, sameSlot = true } = {}) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000));
  c.add('5zzA', payAt(1500, { amount: '20000' })); // executed first
  c.add('3aaB', payAt(sameSlot ? 1500 : 1501, { amount: '90000' })); // executed second; its signature string sorts BEFORE A's
  c.setAccount(SRC, live(M));
  if (hideBlock) c.hiddenBlocks.add(1500);
  return { c, ...service(c) };
}
const dispute = (t, label, amount) => t.svc.dispute({ tx_sig: sig(label), mandate: M, grant_tx: sig('G'), receipt: receipt({ mandate_id: mandateId(M), grant_tx: sig('G'), tx_sig: sig(label), amount, settled_at: T0 + 1500 }) });
test('S7 resolver: A (executed first) is in scope and B (executed second) crosses the budget, although sig(B) < sig(A)', async () => {
  const t = build();
  assert.ok(sig('3aaB') < sig('5zzA'));
  const a = await dispute(t, '5zzA', '20000'), b = await dispute(t, '3aaB', '90000');
  assert.equal(a.reason, 'in_scope'); assert.equal(a.liable, 'principal');
  assert.equal(b.reason, 'period_over_budget'); assert.equal(b.liable, 'agent_operator');
  assert.ok(t.c.calls.blocks.includes(1500), 'the block was read to order the two transactions');
});
test('S7 the block is fetched only when two relevant transactions share a slot', async () => {
  const t = build({ sameSlot: false });
  await dispute(t, '3aaB', '90000');
  assert.deepEqual(t.c.calls.blocks, []);
});
test('S7 if the block cannot be read the history is incomplete (history_incomplete, liable null, not stored)', async () => {
  const t = build({ hideBlock: true });
  const b = await dispute(t, '3aaB', '90000');
  assert.equal(b.reason, 'history_incomplete'); assert.equal(b.liable, null); assert.equal(t.store.count(), 0);
});
