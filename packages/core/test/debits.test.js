// Phase 1.2 units: the single debit parser, the balance reconcile, block-position comparison and the allowance cross-check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayment, parseDebits, reconcileAccount, comparePositions, fillBlockIndices, PositionUnknown, allowanceCheck } from '@iussum/core';
import { A, SRC, T0, mandate } from '../../../test/fixtures.mjs';
import { debitTx } from '../../../test/phase12/helpers.mjs';

test('parseDebits reads transfer, transferChecked, burn and burnChecked, top level and by CPI, with kind, source, destination, mint, authority and position', () => {
  const kinds = {};
  for (const k of ['transfer', 'burnChecked', 'burn', 'cpi', 'twoTransfers']) kinds[k] = parseDebits(debitTx(k, { slot: 10 }));
  assert.deepEqual(kinds.transfer.map((d) => [d.kind, d.source, d.mint, d.authority, d.top, d.destination === null]), [['transfer', SRC, A.asset, A.agent, true, false]]);
  assert.deepEqual(kinds.burnChecked.map((d) => [d.kind, d.source, d.destination, d.top]), [['burnChecked', SRC, null, true]]);
  assert.deepEqual(kinds.burn.map((d) => [d.kind, d.mint]), [['burn', A.asset]]);
  assert.deepEqual(kinds.cpi.map((d) => [d.kind, d.top]), [['transferChecked', false]]);
  assert.equal(kinds.twoTransfers.length, 2); assert.ok(kinds.twoTransfers[0].pos < kinds.twoTransfers[1].pos, 'execution order');
});
test('a CPI debit comes right after the top-level instruction that made it', () => {
  const tx = debitTx('cpi', { slot: 10 });
  const d = parseDebits(tx);
  assert.equal(d[0].pos % 10000, 1, 'first inner instruction of its parent');
});
test('reconcileAccount: parsed movement equals the balance drop, or it is a mismatch', () => {
  const ok = parsePayment(debitTx('transfer', { slot: 10 }));
  assert.deepEqual({ ...reconcileAccount(ok, SRC) }, { ok: true, moved: 50000n, dropped: 50000n });
  const bad = parsePayment(debitTx('unparsed', { slot: 10 }));
  const r = reconcileAccount(bad, SRC);
  assert.equal(r.ok, false); assert.equal(r.moved, 0n); assert.equal(r.dropped, 50000n);
});
test('comparePositions: slot first, then block index, then instruction position; an unknown order throws', () => {
  assert.ok(comparePositions({ slot: 1, tx_sig: 'a' }, { slot: 2, tx_sig: 'b' }) < 0);
  assert.ok(comparePositions({ slot: 5, tx_sig: 'z' }, { slot: 5, tx_sig: 'a' }, { z: 0, a: 1 }) < 0, 'z executed first although its string sorts last');
  assert.ok(comparePositions({ slot: 5, tx_sig: 'a', pos: 20000 }, { slot: 5, tx_sig: 'a', pos: 10000 }) > 0);
  assert.throws(() => comparePositions({ slot: 5, tx_sig: 'a' }, { slot: 5, tx_sig: 'b' }), PositionUnknown);
});
test('fillBlockIndices reads a block only for a slot with two distinct transactions, and fails closed on an unreadable block', async () => {
  const blocks = [];
  const rpc = { getBlockSignatures: async (slot) => { blocks.push(slot); if (slot === 9) throw new Error('boom'); return ['x', 'y', 'z']; } };
  const idx = await fillBlockIndices(rpc, [{ slot: 1, tx_sig: 'x' }, { slot: 2, tx_sig: 'x' }, { slot: 2, tx_sig: 'z' }, { slot: 2, tx_sig: 'z' }]);
  assert.deepEqual(blocks, [2]); assert.deepEqual(idx, { x: 0, z: 2 });
  await assert.rejects(() => fillBlockIndices(rpc, [{ slot: 9, tx_sig: 'x' }, { slot: 9, tx_sig: 'y' }]), PositionUnknown);
  await assert.rejects(() => fillBlockIndices(rpc, [{ slot: 3, tx_sig: 'x' }, { slot: 3, tx_sig: 'nope' }]), /not in block/);
});
test('allowanceCheck: debits since the grant add up to total_cap minus what is still delegated; counts only entries up to the read slot', () => {
  const m = mandate({ total_cap: '1000000' });
  const acct = (o) => ({ data: { parsed: { info: { delegate: A.agent, delegatedAmount: { amount: '940000' }, ...o } } } });
  const entries = [{ slot: 10, amount: '40000' }, { slot: 11, amount: '20000' }, { slot: 99, amount: '5000' }];
  assert.equal(allowanceCheck({ mandate: m, entries, account: acct(), slot: 50 }).ok, true);
  const bad = allowanceCheck({ mandate: m, entries, account: acct({ delegatedAmount: { amount: '950000' } }), slot: 50 });
  assert.equal(bad.ok, false); assert.equal(bad.expected, 50000n); assert.equal(bad.actual, 60000n);
  assert.equal(allowanceCheck({ mandate: m, entries: [{ slot: 10, amount: '1000000' }], account: acct({ delegate: null, delegatedAmount: { amount: '0' } }), slot: 50 }).ok, true, 'the allowance ran out: delegate cleared');
  assert.equal(allowanceCheck({ mandate: m, entries, account: acct({ delegate: A.thief }), slot: 50 }).ok, false, 'a different delegate with no superseding instruction is not explained');
});
