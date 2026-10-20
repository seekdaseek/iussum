// I3 (review v4-t1.mjs): the "did it land?" read after a proven expiry must be asked of a node that has caught up with the expiry proof: every call in it takes
// minContextSlot at or above the slot of the proof, and any error (including "minimum context slot not reached") leaves the reservation held.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0, payTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
afterEach(() => { globalThis.fetch = realFetch; });
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
// the seller keeps payload 1 and lands it in the last valid block; the expiry is proven at slot 200; the history node is at `nodeSlot`
async function run(tc, { nodeSlot, listed, historyError }) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 200 }, value: false }; if (m === 'getBlockHeight') return 101; throw new Error(m); }; // expiry proven at slot 200
  let withheld = null;
  globalThis.fetch = async (req) => { if (req.headers.get('payment-signature') && !withheld) { withheld = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); } return realFetch(req); };
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
  globalThis.fetch = realFetch;
  await out(a.fetch(seller.url));
  await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(withheld, 'base64').toString()) }) }); // landed
  const landedSig = 'LANDED1'.padEnd(88, 'x');
  const landedTx = payTx({ slot: 2000, blockTime: NOW, amount: '20000', authority: s.signer.address }); landedTx.transaction.signatures = [landedSig, a.reservations[0].agentSig];
  seller.rpc.grants.set(landedSig, landedTx);
  if (listed) seller.rpc.newer = [{ signature: landedSig, slot: 2000, blockTime: NOW, err: null }];
  seller.rpc.nodeSlot = nodeSlot;
  seller.rpc.calls.minContext.length = 0;
  if (historyError) { const o = seller.rpc.getSignaturesForAddress.bind(seller.rpc); seller.rpc.getSignaturesForAddress = async (...x) => { throw new Error(historyError); }; void o; }
  const r2 = await out(a.fetch(seller.url));
  return { a, r2, settled: facilitator.counts.settle * 20000, calls: seller.rpc.calls.minContext };
}
test('I3 control: a history node that has caught up lists the landed payment: consumed, the next payment is refused', async (tc) => {
  const x = await run(tc, { nodeSlot: 300, listed: true });
  assert.equal(x.a.reservations[0].state, 'consumed'); assert.equal(x.r2, 'period_over_budget'); assert.equal(x.settled, 20000);
});
test('I3 a history node 1 to 2 slots behind the proof does not list the landed payment: the read fails ("minimum context slot not reached") and the reservation stays held', async (tc) => {
  const x = await run(tc, { nodeSlot: 198, listed: false });
  assert.equal(x.a.reservations[0].state, 'held', JSON.stringify(x.a.reservations.map((r) => r.state)));
  assert.equal(x.r2, 'period_over_budget'); assert.equal(x.settled, 20000, 'the landed payment is counted, nothing more settles');
});
test('I3 every call of the landed read carries minContextSlot at or above the proof slot (200)', async (tc) => {
  const x = await run(tc, { nodeSlot: 300, listed: true });
  const reads = x.calls.filter(([k]) => k === 'getSignaturesForAddress' || k === 'getTransaction' || k === 'getAccountContext');
  assert.ok(reads.length >= 2, `${reads.length} calls`);
  for (const [k, slot] of reads) assert.ok(slot >= 200, `${k} asked with minContextSlot ${slot}`);
});
test('I3 any other error of the history read also leaves the reservation held', async (tc) => {
  const x = await run(tc, { nodeSlot: 300, listed: false, historyError: 'rpc http 503' });
  assert.equal(x.a.reservations[0].state, 'held'); assert.equal(x.r2, 'period_over_budget');
});
