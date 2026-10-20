// J1: a seller gate must not hang a request on a cold first read. The grant check inside a request has a time budget (default 10 s, cfg.grantCheckBudgetMs);
// past it the gate answers 503 with Retry-After and nothing settles; the scan keeps running in the background; the reference agent honours Retry-After with a bounded
// number of retries (re-sending the SAME payload, so the reservation is not doubled).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const realFetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
afterEach(() => { globalThis.fetch = realFetch; });
async function cold(tc, { mode = 'enforce', slowMs = 400, budget = 80, extraGate = {}, agentOpts = {} } = {}) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode, now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: budget, retryAfterSeconds: 1, ...extraGate } });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const orig = seller.rpc.getSignaturesForAddress.bind(seller.rpc);
  let slow = true; seller.rpc.getSignaturesForAddress = async (...a) => { if (slow) await sleep(slowMs); return orig(...a); }; // the cold first read
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => T0 + 1000, ...agentOpts });
  return { facilitator, seller, s, a, fast: () => { slow = false; } };
}
test('J1 the first request on a cold grant check answers 503 with Retry-After within the budget; nothing settles', async (tc) => {
  const t = await cold(tc, { slowMs: 600, agentOpts: { retry: { max: 0 } } });
  const t0 = Date.now();
  const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '1');
  assert.ok(Date.now() - t0 < 500, `answered in ${Date.now() - t0} ms`);
  assert.equal(t.facilitator.counts.settle, 0); assert.equal(t.facilitator.counts.verify, 0);
  const body = await r.json(); assert.equal(body.error, 'iussum_grant_check_pending');
});
test('J1 the scan keeps running in the background: after it finished the same payload is accepted and settles', async (tc) => {
  const t = await cold(tc, { slowMs: 300, agentOpts: { retry: { max: 0 } } });
  assert.equal((await t.a.fetch(t.seller.url)).status, 503);
  await sleep(1500); // the background scan completes
  t.fast();
  const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 200); assert.equal(t.facilitator.counts.settle, 1);
});
test('J1 the reference agent honours Retry-After: it re-sends the same payload and the payment settles once, with one reservation', async (tc) => {
  const t = await cold(tc, { slowMs: 300 });
  const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 200, 'after Retry-After the payment went through');
  assert.equal(t.facilitator.counts.settle, 1);
  assert.equal(t.a.reservations.length, 1, 'the retry re-sent the same payload: no second reservation');
  assert.deepEqual(t.a.reservations.map((x) => x.state), ['consumed']);
});
test('J1 the agent retries a bounded number of times, then returns the 503; the reservation stays held', async (tc) => {
  const t = await cold(tc, { slowMs: 60000, budget: 40, agentOpts: { retry: { max: 2 } } });
  const t0 = Date.now();
  const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 503); assert.equal(t.facilitator.counts.settle, 0);
  assert.ok(Date.now() - t0 < 6000, `gave up after ${Date.now() - t0} ms`);
  assert.deepEqual(t.a.reservations.map((x) => x.state), ['held'], 'held until proven expired or landed');
});
test('J1 an observe-mode gate never blocks on the cold check (it proceeds and records what was presented)', async (tc) => {
  const t = await cold(tc, { mode: 'observe', slowMs: 600, agentOpts: { retry: { max: 0 } } });
  const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 200);
});
test('J1 a warm check is not delayed: with the scan done the request is answered at once', async (tc) => {
  const t = await cold(tc, { slowMs: 0 });
  const t0 = Date.now(); const r = await t.a.fetch(t.seller.url);
  assert.equal(r.status, 200); assert.ok(Date.now() - t0 < 1500);
});
