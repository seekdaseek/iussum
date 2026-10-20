// T2: reading the history back to the grant must not cost what an outsider wants. A checkpoint of verified debits per grant (the newest signature
// read plus the verified entries up to it) lets every signature be read once; progress survives maxPages; makeRpc's transaction cache is bounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { makeRpc, mandateId } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';
import { dustCredit } from '../phase13/helpers.mjs';

const M = mandate({ per_payment_max: '1000', period_budget: '1000000', total_cap: '10000000', nonce: 'e1'.repeat(16) });
const G = sig('G');
const rc = (l, slot) => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig(l), amount: '100', settled_at: T0 + slot });
function service(c, o = {}) { const store = openStore(); return { store, svc: createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 999999, ...o }) }; }
test('T2 each signature is read once: a second dispute on a long account reads only what is new', async () => {
  const c = chainSim(); c.add('G', grantAt(M, 1000));
  for (let i = 1; i <= 250; i++) c.add(`D${i}`, dustCredit(1000 + i));
  c.add('P1', payAt(1300, { amount: '100' })); c.setAccount(SRC, live(M));
  const { svc } = service(c);
  const v1 = await svc.dispute({ tx_sig: sig('P1'), mandate: M, grant_tx: G, receipt: rc('P1', 1300) });
  assert.equal(v1.reason, 'in_scope', JSON.stringify(v1));
  c.add('P2', payAt(1400, { amount: '100' })); c.add('D251', dustCredit(1401)); c.setAccount(SRC, live(M));
  const before = c.calls.getTransaction;
  const v2 = await svc.dispute({ tx_sig: sig('P2'), mandate: M, grant_tx: G, receipt: rc('P2', 1400) });
  assert.equal(v2.reason, 'in_scope', JSON.stringify(v2));
  const reads = c.calls.getTransaction - before;
  assert.ok(reads < 30, `the second dispute read ${reads} transactions`);
});
test('T2 progress survives maxPages: a read that stops at maxPages saves what it verified, and the next dispute finishes the job', async () => {
  const c = chainSim(); c.add('G', grantAt(M, 1000));
  for (let i = 1; i <= 35; i++) c.add(`D${i}`, dustCredit(1000 + i));
  c.add('P1', payAt(1300, { amount: '100' })); c.setAccount(SRC, live(M));
  const { svc, store } = service(c, { historyPageSize: 10, historyMaxPages: 2 });
  const outs = [];
  for (let i = 0; i < 4; i++) outs.push((await svc.dispute({ tx_sig: sig('P1'), mandate: M, grant_tx: G, receipt: rc('P1', 1300) })).reason);
  assert.equal(outs.at(-1), 'in_scope', outs.join(','));
  assert.equal(outs[0], 'history_incomplete');
  assert.equal(store.count(), 1);
});
test('T2 a restarted agent reads only what is new since its checkpoint', async (tc) => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 1000, price: '100' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-agent-'));
  tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const s = await newScenario(seller, { mandate: { per_payment_max: '1000', period_budget: '1000000' } });
  const c = chainSim(); c.add('G', grantAt(s.mandate, 1000));
  for (let i = 1; i <= 150; i++) c.add(`D${i}`, dustCredit(1000 + i));
  c.setAccount(SRC, live(s.mandate)); c.setAccount(A.asset, { data: { parsed: { info: { decimals: 6 } } } });
  const mk = () => createAgent({ mandate: s.mandate, grant_tx: G, signer: s.signer, rpc: c, getBlockhash: blockhash, now: () => T0 + 1000, dataDir });
  await mk();
  const first = c.calls.getTransaction;
  for (let i = 151; i <= 155; i++) c.add(`D${i}`, dustCredit(1000 + i));
  const a2 = await mk();
  assert.ok(c.calls.getTransaction - first < 30, `the restart read ${c.calls.getTransaction - first} transactions`);
  assert.equal(a2.ledger.length, 0);
});
test('T2 makeRpc keeps at most 5000 transactions in its cache (least recently used goes first)', async () => {
  let fetches = 0;
  const fetchImpl = async (_u, o) => { fetches++; const id = JSON.parse(o.body).params[0]; return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { slot: 1, transaction: { message: {}, signatures: [id] }, meta: {} } }), { status: 200 }); };
  const rpc = makeRpc('http://x', { fetchImpl });
  for (let i = 0; i < 5100; i++) await rpc.getTransaction(`s${i}`);
  const n = fetches;
  await rpc.getTransaction('s5099'); assert.equal(fetches, n, 'a recent entry is cached');
  await rpc.getTransaction('s0'); assert.equal(fetches, n + 1, 'the oldest entry was evicted');
});
