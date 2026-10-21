import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { verifyReceipt, mandateId } from '@iussum/core';
import { A, T0, DAY } from '../../../test/fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, liveAccount } from '../../../test/harness.mjs';

const NOW = T0 + 1000;
async function setup(sellerOpts = {}, scen = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, now: () => NOW, ...sellerOpts });
  const s = await newScenario(seller, scen);
  const agent = (o = {}) => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW, ...o });
  return { facilitator, seller, s, agent, close: () => { facilitator.close(); seller.close(); } };
}

test('enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant', async () => {
  const t = await setup();
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 200);
    assert.equal(t.facilitator.counts.settle, 1);
    const r = res.receipt;
    assert.ok(r, 'receipt header present');
    assert.equal(verifyReceipt(r, t.seller.gate.publicKey).ok, true);
    assert.equal(r.mandate_id, t.s.id); assert.equal(r.grant_tx, t.s.grant_tx);
    assert.equal(r.payer, t.s.signer.address); assert.equal(r.pay_to, A.sellerA); assert.equal(r.amount, '10000'); assert.equal(r.resource, t.seller.url);
    assert.ok(r.tx_sig.startsWith('MOCKSETTLE'));
  } finally { t.close(); }
});
test('enforce: amount over per_payment_max answers 403 and nothing settles', async () => {
  const t = await setup({ price: '60000' });
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 403);
    const b = await res.json();
    assert.equal(b.error, 'iussum_out_of_scope'); assert.equal(b.reason, 'amount_over_cap');
    assert.deepEqual(b.delta[0], { code: 'amount_over_cap', field: 'amount', authorized: '50000', actual: '60000' });
    assert.equal(t.facilitator.counts.settle, 0); assert.equal(t.facilitator.counts.verify, 0); assert.equal(t.seller.hits.handler, 0);
  } finally { t.close(); }
});
test('enforce: a seller whose pay_to is not on the list refuses', async () => {
  const t = await setup({ payTo: A.sellerC });
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'pay_to_not_allowed');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});
test('enforce: a resource outside the prefix refuses', async () => {
  const t = await setup();
  try {
    const res = await (await t.agent()).fetch(t.seller.otherUrl);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'resource_not_allowed');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});
