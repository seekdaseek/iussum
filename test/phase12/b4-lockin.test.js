// B4 (review d3-lockin.mjs): whoever files first must not pick the evidence. A verdict decided without a receipt is provisional; a later
// dispute carrying a verifying receipt that binds the same mandate re-judges it. A verdict decided with a verifying receipt is final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mandateId } from '@iussum/core';
import { createResolverApp } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, WRONG_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from './helpers.mjs';

const M = mandate({ nonce: '7a'.repeat(16) });
const G = sig('G');
function build(amount) {
  const c = chainSim();
  c.add('G', grantAt(M, 1000)); c.add('P', payAt(1100, { amount })); c.setAccount(SRC, live(M));
  const refunds = [];
  const sendRefund = async (p, { onSigned }) => { const s = 'R'.repeat(88); await onSigned(s); refunds.push(p); return s; };
  return { ...service(c, { sendRefund }), refunds };
}
const rcpt = (amount, ro = {}) => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('P'), amount, settled_at: T0 + 1100, ...ro });
const bundle = (receipt) => ({ tx_sig: sig('P'), mandate: M, grant_tx: G, receipt });
const cases = [['resource outside the prefix', '10000', { resource: 'https://not-allowed.example/x' }, 'resource_not_allowed'], ['amount over per_payment_max', '60000', {}, 'amount_over_cap']];
for (const [label, amount, ro, reason] of cases) {
  test(`B4 ${label}: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund`, async () => {
    const t = build(amount);
    const first = await t.svc.dispute(bundle(null));
    assert.equal(first.provisional, true, JSON.stringify(first));
    assert.equal(t.refunds.length, 0);
    const second = await t.svc.dispute(bundle(rcpt(amount, ro)));
    assert.equal(second.reason, reason, JSON.stringify(second)); assert.equal(second.liable, 'seller'); assert.equal(second.verdict, 'valid');
    assert.equal(second.provisional, false); assert.equal(t.refunds.length, 1);
    assert.ok(second.refund_tx);
    assert.equal(second.replaced?.length, 1, 'the replaced verdict stays in the record');
    assert.equal(t.store.get(sig('P')).replaced.length, 1);
    const third = await t.svc.dispute(bundle(rcpt(amount, ro)));
    assert.equal(third.reason, 'duplicate_dispute'); assert.equal(t.refunds.length, 1, 'now final: no second refund');
  });
}
test('B4 a verdict decided WITH a verifying receipt is final: a later dispute is duplicate_dispute', async () => {
  const t = build('10000');
  const first = await t.svc.dispute(bundle(rcpt('10000')));
  assert.equal(first.reason, 'in_scope'); assert.ok(!first.provisional);
  const second = await t.svc.dispute(bundle(rcpt('10000'))); // the same receipt again (a DIFFERENT receipt for the payment is receipt_equivocation, Phase 1.3)
  assert.equal(second.reason, 'duplicate_dispute'); assert.equal(second.original_reason, 'in_scope');
});
test('B4 a receipt that does not verify, or binds another mandate, cannot replace a provisional verdict', async () => {
  const t = build('60000');
  assert.equal((await t.svc.dispute(bundle(null))).provisional, true);
  const bad = await t.svc.dispute(bundle(receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig('P'), amount: '60000', key: WRONG_KEY, settled_at: T0 + 1100 })));
  assert.equal(bad.reason, 'duplicate_dispute'); assert.equal(bad.provisional, true); assert.equal(t.refunds.length, 0);
  const other = await t.svc.dispute(bundle(receipt({ mandate_id: 'ab'.repeat(32), grant_tx: G, tx_sig: sig('P'), amount: '60000', settled_at: T0 + 1100 })));
  assert.equal(other.provisional, true); assert.equal(t.refunds.length, 0);
  assert.equal(t.store.get(sig('P')).verdict.liable, 'agent_operator');
});
test('B4 a verifying receipt that binds NO mandate cannot replace a provisional verdict (it must bind the same mandate)', async () => {
  const t = build('60000');
  assert.equal((await t.svc.dispute(bundle(null))).provisional, true);
  const unbound = receipt({ mandate_id: null, grant_tx: null, tx_sig: sig('P'), amount: '60000', settled_at: T0 + 1100 });
  const r = await t.svc.dispute(bundle(unbound));
  assert.equal(r.reason, 'duplicate_dispute'); assert.equal(r.provisional, true); assert.equal(t.store.get(sig('P')).replaced.length, 0);
});
test('B4 /v/:tx and the /dispute response say "provisional"', async () => {
  const t = build('60000');
  const app = createResolverApp(t.svc);
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const d = await (await fetch(`${base}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle(null)) })).json();
    assert.equal(d.provisional, true);
    const page = await (await fetch(`${base}/v/${sig('P')}`)).text();
    assert.match(page, /provisional/i);
  } finally { srv.close(); }
});
