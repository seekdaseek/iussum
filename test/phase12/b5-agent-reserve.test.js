// B5 (review d4-agent.mjs, d5-agent-pending.mjs): the agent reserves its period spend BEFORE signing, so concurrent payments cannot overrun
// the budget; a payment that settled but whose response was lost keeps counting until it is proven not to have landed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { getTransactionDecoder, getBase58Decoder, partiallySignTransactionMessageWithSigners } from '@solana/kit';
import { A, T0, SRC, payTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

afterEach(() => { globalThis.fetch = realFetch; });
const NOW = T0 + 1000, realFetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(price, mandateOver, { rpcExtra = {}, getBlockhash = blockhash } = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price });
  const s = await newScenario(seller, { mandate: mandateOver });
  Object.assign(seller.rpc, rpcExtra);
  return { facilitator, seller, s, make: (extra = {}) => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash, now: () => NOW, ...extra }), close: () => { facilitator.close(); seller.close(); } };
}
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
// wraps the global fetch BEFORE the agent is created (wrapFetchWithPayment captures it); `sent.tx` keeps the payment transaction the agent sent
const dropFirstResponse = (sent = {}) => { let drop = true; globalThis.fetch = async (req) => { const res = await realFetch(req); const ps = req.headers?.get?.('payment-signature'); if (ps) sent.tx = JSON.parse(Buffer.from(ps, 'base64').toString()).payload.transaction; if (ps && drop) { drop = false; throw new TypeError('fetch failed: socket hang up'); } return res; }; return sent; };

test('B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget', async (tc) => {
  const t = await setup('10000', { period_budget: '30000', per_payment_max: '20000' });
  tc.after(() => t.close());
  const a = await t.make();
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => out(a.fetch(t.seller.url))));
  assert.deepEqual(rs.filter((x) => x === 200).length, 3, rs.join());
  assert.deepEqual(rs.filter((x) => x === 'period_over_budget').length, 2, rs.join());
  assert.equal(t.facilitator.counts.settle, 3);
  assert.equal(a.ledger.length, 3);
});
test('B5 overlapping payments: A is slow, B starts meanwhile; both settle and BOTH reach the ledger, so the budget holds afterwards', async (tc) => {
  const t = await setup('10000', { period_budget: '30000', per_payment_max: '20000' });
  tc.after(() => t.close());
  globalThis.fetch = async (req) => {
    const u = new URL(req.url), paid = !!req.headers.get('payment-signature');
    if (u.searchParams.get('c') === 'A' && paid) await sleep(300);
    if (u.searchParams.get('c') === 'B' && !paid) await sleep(600);
    return realFetch(req);
  };
  const a = await t.make();
  globalThis.fetch = realFetch;
  const pA = out(a.fetch(`${t.seller.url}?c=A`)); await sleep(100);
  const pB = out(a.fetch(`${t.seller.url}?c=B`));
  assert.equal(await pA, 200); assert.equal(await pB, 200);
  assert.equal(a.ledger.length, 2, 'the first settled payment was not wiped from the ledger');
  const seq = []; for (let i = 0; i < 3; i++) seq.push(await out(a.fetch(t.seller.url)));
  assert.deepEqual(seq, [200, 'period_over_budget', 'period_over_budget']);
  assert.equal(t.facilitator.counts.settle * 10000, 30000, 'never above the period budget');
});
test('B5 a payment that settled but whose response was lost still counts: the next one is refused locally', async (tc) => {
  const t = await setup('20000', { period_budget: '30000', per_payment_max: '20000' });
  tc.after(() => t.close());
  dropFirstResponse();
  const a = await t.make();
  globalThis.fetch = realFetch;
  const r1 = await out(a.fetch(t.seller.url));
  assert.match(String(r1), /fetch failed/);
  const r2 = await out(a.fetch(t.seller.url));
  assert.equal(r2, 'period_over_budget');
  assert.equal(t.facilitator.counts.settle * 20000, 20000);
});
test('B5 a payment that was never created (signing failed) releases its reservation: the next payment goes through', async (tc) => {
  const t = await setup('20000', { period_budget: '30000', per_payment_max: '20000' });
  tc.after(() => t.close());
  let fail = true;
  const a = await t.make({ sign: async (msg) => { if (fail) { fail = false; throw new Error('wallet declined'); } return partiallySignTransactionMessageWithSigners(msg); } });
  assert.match(String(await out(a.fetch(t.seller.url))), /wallet declined/);
  assert.equal(await out(a.fetch(t.seller.url)), 200);
});
// lost response + the chain: held -> released only when the blockhash is expired AND no transaction carrying the agent's signature is on chain
async function lostThenAsk({ blockHeight, onChain }, tc) {
  const t = await setup('20000', { period_budget: '30000', per_payment_max: '20000' }, { rpcExtra: { call: async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 1 }, value: blockHeight <= 100 }; if (m === 'getBlockHeight') return blockHeight; throw new Error(`unexpected rpc call ${m}`); } } });
  tc.after(() => t.close());
  const sent = dropFirstResponse();
  const a = await t.make();
  globalThis.fetch = realFetch;
  assert.match(String(await out(a.fetch(t.seller.url))), /fetch failed/);
  if (onChain) { // the lost payment DID land: the chain shows a transaction that carries the agent's signature
    const sigs = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(sent.tx, 'base64'))).signatures;
    const agentSig = getBase58Decoder().decode(sigs[t.s.signer.address]);
    const chainTx = payTx({ slot: 5000, blockTime: T0 + 5000, amount: '20000', authority: t.s.signer.address });
    chainTx.transaction.signatures = ['F'.repeat(88), agentSig];
    t.seller.rpc.grants.set('F'.repeat(88), chainTx);
    t.seller.rpc.newer = [{ signature: 'F'.repeat(88), slot: 5000, blockTime: T0 + 5000, err: null }];
  }
  const r2 = await out(a.fetch(t.seller.url));
  return { r2, a };
}
test('B5 held stays held while the blockhash can still land (the chain says it is still valid)', async (tc) => {
  assert.equal((await lostThenAsk({ blockHeight: 50, onChain: false }, tc)).r2, 'period_over_budget');
});
test('B5 held is released when the blockhash has expired and no transaction with the agent\'s signature is on chain', async (tc) => {
  const { r2, a } = await lostThenAsk({ blockHeight: 101, onChain: false }, tc);
  assert.equal(r2, 200); assert.equal(a.ledger.length, 1);
});
test('B5 held becomes consumed (still counted) when the chain shows the lost payment landed', async (tc) => {
  const { r2, a } = await lostThenAsk({ blockHeight: 101, onChain: true }, tc);
  assert.equal(r2, 'period_over_budget');
  assert.deepEqual(a.reservations.map((r) => r.state), ['consumed'], 'held -> consumed, exactly once');
  assert.equal(a.ledger.length, 1, 'the landed payment is in the ledger once');
});
