// O7 (Addendum O, UNVERIFIED items, each tested before it was fixed): a re-orged transaction in the makeRpc cache, a node that answers without transaction.signatures,
// two spellings of one data directory, and the read amplification of repeated -32020 restarts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeRpc, createGrantChecker } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { generateKeyPairSigner } from '@solana/kit';
import { A, T0, SRC, mandate, grantTx, payTx } from '../fixtures.mjs';
import { chainSim, grantAt, live, payAt, tokenIx } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, fakeRpc, liveAccount, blockhash } from '../harness.mjs';

const NOW = T0 + 1000;
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 50)}`; } };

// a JSON-RPC node over a chainSim: getSignaturesForAddress and getTransaction, errors as the node words them
function nodeOver(sim, { onList = null } = {}) {
  const requests = { list: 0, tx: 0 };
  const answer = async (b) => {
    try {
      if (b.method === 'getSignaturesForAddress') { requests.list++; onList?.(b.params[1]); return { jsonrpc: '2.0', id: b.id, result: await sim.getSignaturesForAddress(b.params[0], b.params[1]) }; }
      if (b.method === 'getTransaction') { requests.tx++; return { jsonrpc: '2.0', id: b.id, result: await sim.getTransaction(b.params[0]) }; }
      throw new Error(`no ${b.method}`);
    } catch (e) { return { jsonrpc: '2.0', id: b.id, error: { code: -32020, message: e.message } }; }
  };
  const fetchImpl = async (_u, init) => { const j = JSON.parse(init.body); return new Response(JSON.stringify(Array.isArray(j) ? await Promise.all(j.map(answer)) : await answer(j)), { status: 200 }); };
  return { fetchImpl, requests };
}

test('O7 a transaction re-orged into another slot is read again: the cache entry whose slot disagrees with the listing is evicted', async () => {
  const m = mandate(); const sim = chainSim();
  const G = sim.add('GRANT', grantAt(m, 1000));
  sim.add('P0', payAt(1100));
  const R = sim.add('REVOKE', tokenIx('revoke', { source: SRC, owner: A.principal }, 1300));
  sim.setAccount(SRC, live(m));
  const n = nodeOver(sim);
  const rpc = makeRpc('https://rpc.example.com', { fetchImpl: n.fetchImpl, rate: 1000, burst: 100 });
  const first = await createGrantChecker(rpc).supersededBy(SRC, G);
  assert.equal(first.sig, R); assert.equal(first.slot, 1300);
  const t = sim.txs.find((x) => x.sig === R).tx; t.slot = 1350; t.blockTime = T0 + 1350; // the block was re-orged: the same transaction, another slot
  const again = await createGrantChecker(rpc).supersededBy(SRC, G); // a new state: the whole history is scanned again, the transaction comes from the cache
  assert.equal(again.sig, R); assert.equal(again.slot, 1350, 'the re-read transaction, not the cached one');
});

// ---- a node that answers jsonParsed without transaction.signatures
const bh = '11111111111111111111111111111111';
for (const variant of ['with transaction.signatures', 'without transaction.signatures']) {
  test(`O7 a restart counts each settled payment once (${variant})`, async (tc) => {
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'o7sig-'));
    tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
    const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '10000' } });
    const getBlockhash = async () => ({ blockhash: bh, lastValidBlockHeight: 100n, contextSlot: 10 });
    const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash, now: () => NOW, dataDir });
    const a = await make();
    assert.deepEqual([await out(a.fetch(seller.url)), await out(a.fetch(seller.url))], [200, 200]);
    const agentSigs = a.reservations.map((r) => r.agentSig); await a.close();
    // the chain now shows both payments
    const listing = [], newest = [];
    agentSigs.forEach((ag, i) => {
      const txSig = `LANDED${i}`.padEnd(88, 'l');
      const tx = payTx({ slot: 2000 + i, blockTime: NOW, amount: '10000', authority: s.signer.address });
      tx.transaction.message.recentBlockhash = bh;
      if (variant.startsWith('with ')) tx.transaction.signatures = [txSig, ag];
      seller.rpc.grants.set(txSig, tx); newest.unshift({ signature: txSig, slot: 2000 + i, blockTime: NOW, err: null }); listing.push(txSig);
    });
    seller.rpc.newer = newest;
    seller.rpc.account = liveAccount(s.mandate, { delegatedAmount: { amount: String(BigInt(s.mandate.total_cap) - 20000n) } });
    const b = await make();
    assert.equal(b.ledger.length, 2, `two payments, counted once each: ${JSON.stringify(b.ledger.map((x) => x.amount))}`);
    assert.equal(await out(b.fetch(seller.url)), 200, 'the third payment fits the budget of 30000');
    assert.equal(await out(b.fetch(seller.url)), 'period_over_budget');
    await b.close();
  });
}

// ---- two spellings of one data directory
test('O7 two spellings of one data directory are one directory: closing one agent does not remove the agent.lock of the other', async (tc) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'o7dir-'));
  const spelled = `${dataDir}/../${path.basename(dataDir)}`;
  const signer = await generateKeyPairSigner();
  const mk = (nonce, dir) => { const m = mandate({ agent: signer.address, nonce }); const g = `GR${nonce}`.padEnd(88, 'h'); const rpc = fakeRpc(); rpc.grants.set(g, grantTx(m)); rpc.account = liveAccount(m); return createAgent({ mandate: m, grant_tx: g, signer, rpc, getBlockhash: blockhash, now: () => NOW, dataDir: dir }); };
  const a = await mk('ab'.repeat(16), dataDir), b = await mk('cd'.repeat(16), spelled);
  tc.after(async () => { await b.close().catch(() => {}); await a.close().catch(() => {}); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const lock = path.join(dataDir, 'agent.lock');
  assert.ok(fs.existsSync(lock));
  await a.close();
  assert.ok(fs.existsSync(lock), 'b still runs in that directory: its rollback guard stays');
  await b.close();
  assert.ok(!fs.existsSync(lock), 'and goes with the last agent');
});

// ---- read amplification of repeated -32020 restarts
test('O7 a node that keeps forgetting the cursor cannot make every payment re-read the whole history: restarts are capped per grant per hour and fail closed (busy)', async () => {
  const m = mandate(); const sim = chainSim();
  const G = sim.add('GRANT', grantAt(m, 1000));
  for (let i = 0; i < 450; i++) sim.add(`P${String(i).padStart(3, '0')}`, payAt(1100 + i)); // 5 pages of 100
  sim.setAccount(SRC, live(m));
  let flap = false;
  const raw = sim.getSignaturesForAddress.bind(sim);
  sim.getSignaturesForAddress = async (addr, o = {}) => { if (flap && o.before && sim.txs.findIndex((t) => t.sig === o.before) > 300) throw new Error(`Transaction ${o.before} not found`); return raw(addr, o); }; // a load balancer: the node behind a deep cursor does not know it
  const n = nodeOver(sim);
  const rpc = makeRpc('https://rpc.example.com', { fetchImpl: n.fetchImpl, rate: 1000, burst: 100, sleep: async () => {} });
  const store = new Map(); const scanStore = { get: (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined), put: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))) };
  const checker = createGrantChecker(rpc, { scanStore });
  const perCall = [];
  flap = true;
  let last = null;
  for (let i = 0; i < 14; i++) { const before = n.requests.list; last = await checker.supersededBy(SRC, G).then(() => null, (e) => e); perCall.push(n.requests.list - before); }
  assert.equal(last?.busy, true, 'beyond the cap the scan fails closed as busy, which the gate answers with 503');
  const late = perCall.slice(8);
  const FAILING_PAGE = 9; // the rpc client asks a cursor the node says it does not know 9 times before it gives up
  assert.ok(late.every((c) => c <= FAILING_PAGE), `calls after the cap read at most the one failing page (${FAILING_PAGE} requests): ${perCall}`);
});
