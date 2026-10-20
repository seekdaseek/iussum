// T1 (review v3-new4.mjs): a node whose bank is behind the one that served getLatestBlockhash answers isBlockhashValid=false for a fresh blockhash.
// The agent may release a reservation only on a PROVEN expiry: isBlockhashValid false at minContextSlot = the slot getLatestBlockhash returned, AND
// getBlockHeight at the same minContextSlot above the payload's own lastValidBlockHeight. A success that arrives for a released reservation is counted.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
afterEach(() => { globalThis.fetch = realFetch; });
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
// chain: { valid: answer of isBlockhashValid, height: answer of getBlockHeight }; calls are recorded
async function run(tc, chain, { slowA = true } = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const calls = [];
  seller.rpc.call = async (m, p) => { calls.push([m, p]); if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: chain.valid }; if (m === 'getBlockHeight') return chain.height; throw new Error(`unexpected ${m}`); };
  globalThis.fetch = async (req) => { if (slowA && new URL(req.url).searchParams.get('c') === 'A' && req.headers.get('payment-signature')) await sleep(400); return realFetch(req); }; // A's seller is slow
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
  globalThis.fetch = realFetch;
  const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
  const pA = out(a.fetch(`${seller.url}?c=A`)); await sleep(150); const pB = out(a.fetch(seller.url));
  const ra = await pA, rb = await pB;
  return { ra, rb, a, calls, settled: facilitator.counts.settle * 20000 };
}
test('T1 control: the node says the blockhash is valid: B is refused, 20000 settled', async (tc) => {
  const x = await run(tc, { valid: true, height: 50 });
  assert.equal(x.ra, 200); assert.equal(x.rb, 'period_over_budget'); assert.equal(x.settled, 20000);
});
test('T1 a lagging node says isBlockhashValid=false but the chain height is below lastValidBlockHeight: the reservation stays held, B is refused', async (tc) => {
  const x = await run(tc, { valid: false, height: 50 });
  assert.equal(x.rb, 'period_over_budget', JSON.stringify(x.a.reservations.map((r) => r.state))); assert.equal(x.settled, 20000);
  assert.equal(x.a.ledger.reduce((s, e) => s + Number(e.amount), 0), 20000, 'the success of A is in the ledger');
});
test('T1 both answers are needed: a node that says the blockhash is still valid keeps the reservation held even when the height is past lastValidBlockHeight', async (tc) => {
  const x = await run(tc, { valid: true, height: 500 });
  assert.equal(x.rb, 'period_over_budget'); assert.equal(x.settled, 20000);
});
test('T1 isBlockhashValid and getBlockHeight are both asked with minContextSlot = the slot getLatestBlockhash returned', async (tc) => {
  const x = await run(tc, { valid: false, height: 50 });
  const asked = x.calls.filter(([m]) => m === 'isBlockhashValid' || m === 'getBlockHeight');
  assert.ok(asked.length >= 2, `asked ${asked.length}`);
  for (const [m, p] of asked) assert.equal(p.at(-1).minContextSlot, 10, `${m} without minContextSlot`);
});
test('T1 an error from getBlockHeight leaves the reservation held', async (tc) => {
  const x = await run(tc, { valid: false, height: undefined });
  assert.equal(x.rb, 'period_over_budget');
});
test('T1 a success that arrives AFTER a proven release is still counted (the reservation is consumed, the ledger has it)', async (tc) => {
  const x = await run(tc, { valid: false, height: 500 }); // proven expiry: both answers say so
  assert.equal(x.ra, 200);
  assert.equal(x.a.ledger.reduce((s, e) => s + Number(e.amount), 0), x.settled, 'what settled is what the ledger counts');
  assert.ok(x.a.reservations.every((r) => r.state === 'consumed'), JSON.stringify(x.a.reservations.map((r) => r.state)));
});
