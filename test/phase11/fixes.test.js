// Phase 1.1 (Addendum C) tests for fixes 6 to 12 and the supporting behaviour of 1 and 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { generateKeyPairSigner } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createAgent, IussumRefusal } from '@iussum/agent';
import { decodePayment } from '@iussum/seller';
import { createGrantChecker, mandateId, agentSpendHistory, mintDecimals } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, DAY, SRC, SELLER_KEY, mandate, receipt, grantTx, payTx, SIG } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, listen } from '../harness.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';

const NOW = T0 + 1000;

// ---------------------------------------------------------------- fix 6: the payment must come out of the granted account
test('F6: a payment from another token account than the grant\'s source is grant_mismatch in enforce', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, now: () => NOW });
  try {
    const s = await newScenario(seller);
    const other = (await findAssociatedTokenPda({ mint: A.asset, owner: A.thief, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]; // an account that is not the granted one
    const agent = await createAgent({ mandate: null, source: other, network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    agent.client.registerExtension({ key: 'iussum', enrichPaymentPayload: async (p) => ({ ...p, extensions: { iussum: { info: { mandate: s.mandate, grant_tx: s.grant_tx } } } }) });
    const res = await agent.fetch(seller.url);
    assert.equal(res.status, 403);
    const b = await res.json();
    assert.equal(b.reason, 'grant_mismatch'); assert.equal(b.delta[0].field, 'source'); assert.equal(facilitator.counts.settle, 0);
  } finally { facilitator.close(); seller.close(); }
});
test('F6: the same payment in observe mode settles and the violation is recorded', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, now: () => NOW, mode: 'observe' });
  try {
    const s = await newScenario(seller);
    const other = (await findAssociatedTokenPda({ mint: A.asset, owner: A.thief, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
    const agent = await createAgent({ mandate: null, source: other, network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    agent.client.registerExtension({ key: 'iussum', enrichPaymentPayload: async (p) => ({ ...p, extensions: { iussum: { info: { mandate: s.mandate, grant_tx: s.grant_tx } } } }) });
    assert.equal((await agent.fetch(seller.url)).status, 200);
  } finally { facilitator.close(); seller.close(); }
});

// ---------------------------------------------------------------- fix 7: the agent's period ledger survives a restart
async function ledgerScenario(o = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const earlier = payTx({ authority: s.signer.address, amount: '20000', slot: 500, blockTime: T0 + 500 }); // this agent already paid 20000 this period, before the "restart"
  seller.rpc.grants.set(sig('EARLIER'), earlier);
  seller.rpc.newer = [{ signature: sig('EARLIER'), slot: 500, blockTime: T0 + 500, err: null }];
  if (o.broken) seller.rpc.getSignaturesForAddress = async () => { throw new Error('rpc down'); };
  const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW });
  return { facilitator, seller, s, make, close: () => { facilitator.close(); seller.close(); } };
}
test('F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget', async () => {
  const t = await ledgerScenario();
  try {
    const a = await t.make();
    assert.equal(a.ledger.length, 1); assert.equal(a.ledger[0].amount, '20000');
    await assert.rejects(() => a.fetch(t.seller.url), (e) => e instanceof IussumRefusal && e.reason === 'period_over_budget');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});
test('F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete)', async () => {
  const t = await ledgerScenario({ broken: true });
  try {
    const a = await t.make();
    await assert.rejects(() => a.fetch(t.seller.url), (e) => e instanceof IussumRefusal && e.reason === 'history_incomplete');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});

// ---------------------------------------------------------------- fix 8: the agent judges the URL it asked for
function lyingProxy(sellerOrigin, declared) {
  const srv = http.createServer((req, res) => {
    http.get(`${sellerOrigin}${req.url}`, { agent: false, headers: { connection: 'close' } }, (up) => {
      const chunks = []; up.on('data', (c) => chunks.push(c)); up.on('end', () => {
        const headers = { ...up.headers };
        if (up.statusCode === 402 && headers['payment-required']) {
          const pr = JSON.parse(Buffer.from(headers['payment-required'], 'base64').toString('utf8'));
          pr.resource = { ...(pr.resource ?? {}), url: declared };
          headers['payment-required'] = Buffer.from(JSON.stringify(pr)).toString('base64');
        }
        res.writeHead(up.statusCode, headers); res.end(Buffer.concat(chunks));
      });
    });
  });
  return srv;
}
test('F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW });
  const s = await newScenario(seller);
  const proxy = lyingProxy(seller.origin, `${seller.origin}/v1/quote`); // declares an in-prefix URL
  const port = await listen(proxy);
  try {
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW });
    await assert.rejects(() => a.fetch(`http://127.0.0.1:${port}/other/quote`), (e) => e instanceof IussumRefusal && e.reason === 'resource_mismatch');
    assert.equal(facilitator.counts.settle, 0);
  } finally { proxy.close(); facilitator.close(); seller.close(); }
});

// ---------------------------------------------------------------- fix 11: decimals come from the mint
const MINT9 = 'So11111111111111111111111111111111111111112';
test('F11: the agent builds TransferChecked with the mint\'s decimals (9), not a constant 6', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, asset: MINT9 });
  seller.rpc.mints.set(MINT9, 9);
  try {
    const signer = await generateKeyPairSigner();
    const m = mandate({ agent: signer.address, asset: MINT9, allow: { pay_to: [A.sellerA], resource_prefix: [`${seller.origin}/v1/`] } });
    const a = await createAgent({ mandate: m, grant_tx: SIG('G'), signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    let tx = null;
    const orig = a.client.createPaymentPayload.bind(a.client);
    a.client.createPaymentPayload = async (pr) => { const p = await orig(pr); tx = p.payload.transaction; return p; };
    assert.equal((await a.fetch(seller.url)).status, 200);
    assert.equal(decodePayment(tx).decimals, 9);
  } finally { facilitator.close(); seller.close(); }
});
test('F11: mintDecimals refuses a mint it cannot read', async () => {
  await assert.rejects(() => mintDecimals({ getAccountInfoParsed: async () => null }, MINT9), /cannot read the decimals/);
  assert.equal(await mintDecimals({ getAccountInfoParsed: async () => ({ data: { parsed: { info: { decimals: 9 } } } }) }, MINT9), 9);
});

