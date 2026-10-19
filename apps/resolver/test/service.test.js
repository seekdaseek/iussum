import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createResolver, createResolverApp, openStore } from '@iussum/resolver';
import { A, T0, DAY, M, MID, SELLER_KEY, SRC, mandate, grantTx, payTx, receipt, SIG } from '../../../test/fixtures.mjs';
import { mandateId } from '@iussum/core';
import { chainSim, grantAt, payAt, live } from '../../../test/regression/chainsim.mjs';

const PAY = SIG('P'), GRANT = SIG('G');
function build({ mandateOverride, payOpts = {}, rcpOpts = {}, txs = {} } = {}) {
  const man = mandateOverride ?? M;
  const rpc = chainSim();
  rpc.add(GRANT, grantAt(man, 1000));
  for (const [s, tx] of Object.entries(txs)) rpc.add(s, tx);
  rpc.add(PAY, payAt(payOpts.slot ?? 1100, payOpts));
  rpc.setAccount(SRC, live(man));
  const refunds = [];
  const store = openStore();
  const service = createResolver({ rpc, network: A.net, sellerKey: async (payTo) => ([A.sellerA, A.sellerB, A.sellerC].includes(payTo) ? SELLER_KEY.publicKey : null), store, sendRefund: async (r) => { refunds.push(r); return `REFUND${refunds.length}`.padEnd(88, 'r'); }, now: () => T0 + 5000 });
  const rcp = receipt({ mandate_id: mandateId(man), tx_sig: PAY, ...rcpOpts });
  return { service, refunds, store, rpc, man, rcp, bundle: { tx_sig: PAY, mandate: man, grant_tx: GRANT, receipt: rcp } };
}

