// N4 (review v2-new.mjs): a seller holds its own receipt key, so it can sign a second receipt and file it first. Two different receipts that
// verify against the same seller key for one payment are receipt_equivocation: the seller is liable, whatever is stored, and the refund is paid once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mandateId } from '@iussum/core';
import { T0, SRC, WRONG_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

const M = mandate({ nonce: 'a4'.repeat(16) });
const G = sig('G');
const rcpt = (slot, o = {}) => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('P'), amount: '10000', settled_at: T0 + slot, ...o });
const genuine = rcpt(1100, { resource: 'https://not-allowed.example/x' }); // what the observe-mode seller really signed
const forgedScope = rcpt(1101); // same payment, resource inside the prefix
const forgedNull = rcpt(1101, { mandate_id: null, grant_tx: null, resource: 'https://not-allowed.example/x' });
function build() {
  const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P', payAt(1100, { amount: '10000' })); c.setAccount(SRC, live(M));
  const refunds = [];
  const sendRefund = async (p, { onSigned }) => { const s = `R${refunds.length}`.padEnd(88, 'r'); await onSigned(s); refunds.push(p); return s; };
  return { ...service(c, { sendRefund }), refunds };
}
const file = (t, r) => t.svc.dispute({ tx_sig: sig('P'), mandate: M, grant_tx: G, receipt: r });
for (const [label, forged] of [['an in-scope resource', forgedScope], ['a null mandate_id', forgedNull]]) {
  test(`N4 the seller files first with a second receipt it signed (${label}); the principal's genuine receipt gets receipt_equivocation, seller liable, one refund`, async () => {
    const t = build();
    const first = await file(t, forged);
    assert.ok(['in_scope', 'resource_not_allowed'].includes(first.reason));
    const second = await file(t, genuine);
    assert.equal(second.reason, 'receipt_equivocation', JSON.stringify(second)); assert.equal(second.verdict, 'valid'); assert.equal(second.liable, 'seller');
    assert.equal(t.refunds.length, 1); assert.ok(second.refund_tx);
    assert.ok(second.replaced.length >= 1, 'the replaced verdict stays in the record');
    const third = await file(t, genuine);
    assert.equal(third.reason, 'duplicate_dispute'); assert.equal(t.refunds.length, 1, 'never a second refund');
  });
}
test('N4 the genuine receipt is final and refunded; a second, different receipt the seller signs later turns it into receipt_equivocation without a second refund', async () => {
  const t = build();
  const v1 = await file(t, genuine);
  assert.equal(v1.reason, 'resource_not_allowed'); assert.equal(t.refunds.length, 1);
  const v2 = await file(t, forgedScope);
  assert.equal(v2.reason, 'receipt_equivocation'); assert.equal(v2.liable, 'seller'); assert.equal(t.refunds.length, 1);
});
test('N4 the same receipt filed twice is a duplicate, not an equivocation; a receipt signed by another key is not an equivocation', async () => {
  const t = build();
  assert.equal((await file(t, genuine)).reason, 'resource_not_allowed');
  assert.equal((await file(t, genuine)).reason, 'duplicate_dispute');
  const other = rcpt(1101, { key: WRONG_KEY });
  assert.equal((await file(t, other)).reason, 'duplicate_dispute', 'a receipt that does not verify against the seller key changes nothing');
  assert.equal(t.refunds.length, 1);
});