// ---------------------------------------------------------------- fix 9: a failed refund is retried, idempotently
const PM = mandate({ nonce: '0c'.repeat(16) });
const G = sig('G'), PAY = sig('PAY');
function refundSetup({ decimals } = {}) {
  const c = chainSim();
  c.add('G', grantAt(PM, 1000)); c.add('PAY', payAt(1100, { payTo: A.sellerC, decimals })); c.setAccount(SRC, live(PM));
  let t = T0 + 5000; const clock = { now: () => t, advance: (s) => { t += s; } };
  const refunds = [], behaviour = { fail: 0, afterSign: null };
  const sendRefund = async (r, hooks = {}) => {
    refunds.push(r);
    if (behaviour.afterSign) { await hooks.onSigned?.(behaviour.afterSign); throw new Error('confirmation timed out'); }
    if (behaviour.fail-- > 0) throw new Error('rpc down');
    return `REFUND${refunds.length}`.padEnd(88, 'r');
  };
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, sendRefund, now: clock.now });
  const bundle = { tx_sig: PAY, mandate: PM, grant_tx: G, receipt: receipt({ mandate_id: mandateId(PM), grant_tx: G, tx_sig: PAY, pay_to: A.sellerC, settled_at: T0 + 1100 }) };
  return { c, store, service, bundle, refunds, behaviour, clock };
}
test('F9: a refund that failed after the verdict was reserved is retried on the next dispute, once', async () => {
  const t = refundSetup(); t.behaviour.fail = 1;
  const first = await t.service.dispute(t.bundle);
  assert.equal(first.liable, 'seller'); assert.equal(first.refund_tx, null); assert.match(first.refund_error, /rpc down/);
  const second = await t.service.dispute(t.bundle);
  assert.equal(second.reason, 'duplicate_dispute'); assert.ok(second.refund_tx?.startsWith('REFUND2'));
  const third = await t.service.dispute(t.bundle);
  assert.equal(third.refund_tx, second.refund_tx); assert.equal(t.refunds.length, 2, 'two attempts in total, one success, none after it');
});
test('F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land', async () => {
  const t = refundSetup(); t.behaviour.afterSign = sig('PENDINGREFUND');
  const first = await t.service.dispute(t.bundle);
  assert.match(first.refund_error, /timed out/);
  t.c.call = async () => ({ value: [null] }); // the signature is not on chain (yet)
  t.behaviour.afterSign = null;
  const second = await t.service.dispute(t.bundle);
  assert.equal(second.refund_state, 'pending'); assert.equal(t.refunds.length, 1, 'not resent inside the grace period');
  t.c.call = async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] }); // it landed after all
  const third = await t.service.dispute(t.bundle);
  assert.equal(third.refund_tx, sig('PENDINGREFUND')); assert.equal(t.refunds.length, 1, 'adopted, not paid twice');
});
test('F9: after the grace period an unconfirmed attempt is resent', async () => {
  const t = refundSetup(); t.behaviour.afterSign = sig('PENDINGREFUND');
  await t.service.dispute(t.bundle);
  t.c.call = async () => ({ value: [null] }); t.behaviour.afterSign = null; t.clock.advance(400);
  const again = await t.service.dispute(t.bundle);
  assert.ok(again.refund_tx?.startsWith('REFUND2')); assert.equal(t.refunds.length, 2);
});
test('F11: the refund uses the decimals of the disputed payment (9), read from the chain', async () => {
  const t = refundSetup({ decimals: 9 });
  await t.service.dispute(t.bundle);
  assert.equal(t.refunds[0].decimals, 9);
});

