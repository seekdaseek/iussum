// O3, O5, O6, O7 (close during the grant check) of Addendum O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPaid = (req, init) => (req instanceof Request ? req.headers : new Headers(init?.headers ?? {})).get('payment-signature');
const status = async (a, url) => { try { const r = await a.fetch(url); await r.text(); return r.status; } catch (e) { return `THREW ${e.reason ?? e.message.slice(0, 60)}`; } };

test('O3 aborting cfg.signal after the start does not stop the agent: it covers the START only (r1, r1b)', async (tc) => {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'enforce', now: () => NOW, price: '10000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const ac = new AbortController();
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, signal: ac.signal });
  assert.equal(await status(a, seller.url), 200);
  ac.abort();
  assert.equal(await status(a, seller.url), 200, 'after the signal fired'); assert.equal(await status(a, seller.url), 200);
  assert.equal(facilitator.counts.settle, 3);
  await a.close();
  // a timeout signal that fires long after the start
  const b = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, signal: AbortSignal.timeout(400) });
  await sleep(600);
  assert.equal(await status(b, seller.url), 200); await b.close();
});


test('O5 the pending memo of an unseen grant is never longer than the Retry-After the gate sends, so the agent\'s retries see the grant once the node has it (r6)', async () => {
  for (const ra of [1, 2]) {
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'enforce', now: () => NOW, price: '10000', gateOpts: { retryAfterSeconds: ra } }); // default memo: 5 s
    const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
    const grant = seller.rpc.grants.get(s.grant_tx); seller.rpc.grants.delete(s.grant_tx); // the seller's node does not show the grant yet
    setTimeout(() => seller.rpc.grants.set(s.grant_tx, grant), 300); // and shows it 0.3 s later
    const ar = fakeRpc(); ar.grants = new Map([[s.grant_tx, grant]]); ar.account = seller.rpc.account;
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => NOW, localChecks: false });
    const t0 = Date.now(); const r = await a.fetch(seller.url); await r.text();
    assert.equal(r.status, 200, `Retry-After ${ra}: got ${r.status} after ${Date.now() - t0} ms`); assert.equal(facilitator.counts.settle, 1);
    await a.close(); seller.close(); facilitator.close();
  }
});

test('O6 close({ timeoutMs }) takes an integer from 0 to 2147483647 or Infinity; anything else is rejected at the call and the agent is not closed (r7)', async (tc) => {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  tc.after(() => { globalThis.fetch = realFetch; facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const mk = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW });
  const a = await mk();
  for (const bad of [NaN, 2 ** 31, 30 * 86400_000, -1, 1.5, '5', null, {}]) {
    await assert.rejects(() => a.close({ timeoutMs: bad }), /timeoutMs/, `timeoutMs ${String(bad)}`);
  }
  assert.equal(await status(a, seller.url), 200, 'a rejected call did not close the agent');
  await a.close({ timeoutMs: 0 }); // nothing in flight: 0 is a valid timeout and the agent closes
  // Infinity waits with no timer: a payment that takes 600 ms is waited for
  let inFlight; const sent = new Promise((r) => (inFlight = r));
  globalThis.fetch = async (req, init) => { if (isPaid(req, init)) { inFlight(); await sleep(600); } return realFetch(req, init); };
  const b = await mk(); globalThis.fetch = realFetch;
  const p = status(b, seller.url); await sent;
  const t = Date.now(); await b.close({ timeoutMs: Infinity });
  assert.ok(Date.now() - t >= 400, 'Infinity waited for the payment instead of becoming a 1 ms timer'); assert.equal(await p, 200);
  const c = await mk(); await c.close();
});

test('O7 a close() during the grant check surfaces the agent_closed refusal, not "Failed to create payment payload: closed or abandoned"', async (tc) => {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const rpc = fakeRpc(); rpc.grants = seller.rpc.grants; rpc.account = seller.rpc.account;
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc, getBlockhash: blockhash, now: () => NOW });
  const slow = rpc.getTransaction.bind(rpc); rpc.getTransaction = async (...x) => { await sleep(300); return slow(...x); }; // the grant check takes a moment
  const p = a.fetch(seller.url).then((r) => `status ${r.status}`, (e) => `${e.name} ${e.reason ?? ''} ${e.message.slice(0, 60)}`);
  await sleep(100); await a.close();
  const out = await p;
  assert.match(out, /IussumRefusal agent_closed/, out);
});
