// N1 (Addendum N, seventh review): the period ledger must never dedupe on the signature the SELLER reports in payment-response. A seller (or its facilitator) that
// answers success with a signature the agent already counted must not make the agent forget the payment. Dedupe is on the agent's OWN signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { T0, payTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 40)}`; } };
const SAME = 'SAMESIG'.padEnd(88, 'x');

test('N1 a seller that reports one transaction signature for every settle cannot lift the period budget (a6-dup-settle-sig)', async () => {
  for (const fixedTx of [null, SAME]) {
    const facilitator = await startMockFacilitator({ fixedTx });
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
    const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '10000' } });
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
    const res = []; for (let i = 0; i < 6; i++) res.push(await out(a.fetch(seller.url)));
    assert.deepEqual(res, [200, 200, 200, 'period_over_budget', 'period_over_budget', 'period_over_budget'], `${fixedTx ? 'repeated' : 'distinct'} signatures: ${res}`);
    assert.equal(facilitator.counts.settle * 10000, 30000); assert.equal(a.ledger.length, 3);
    await a.close(); facilitator.close(); seller.close();
  }
});

test('N1 a restart does not collapse settled payments that the seller reported with one signature (restoreReservations)', async () => {
  const facilitator = await startMockFacilitator({ fixedTx: SAME });
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '10000' } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'n1-'));
  const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir });
  const a = await make();
  assert.deepEqual([await out(a.fetch(seller.url)), await out(a.fetch(seller.url))], [200, 200]);
  await a.close();
  const b = await make(); // a node that has not caught up: the chain shows neither payment, so the file is all the agent knows
  assert.equal(b.ledger.length, 2, 'both settled payments are counted after the restart');
  assert.equal(await out(b.fetch(seller.url)), 200);
  assert.equal(await out(b.fetch(seller.url)), 'period_over_budget');
  assert.equal(facilitator.counts.settle * 10000, 30000);
  await b.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('N1 a landed payload is not mistaken for a payment already counted because a seller once reported its signature (settleHeld)', async () => {
  const facilitator = await startMockFacilitator({ fixedTx: SAME });
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '10000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 200 }, value: false }; if (m === 'getBlockHeight') return 101; throw new Error(m); }; // every payload is proven expired
  let n = 0;
  globalThis.fetch = async (req) => (req.headers.get('payment-signature') && ++n === 2 ? new Response('{}', { status: 502 }) : realFetch(req)); // the 2nd payload is kept
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
  globalThis.fetch = realFetch;
  assert.equal(await out(a.fetch(seller.url)), 200); // the seller reported SAME
  assert.equal(await out(a.fetch(seller.url)), 502); // kept
  const agentSig2 = a.reservations[1].agentSig;
  const tx = payTx({ slot: 2000, blockTime: NOW, amount: '10000', authority: s.signer.address }); tx.transaction.signatures = [SAME, agentSig2]; // it lands under the very signature the seller reported before
  seller.rpc.grants.set(SAME, tx); seller.rpc.newer = [{ signature: SAME, slot: 2000, blockTime: NOW, err: null }];
  assert.equal(await out(a.fetch(seller.url)), 200); // resolves the kept payload, then pays a third time
  assert.equal(a.reservations[1].state, 'consumed');
  assert.equal(a.ledger.filter((x) => x.agentSig === agentSig2 || x.signatures?.includes(agentSig2)).length, 1, 'the landed payload is in the ledger');
  assert.equal(a.ledger.length, 3, '10000 + the landed 10000 + the third payment');
  assert.equal(await out(a.fetch(seller.url)), 'period_over_budget');
  await a.close(); facilitator.close(); seller.close();
});