test('enforce: revoked grant (delegate cleared) answers 403 grant_inactive', async () => {
  const t = await setup();
  try {
    t.seller.rpc.account = liveAccount(t.s.mandate, { delegate: undefined, delegatedAmount: undefined });
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'grant_inactive');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});
test('enforce: delegate replaced after the grant is grant_inactive too', async () => {
  const t = await setup();
  try {
    t.seller.rpc.account = liveAccount(t.s.mandate, { delegate: A.thief });
    assert.equal((await (await (await t.agent()).fetch(t.seller.url)).json()).reason, 'grant_inactive');
  } finally { t.close(); }
});
test('enforce: a grant transaction with an extra instruction is grant_mismatch', async () => {
  const t = await setup({}, { grant: { extra: { programId: '11111111111111111111111111111111', program: 'system', parsed: { type: 'transfer', info: {} } } } });
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'grant_mismatch');
  } finally { t.close(); }
});
test('enforce: an unknown grant_tx is PENDING (503 + Retry-After), not a refusal: the seller\'s node may only lag (Addendum N, N5 a)', async () => {
  const t = await setup();
  try {
    t.seller.rpc.grants.clear();
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 503); assert.ok(res.headers.get('retry-after')); assert.equal((await res.json()).reason, 'grant_check_pending');
  } finally { t.close(); }
});
test('enforce: an expired mandate is refused using the seller clock', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, now: () => T0 + 8 * DAY });
  try {
    const s = await newScenario(seller);
    const agent = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false });
    const res = await agent.fetch(seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'mandate_expired');
  } finally { facilitator.close(); seller.close(); }
});
test('enforce: the payer must be the agent in the mandate', async () => {
  const t = await setup();
  try {
    const other = (await import('@solana/kit')).generateKeyPairSigner;
    const signer = await other();
    const a = await createAgent({ mandate: t.s.mandate, grant_tx: t.s.grant_tx, signer, rpc: t.seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    const res = await a.fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'agent_mismatch');
  } finally { t.close(); }
});
test('enforce: an invalid mandate document is refused', async () => {
  const t = await setup();
  try {
    const a = await createAgent({ mandate: t.s.mandate, grant_tx: t.s.grant_tx, signer: t.s.signer, rpc: t.seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    a.client.registerExtension({ key: 'iussum', enrichPaymentPayload: async (p) => ({ ...p, extensions: { iussum: { info: { mandate: { ...t.s.mandate, total_cap: 5 }, grant_tx: t.s.grant_tx } } } }) });
    const res = await a.fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'mandate_invalid');
  } finally { t.close(); }
});
test('enforce without requireMandate lets an unmandated payment through and signs a receipt that says no mandate was presented', async () => {
  const t = await setup();
  try {
    const res = await (await t.agent({ attachMandate: false })).fetch(t.seller.url);
    assert.equal(res.status, 200);
    assert.equal(res.receipt.mandate_id, null); assert.equal(res.receipt.grant_tx, null);
    assert.equal(verifyReceipt(res.receipt, t.seller.gate.publicKey).ok, true);
  } finally { t.close(); }
});
test('enforce with requireMandate refuses an unmandated payment', async () => {
  const t = await setup({ requireMandate: true });
  try {
    const res = await (await t.agent({ attachMandate: false })).fetch(t.seller.url);
    assert.equal(res.status, 403); assert.equal((await res.json()).reason, 'mandate_missing');
  } finally { t.close(); }
});
test('observe: an out-of-scope payment settles, and the receipt still records what was presented', async () => {
  const t = await setup({ mode: 'observe', payTo: A.sellerC });
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 200);
    assert.equal(t.facilitator.counts.settle, 1);
    assert.equal(res.receipt.mandate_id, t.s.id); assert.equal(res.receipt.grant_tx, t.s.grant_tx); assert.equal(res.receipt.pay_to, A.sellerC);
  } finally { t.close(); }
});
test('off: no check and no receipt', async () => {
  const t = await setup({ mode: 'off', payTo: A.sellerC });
  try {
    const res = await (await t.agent()).fetch(t.seller.url);
    assert.equal(res.status, 200); assert.equal(res.receipt, null);
    assert.equal(t.seller.rpc.calls.getTransaction, 0);
  } finally { t.close(); }
});
test('the mode can be switched at runtime', async () => {
  const t = await setup({ mode: 'off', payTo: A.sellerC });
  try {
    t.seller.gate.setMode('enforce');
    assert.equal((await (await t.agent()).fetch(t.seller.url)).status, 403);
    t.seller.gate.setMode('observe');
    assert.equal((await (await t.agent()).fetch(t.seller.url)).status, 200);
    assert.throws(() => t.seller.gate.setMode('nope'));
  } finally { t.close(); }
});
test('/.well-known/iussum.json publishes the seller key', async () => {
  const t = await setup();
  try {
    const j = await (await fetch(`${t.seller.origin}/.well-known/iussum.json`)).json();
    assert.equal(j.seller, t.seller.gate.publicKey); assert.equal(j.pay_to, A.sellerA); assert.equal(j.receipt_alg, 'ed25519');
  } finally { t.close(); }
});
test('the grant check result is cached: two payments read the grant transaction once', async () => {
  const t = await setup();
  try {
    const a = await t.agent();
    assert.equal((await a.fetch(t.seller.url)).status, 200);
    assert.equal((await a.fetch(t.seller.url)).status, 200);
    assert.equal(t.seller.rpc.calls.getTransaction, 1);
  } finally { t.close(); }
});
test('enforce: an unreadable payment transaction is refused before x402 sees it', async () => {
  const t = await setup();
  try {
    const payload = { x402Version: 2, accepted: {}, payload: { transaction: Buffer.from('not a transaction').toString('base64') }, extensions: { iussum: { info: { mandate: t.s.mandate, grant_tx: t.s.grant_tx } } } };
    const res = await fetch(t.seller.url, { headers: { 'payment-signature': Buffer.from(JSON.stringify(payload)).toString('base64') } });
    assert.equal(res.status, 403);
    const b = await res.json();
    assert.equal(b.reason, 'tx_mismatch'); assert.equal(b.delta[0].field, 'payment');
  } finally { t.close(); }
});