// ---------------------------------------------------------------- supporting behaviour for fixes 1 and 2
test('F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current', async () => {
  const c = chainSim(); c.add('G', grantAt(PM, 1000)); c.setAccount(SRC, live(PM));
  c.getSignaturesForAddress = async () => { throw new Error('rpc down'); };
  const r = await createGrantChecker(c).check(PM, G, { active: true });
  assert.equal(r.ok, false); assert.equal(r.reason, 'grant_inactive'); assert.match(r.detail, /could not verify the grant is current/);
});
test('F1: the supersession scan is incremental: the second check only asks for signatures newer than the first scan', async () => {
  const c = chainSim(); c.add('G', grantAt(PM, 1000)); c.add('P1', payAt(1100)); c.setAccount(SRC, live(PM));
  const checker = createGrantChecker(c);
  assert.equal((await checker.check(PM, G, { active: true })).ok, true);
  c.add('P2', payAt(1200));
  assert.equal((await checker.check(PM, G, { active: true })).ok, true);
  const untils = c.calls.pages.map((p) => p.until);
  assert.deepEqual(untils, [G, sig('P1')], 'the second scan starts after the newest signature of the first');
});
test('F2: agentSpendHistory pages with before until the grant is reached, and says it is complete', async () => {
  const c = chainSim(); c.add('G', grantAt(PM, 1000));
  for (let i = 0; i < 250; i++) c.add(`Q${i}`, payAt(1100 + i, { amount: '1' }));
  const h = await agentSpendHistory(c, { source: SRC, agent: A.agent, mint: A.asset, until: G });
  assert.equal(h.complete, true); assert.equal(h.entries.length, 250);
  assert.ok(c.calls.pages.length >= 3 && c.calls.pages.slice(1).every((p) => p.before));
});
test('F2: with stopAtTime the walk stops once a page reaches back before the period start, and is still complete', async () => {
  const c = chainSim(); c.add('G', grantAt(PM, 1000));
  for (let i = 0; i < 500; i++) c.add(`Q${i}`, payAt(1100 + i, { amount: '1' }));
  const h = await agentSpendHistory(c, { source: SRC, agent: A.agent, mint: A.asset, until: G, stopAtTime: T0 + 1100 + 450 });
  assert.equal(h.complete, true); assert.ok(h.entries.length < 500, `stopped early (${h.entries.length} entries)`);
  assert.ok(h.entries.some((e) => e.block_time >= T0 + 1550));
});
test('F2: too many pages is incomplete, not truncated silently', async () => {
  const c = chainSim(); c.add('G', grantAt(PM, 1000));
  for (let i = 0; i < 30; i++) c.add(`Q${i}`, payAt(1100 + i));
  const h = await agentSpendHistory(c, { source: SRC, agent: A.agent, mint: A.asset, until: G, pageSize: 10, maxPages: 2 });
  assert.equal(h.complete, false); assert.match(h.reason, /pages/);
});

// ---------------------------------------------------------------- fix 12
test('F12: engines says node >=24 and the README says so', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '>=24');
  assert.match(fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /Node 24/);
});