test('R1: in scope, dispute is invalid, principal liable, no refund, verdict stored', async () => {
  const t = build();
  const v = await t.service.dispute(t.bundle);
  assert.equal(v.verdict, 'invalid'); assert.equal(v.reason, 'in_scope'); assert.equal(v.liable, 'principal');
  assert.equal(t.refunds.length, 0); assert.equal(t.store.count(), 1);
});
test('R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount', async () => {
  const t = build({ payOpts: { payTo: A.sellerC }, rcpOpts: { pay_to: A.sellerC } });
  const v = await t.service.dispute(t.bundle);
  assert.equal(v.verdict, 'valid'); assert.equal(v.reason, 'pay_to_not_allowed'); assert.equal(v.liable, 'seller');
  assert.equal(t.refunds.length, 1);
  assert.deepEqual(t.refunds[0], { to: A.principal, mint: A.asset, amount: '10000', decimals: 6, reason: `dispute ${PAY}` });
  assert.ok(v.refund_tx.startsWith('REFUND1'));
});
test('R3: out of scope with no mandate presented: agent operator liable, no refund from the seller', async () => {
  const t = build({ payOpts: { payTo: A.sellerC }, rcpOpts: { pay_to: A.sellerC, mandate_id: null, grant_tx: null } });
  const v = await t.service.dispute(t.bundle);
  assert.equal(v.verdict, 'valid'); assert.equal(v.liable, 'agent_operator'); assert.equal(t.refunds.length, 0);
});
test('R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted', async () => {
  const t = build();
  const bad = await t.service.dispute({ ...t.bundle, receipt: { ...t.rcp, amount: '1' } });
  assert.equal(bad.verdict, 'invalid'); assert.equal(bad.reason, 'signature_invalid'); assert.equal(bad.liable, null);
  assert.equal(t.store.count(), 0);
  const good = await t.service.dispute(t.bundle);
  assert.equal(good.reason, 'in_scope'); assert.equal(t.store.count(), 1);
});
test('no receipt (the payer-caps-only control): the chain alone proves pay_to out of scope: agent operator, resource unjudged', async () => {
  const t = build({ payOpts: { payTo: A.sellerC } });
  const v = await t.service.dispute({ ...t.bundle, receipt: null });
  assert.equal(v.verdict, 'valid'); assert.equal(v.reason, 'pay_to_not_allowed'); assert.equal(v.liable, 'agent_operator'); assert.deepEqual(v.unjudged, ['resource']);
  assert.equal(t.refunds.length, 0, 'the seller is not liable: it was never shown the mandate');
});
test('a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice', async () => {
  const t = build({ payOpts: { payTo: A.sellerC }, rcpOpts: { pay_to: A.sellerC } });
  const first = await t.service.dispute(t.bundle);
  const callsAfterFirst = t.rpc.calls.getTransaction;
  const second = await t.service.dispute(t.bundle);
  assert.equal(t.rpc.calls.getTransaction, callsAfterFirst, 'a duplicate is answered from the store, without touching the chain');
  assert.equal(second.reason, 'duplicate_dispute'); assert.equal(second.original_reason, 'pay_to_not_allowed'); assert.equal(second.liable, 'seller');
  assert.equal(second.refund_tx, first.refund_tx); assert.equal(second.duplicate, true);
  assert.equal(t.refunds.length, 1);
});
test('two concurrent disputes for one payment pay one refund', async () => {
  const t = build({ payOpts: { payTo: A.sellerC }, rcpOpts: { pay_to: A.sellerC } });
  const [a, b] = await Promise.all([t.service.dispute(t.bundle), t.service.dispute(t.bundle)]);
  assert.equal(t.refunds.length, 1);
  assert.deepEqual([a.duplicate === true, b.duplicate === true].sort(), [false, true]);
});
test('payment not found on chain', async () => {
  const t = build();
  const v = await t.service.dispute({ ...t.bundle, tx_sig: SIG('Z') });
  assert.equal(v.reason, 'tx_not_found'); assert.equal(v.liable, null);
});
test('period overrun across two sellers: the crossing payment is the agent operator\'s, and no seller refund is paid', async () => {
  const PM = mandate({ period_budget: '30000', per_payment_max: '20000' });
  const P1 = SIG('1');
  const t = build({ mandateOverride: PM, txs: { [P1]: payAt(1101, { amount: '20000', payTo: A.sellerA }) }, payOpts: { amount: '20000', payTo: A.sellerB, slot: 1102 }, rcpOpts: { amount: '20000', pay_to: A.sellerB } });
  const v = await t.service.dispute({ ...t.bundle, receipt: receipt({ mandate_id: mandateId(PM), tx_sig: PAY, amount: '20000', pay_to: A.sellerB }) });
  assert.equal(v.reason, 'period_over_budget'); assert.equal(v.liable, 'agent_operator'); assert.equal(t.refunds.length, 0);
});
test('http: POST /dispute returns the verdict JSON and GET /v/:tx a plain human page', async () => {
  const t = build({ payOpts: { payTo: A.sellerC }, rcpOpts: { pay_to: A.sellerC } });
  const srv = http.createServer(createResolverApp(t.service));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(`${base}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t.bundle) });
    const v = await r.json();
    assert.equal(r.status, 200); assert.equal(v.liable, 'seller');
    const page = await (await fetch(`${base}/v/${PAY}`)).text();
    assert.match(page, /Dispute upheld: yes/); assert.match(page, /Liable:\s+seller/); assert.match(page, /pay_to_not_allowed/); assert.match(page, /Refund transaction: REFUND1/);
    assert.equal((await fetch(`${base}/v/${'x'.repeat(88)}`)).status, 404);
    assert.equal((await fetch(`${base}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  } finally { srv.close(); }
});
test('only hashes and verdicts are stored: the stored row holds no mandate or receipt body', async () => {
  const t = build();
  await t.service.dispute(t.bundle);
  const row = t.store.get(PAY);
  assert.match(row.mandate_sha, /^[0-9a-f]{64}$/); assert.match(row.receipt_sha, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes(A.agent), 'no agent address in the stored row');
});
