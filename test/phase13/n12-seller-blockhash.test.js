// N12 (review v2-new2.mjs): the agent never takes recentBlockhash or lastValidBlockHeight from the 402, and releases a held reservation only when
// the chain says that payload's blockhash is no longer valid AND no transaction carrying the agent's signature from it is on chain.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
afterEach(() => { globalThis.fetch = realFetch; });
async function run(fake, tc) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 1 }, value: true }; throw new Error(`unexpected ${m}`); }; // the chain: every blockhash is still valid
  let withheld = null, n = 0, sentBlockhash = null;
  globalThis.fetch = async (req) => {
    if (req.headers.get('payment-signature') && n++ === 0) { withheld = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); } // the seller keeps payload 1 and answers 502
    const res = await realFetch(req); if (res.status !== 402 || !fake) return res;
    const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
    pr.accepts[0].extra = { ...pr.accepts[0].extra, recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }; // a real blockhash, a false expiry height
    const h = new Headers(res.headers); h.set('payment-required', Buffer.from(JSON.stringify(pr)).toString('base64'));
    return new Response(await res.text(), { status: 402, headers: h });
  };
  const own = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: own, lastValidBlockHeight: 5000n }), now: () => NOW });
  globalThis.fetch = realFetch;
  const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
  const r1 = await out(a.fetch(seller.url));
  const r2 = await out(a.fetch(seller.url));
  await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(withheld, 'base64').toString()) }) }); // the seller lands payload 1 later
  return { r1, r2, a, own, settled: facilitator.counts.settle * 20000, held: a.reservations.map((r) => r.state) };
}
test('N12 control: with the agent\'s own blockhash the second payment is refused and the total stays at the budget', async (tc) => {
  const x = await run(false, tc);
  assert.equal(x.r2, 'period_over_budget'); assert.equal(x.settled, 20000);
});
test('N12 a seller that says lastValidBlockHeight=1 cannot make the agent release the reservation: the second payment is refused and the total stays at the budget', async (tc) => {
  const x = await run(true, tc);
  assert.equal(x.r2, 'period_over_budget', JSON.stringify(x.held)); assert.equal(x.settled, 20000);
  assert.deepEqual(x.held, ['held'], 'no payload was signed with the seller\'s blockhash, and the first stays held while the chain says its blockhash is valid');
  assert.equal(x.a.reservations[0].blockhash, x.own, 'the payload carries the agent\'s own blockhash, not the one the 402 named');
});
