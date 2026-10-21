// P7 (settle margin at the gate) and P8 (a payment without a block time is never silently placed in a period) of Addendum P.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { createSellerGate } from '@iussum/seller';
import { receiptKey, periodIndex, periodSpendAt } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, M, mandate } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc } from '../harness.mjs';
import { chainSim, grantAt, payAt, live } from '../regression/chainsim.mjs';

const NOW = T0 + 1000;
const out = async (a, url) => { try { const r = await a.fetch(url); const b = await r.text(); return { status: r.status, body: b, receipt: r.receipt }; } catch (e) { return { status: e.reason ?? e.message.slice(0, 80) }; } };

// ---- P7
async function marginRun(gateOpts, mandateOpts) {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'enforce', now: () => NOW, price: '10000', gateOpts });
  const s = await newScenario(seller, { mandate: mandateOpts });
  seller.rpc.getSignaturesForAddress = async () => [];
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW });
  const r = await out(a, seller.url); const settled = facilitator.counts.settle;
  await a.close(); facilitator.close(); seller.close();
  return { ...r, settled };
}
test('P7 an honest agent and an honest ENFORCE gate no longer accept a payment inside settleMarginSeconds of expires_at: 403 mandate_expired, the margin in the delta (g4)', async () => {
  const r = await marginRun({}, { expires_at: NOW + 100 });
  assert.equal(r.status, 403, r.body); assert.match(r.body, /mandate_expired/); assert.match(r.body, /120/, 'the margin is in the delta'); assert.equal(r.settled, 0);
});
test('P7 with settleMarginSeconds 0 the same payment is accepted, as before', async () => {
  const r = await marginRun({ settleMarginSeconds: 0 }, { expires_at: NOW + 100 });
  assert.equal(r.status, 200, r.body); assert.equal(r.settled, 1);
});
test('P7 the window is shrunk at the other end too: now - margin before not_before is mandate_not_yet_valid', async () => {
  const r = await marginRun({}, { not_before: NOW - 100 });
  assert.equal(r.status, 403, r.body); assert.match(r.body, /mandate_not_yet_valid/);
  const ok = await marginRun({}, { not_before: NOW - 500, expires_at: NOW + 500 }); assert.equal(ok.status, 200, ok.body);
  const edge = await marginRun({ settleMarginSeconds: 30 }, { expires_at: NOW + 31 }); assert.equal(edge.status, 200, 'now + margin < expires_at');
  const gone = await marginRun({ settleMarginSeconds: 30 }, { expires_at: NOW + 30 }); assert.equal(gone.status, 403, 'now + margin >= expires_at');
});
test('P7 settleMarginSeconds is an integer of at least 0, checked at start', () => {
  const mk = (settleMarginSeconds) => () => createSellerGate({ mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: A.net, rpc: fakeRpc(), key: receiptKey(Buffer.alloc(32, 9)), now: () => NOW, origin: 'http://x', settleMarginSeconds });
  for (const bad of [-1, 1.5, NaN, Infinity, '120', null]) assert.throws(mk(bad), /settleMarginSeconds/, String(bad));
  for (const ok of [undefined, 0, 1, 120, 86400]) assert.doesNotThrow(mk(ok), String(ok));
});

// ---- P8
function bundle(blockTime3) {
  const chain = chainSim();
  const m = mandate({ period_budget: '100000', period_seconds: 86400, per_payment_max: '60000', total_cap: '1000000' });
  const G = chain.add('G'.repeat(88), grantAt(m, 1000));
  const t = (i) => (i === 3 ? blockTime3 : T0 + 1100 + i);
  chain.add('PAY1', payAt(1101, { amount: '50000', blockTime: t(1) })); chain.add('PAY2', payAt(1102, { amount: '50000', blockTime: t(2) })); const P3 = chain.add('PAY3', payAt(1103, { amount: '50000', blockTime: t(3) }));
  chain.setAccount(SRC, live(m));
  return { chain, m, G, P3 };
}
const verdictFor = async (b, receipt = null) => {
  const svc = createResolver({ rpc: b.chain, network: A.net, sellerKey: async () => null, store: openStore(), now: () => T0 + 5000 });
  return svc.dispute({ tx_sig: b.P3, mandate: b.m, grant_tx: b.G, receipt });
};
test('P8 a payment with a block time is period_over_budget as before (control)', async () => {
  const v = await verdictFor(bundle(T0 + 1103)); assert.equal(v.reason, 'period_over_budget'); assert.equal(v.liable, 'agent_operator');
});
test('P8 a payment without a block time is not placed in a period of its own: history_incomplete, liable null, nothing stored as final (g5)', async () => {
  const v = await verdictFor(bundle(null));
  assert.equal(v.reason, 'history_incomplete', JSON.stringify(v)); assert.equal(v.liable, null);
});
test('P8 a null time among the earlier payments of the period gives history_incomplete too', async () => {
  const b = bundle(T0 + 1103); b.chain.txs.find((x) => x.sig.startsWith('PAY1')).tx.blockTime = null;
  const v = await verdictFor(b); assert.equal(v.reason, 'history_incomplete'); assert.equal(v.liable, null);
});
test('P8 rules that need no time are still judged first: an over-cap payment without a block time is amount_over_cap', async () => {
  const b = bundle(null); const m2 = { ...b.m };
  const chain = chainSim(); const G = chain.add('G'.repeat(88), grantAt(M, 1000)); const P = chain.add('PAYX', payAt(1100, { amount: '90000', blockTime: null })); chain.setAccount(SRC, live(M));
  const svc = createResolver({ rpc: chain, network: A.net, sellerKey: async () => null, store: openStore(), now: () => T0 + 5000 });
  const v = await svc.dispute({ tx_sig: P, mandate: M, grant_tx: G, receipt: null }); assert.equal(v.reason, 'amount_over_cap'); void m2;
});
test('P8 periodIndex throws on a time that is not a finite number, so null cannot reach the arithmetic again', () => {
  const m = mandate();
  for (const bad of [null, undefined, NaN, Infinity, '5']) assert.throws(() => periodIndex(m, bad), /time/, String(bad));
  assert.equal(periodIndex(m, m.not_before), 0);
  assert.equal(periodSpendAt(m, [{ tx_sig: 'a', slot: 1, block_time: null, amount: '1' }], 'a').unknownTime, true, 'periodSpendAt says the time is unknown instead of guessing a period');
  assert.equal(periodSpendAt(m, [{ tx_sig: 'a', slot: 1, block_time: m.not_before + 5, amount: '1' }, { tx_sig: 'b', slot: 2, block_time: null, amount: '1' }], 'a').unknownTime, undefined, 'a null time AFTER the disputed payment does not matter');
});
