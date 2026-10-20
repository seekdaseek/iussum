// R1: held reservations are persisted (amount, time, blockhash, lastValidBlockHeight, context slot, the agent's signature) before the signed payload
// leaves the agent, atomically (temp file then rename) under cfg.dataDir; a restarted agent loads them and resolves them by the T1 rule.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
afterEach(() => { globalThis.fetch = realFetch; });
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
async function setup(tc) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-agent-'));
  tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const chain = { valid: true, height: 50 };
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: chain.valid }; if (m === 'getBlockHeight') return chain.height; throw new Error(`unexpected ${m}`); };
  const make = async (extra = {}) => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir, ...extra });
  return { facilitator, seller, s, dataDir, chain, make };
}
const files = (dir) => fs.readdirSync(dir);
test('R1 the reservation is on disk, complete, BEFORE the signed payload leaves the agent; no temp file is left behind', async (tc) => {
  const t = await setup(tc);
  let seenAtSend = null, withheld = null;
  globalThis.fetch = async (req) => {
    if (req.headers.get('payment-signature')) { seenAtSend = files(t.dataDir).filter((f) => f.includes('.reservations.')).map((f) => JSON.parse(fs.readFileSync(path.join(t.dataDir, f), 'utf8'))); withheld = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); }
    return realFetch(req);
  };
  const a = await t.make(); globalThis.fetch = realFetch;
  await a.fetch(t.seller.url).catch(() => {}); // the seller keeps the payload and answers 502
  assert.ok(seenAtSend, 'a data file existed when the payment request was sent');
  assert.equal(seenAtSend.length, 1, 'the reservations file existed');
  const rec = seenAtSend[0].reservations[0];
  for (const k of ['amount', 't', 'blockhash', 'lastValidBlockHeight', 'contextSlot', 'agentSig']) assert.ok(rec[k] !== undefined && rec[k] !== null, `${k} persisted`);
  assert.deepEqual(files(t.dataDir).filter((f) => f.includes('.tmp')), []);
  assert.ok(withheld);
});
test('R1 restart while a seller holds a payload: the new agent counts it as held, refuses the next payment, and the total never passes the budget when the seller lands it', async (tc) => {
  const t = await setup(tc);
  let withheld = null;
  globalThis.fetch = async (req) => { if (req.headers.get('payment-signature')) { withheld = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); } return realFetch(req); };
  const a1 = await t.make(); globalThis.fetch = realFetch;
  await a1.fetch(t.seller.url).catch(() => {});
  const a2 = await t.make(); // restart: a new process would load the same data directory
  assert.deepEqual(a2.reservations.map((r) => r.state), ['held'], 'the held payload is known to the new agent');
  const r = await a2.fetch(t.seller.url).catch((e) => e.reason ?? e.message);
  assert.equal(r, 'period_over_budget');
  await realFetch(`${t.facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(withheld, 'base64').toString()) }) }); // the seller lands it
  assert.ok(t.facilitator.counts.settle * 20000 <= 30000);
});
test('R1 a restarted agent releases the persisted reservation once its expiry is proven, and the file forgets it', async (tc) => {
  const t = await setup(tc);
  globalThis.fetch = async (req) => (req.headers.get('payment-signature') ? new Response('{}', { status: 502 }) : realFetch(req));
  const a1 = await t.make(); globalThis.fetch = realFetch;
  await a1.fetch(t.seller.url).catch(() => {});
  t.chain.valid = false; t.chain.height = 500; // proven expired, nothing landed
  const a2 = await t.make();
  const r = await a2.fetch(t.seller.url).catch((e) => e.reason ?? e.message);
  assert.equal(r.status ?? r, 200, 'after the proof the budget is free again');
  const rf = files(t.dataDir).find((f) => f.includes('.reservations.'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(t.dataDir, rf), 'utf8')).reservations.filter((x) => x.agentSig === a2.reservations[0].agentSig), [], 'the released reservation is gone from the file');
});
