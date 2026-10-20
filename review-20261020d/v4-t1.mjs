// Fourth pass (b5dfa77, imports ../). T1 residual: the expiry proof is asked with minContextSlot, but the "did it land?" read that follows
// (agentSpendHistory in settleHeld, agent.js) is not. A seller that kept the payload lands it in the last valid block; a history node one or two
// slots behind does not list it yet; the reservation is released and, with no success response ever coming back, the payment is never counted.
// Simulated: that node's listing (the landed tx absent), nothing else. Control: the listing shows it.
import { createAgent } from '../packages/agent/src/index.js';
import { T0, A } from '../test/fixtures.mjs';
import { payTx } from '../test/fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../test/harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
for (const lagging of [false, true]) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 200 }, value: false }; if (m === 'getBlockHeight') return 101; throw new Error(m); }; // expiry proven
  let withheld = null;
  globalThis.fetch = async (req) => { if (req.headers.get('payment-signature') && !withheld) { withheld = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); } return realFetch(req); };
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
  globalThis.fetch = realFetch;
  await out(a.fetch(seller.url)); // payload 1 kept by the seller
  // the seller lands payload 1 in the last valid block (the mock facilitator counts it as settled)
  await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(withheld, 'base64').toString()) }) });
  const agentSig = a.reservations[0].agentSig, landedSig = 'LANDED1'.padEnd(88, 'x');
  const landedTx = payTx({ slot: 2000, blockTime: NOW, amount: '20000', authority: s.signer.address }); landedTx.transaction.signatures = [landedSig, agentSig];
  seller.rpc.grants.set(landedSig, landedTx);
  if (!lagging) seller.rpc.newer = [{ signature: landedSig, slot: 2000, blockTime: NOW, err: null }]; // an up-to-date node lists it
  const r2 = await out(a.fetch(seller.url));
  console.log(`T1 residual ${lagging ? 'history node 1-2 slots behind' : 'control: history node up to date'}: reservation ${a.reservations[0].state}, next payment ${r2} | settled ${facilitator.counts.settle * 20000} vs budget 30000`);
  facilitator.close(); seller.close();
}
