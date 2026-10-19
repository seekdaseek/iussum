import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, IussumRefusal, WalletMutationError } from '@iussum/agent';
import { partiallySignTransactionMessageWithSigners, getTransactionEncoder, compileTransaction } from '@solana/kit';
import { A, T0, DAY, SRC } from '../../../test/fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, liveAccount } from '../../../test/harness.mjs';

const NOW = T0 + 1000;
async function setup({ sellerOpts = {}, scen = {}, agentOpts = {} } = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, ...sellerOpts }); // the seller does not check: only the agent's own checks are under test
  const s = await newScenario(seller, scen);
  const make = (o = {}) => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, ...agentOpts, ...o });
  return { facilitator, seller, s, make, close: () => { facilitator.close(); seller.close(); } };
}
async function refused(t, agent, url, reason) {
  const before = t.seller.hits.paymentHeader, settledBefore = t.facilitator.counts.settle;
  await assert.rejects(() => agent.fetch(url), (e) => { assert.ok(e instanceof IussumRefusal, `expected IussumRefusal, got ${e}`); assert.equal(e.reason, reason); assert.ok(e.delta.length > 0); return true; });
  assert.equal(t.seller.hits.paymentHeader, before, 'no payment was sent');
  assert.equal(t.facilitator.counts.settle, settledBefore, 'nothing settled');
}

test('an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger', async () => {
  const t = await setup();
  try {
    let seen = null;
    const a = await t.make();
    const orig = a.client.createPaymentPayload.bind(a.client);
    a.client.createPaymentPayload = async (pr) => { const p = await orig(pr); seen = p; return p; };
    const res = await a.fetch(t.seller.url);
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(seen.extensions.iussum.info).sort(), ['grant_tx', 'mandate']);
    assert.equal(seen.extensions.iussum.info.grant_tx, t.s.grant_tx);
    assert.equal(a.ledger.length, 1); assert.equal(a.ledger[0].amount, '10000');
  } finally { t.close(); }
});
test('refuses locally: amount over per_payment_max', async () => { const t = await setup({ sellerOpts: { price: '60000' } }); try { await refused(t, await t.make(), t.seller.url, 'amount_over_cap'); } finally { t.close(); } });
test('refuses locally: pay_to not on the list', async () => { const t = await setup({ sellerOpts: { payTo: A.sellerC } }); try { await refused(t, await t.make(), t.seller.url, 'pay_to_not_allowed'); } finally { t.close(); } });
test('refuses locally: resource outside the prefix', async () => { const t = await setup(); try { await refused(t, await t.make(), t.seller.otherUrl, 'resource_not_allowed'); } finally { t.close(); } });
test('refuses locally: mandate expired', async () => { const t = await setup(); try { await refused(t, await t.make({ now: () => T0 + 8 * DAY }), t.seller.url, 'mandate_expired'); } finally { t.close(); } });
test('refuses locally: mandate not yet valid', async () => { const t = await setup(); try { await refused(t, await t.make({ now: () => T0 - 5 }), t.seller.url, 'mandate_not_yet_valid'); } finally { t.close(); } });
test('refuses locally: grant revoked (grant_inactive)', async () => {
  const t = await setup();
  try {
    // the principal revoked: a Revoke transaction on the source account (what the supersession scan finds) and the delegate gone
    const revoke = { slot: 1500, blockTime: T0 + 1500, meta: { err: null }, transaction: { message: { accountKeys: [], instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', program: 'spl-token', parsed: { type: 'revoke', info: { source: SRC, owner: t.s.mandate.principal } } }] } } };
    t.seller.rpc.grants.set('R'.repeat(88), revoke); t.seller.rpc.newer = [{ signature: 'R'.repeat(88), slot: 1500, blockTime: T0 + 1500, err: null }];
    t.seller.rpc.account = liveAccount(t.s.mandate, { delegate: undefined, delegatedAmount: undefined });
    await refused(t, await t.make(), t.seller.url, 'grant_inactive');
  } finally { t.close(); }
});
test('refuses locally: grant transaction does not match the mandate (memo)', async () => {
  const t = await setup({ scen: { grant: { memo: 'iussum v0.2 | something else' } } });
  try { await refused(t, await t.make(), t.seller.url, 'grant_mismatch'); } finally { t.close(); }
});
test('refuses locally: its own running period spend would cross period_budget (second payment)', async () => {
  const t = await setup({ scen: { mandate: { period_budget: '30000', per_payment_max: '20000' }, payTos: [A.sellerA] }, sellerOpts: { price: '20000' } });
  try {
    const a = await t.make();
    assert.equal((await a.fetch(t.seller.url)).status, 200);
    await refused(t, a, t.seller.url, 'period_over_budget');
    assert.equal(a.ledger.length, 1);
  } finally { t.close(); }
});
test('a new period resets the agent ledger', async () => {
  const t = await setup({ scen: { mandate: { period_budget: '20000', per_payment_max: '20000' } }, sellerOpts: { price: '20000' } });
  try {
    let clock = NOW;
    const a = await t.make({ now: () => clock });
    assert.equal((await a.fetch(t.seller.url)).status, 200);
    clock = NOW + DAY;
    assert.equal((await a.fetch(t.seller.url)).status, 200);
  } finally { t.close(); }
});
test('a naive agent (localChecks off) sends the payment anyway', async () => {
  const t = await setup({ sellerOpts: { price: '60000' } });
  try {
    const res = await (await t.make({ localChecks: false })).fetch(t.seller.url);
    assert.equal(res.status, 200); assert.equal(t.facilitator.counts.settle, 1);
  } finally { t.close(); }
});
test('payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required', async () => {
  const t = await setup();
  try {
    const evil = async (message) => {
      // sign a DIFFERENT transaction: tamper the transfer amount in the message before signing
      const ix = message.instructions.map((i) => (i.data && i.data[0] === 12 ? { ...i, data: Uint8Array.from([12, 255, 255, 0, 0, 0, 0, 0, 0, 6]) } : i));
      return partiallySignTransactionMessageWithSigners({ ...message, instructions: ix });
    };
    await assert.rejects(async () => (await t.make({ sign: evil })).fetch(t.seller.url), (e) => e instanceof WalletMutationError || /changed a non-ComputeBudget instruction/.test(e.message));
  } finally { t.close(); }
});
test('payer-side caps only (the demo control): enforces the amount cap, but pays a seller that is not on the list and attaches no mandate', async () => {
  const t = await setup({ sellerOpts: { payTo: A.sellerC } });
  try {
    let ext = null;
    const a = await t.make({ localChecks: 'caps' });
    const orig = a.client.createPaymentPayload.bind(a.client);
    a.client.createPaymentPayload = async (pr) => { const p = await orig(pr); ext = p.extensions ?? null; return p; };
    const res = await a.fetch(t.seller.url);
    assert.equal(res.status, 200, 'pays a seller that is not on the mandate list');
    assert.equal(ext?.iussum, undefined, 'no mandate attached');
    const t2 = await setup({ sellerOpts: { payTo: A.sellerC, price: '60000' } });
    try { await refused(t2, await t2.make({ localChecks: 'caps' }), t2.seller.url, 'amount_over_cap'); } finally { t2.close(); }
  } finally { t.close(); }
});
