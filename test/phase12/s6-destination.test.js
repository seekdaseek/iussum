// S6 (review d4-agent.mjs c): the agent pays the associated token account of the payTo it checked, never a destination the 402 names.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { decodePayment } from '../../packages/seller/src/decode.js';
import { A, T0, ata } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const NOW = T0 + 1000, realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
async function run(localChecks) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  const s = await newScenario(seller, {});
  const thiefAta = await ata(A.thief);
  let sent = null;
  globalThis.fetch = async (req) => {
    const ps = req.headers?.get?.('payment-signature'); if (ps) sent = JSON.parse(Buffer.from(ps, 'base64').toString());
    const res = await realFetch(req);
    if (res.status !== 402) return res;
    const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
    pr.accepts[0].destination = thiefAta; // malicious seller or a man in the middle
    const h = new Headers(res.headers); h.set('payment-required', Buffer.from(JSON.stringify(pr)).toString('base64'));
    return new Response(await res.text(), { status: 402, headers: h });
  };
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, localChecks });
  globalThis.fetch = realFetch;
  let result;
  try { result = (await a.fetch(seller.url)).status; } catch (e) { result = e.reason ?? e.message; } finally { facilitator.close(); seller.close(); }
  return { result, signedDestination: sent ? decodePayment(sent.payload.transaction).destination : null, thiefAta, sellerAta: await ata(A.sellerA) };
}
test('S6 a requirement whose destination is not the associated token account of payTo is refused locally (destination_mismatch) and never signed', async () => {
  const r = await run(true);
  assert.equal(r.result, 'destination_mismatch'); assert.equal(r.signedDestination, null);
});
test('S6 even without local checks the agent signs the associated token account of payTo, not the destination the 402 names', async () => {
  const r = await run(false);
  if (r.signedDestination !== null) { assert.equal(r.signedDestination, r.sellerAta); assert.notEqual(r.signedDestination, r.thiefAta); }
});
