// N5 (Addendum N): three more ways the gate refused or blocked for ever. (a) a real grant the seller's node does not show yet answered 403 grant_not_found (the agent never
// retries a 403) and the miss was remembered; (b) maxConcurrentScans 0, negative or NaN; (c) a stored since or cursor that the node no longer knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker } from '@iussum/core';
import { createSellerGate } from '@iussum/seller';
import { createAgent } from '@iussum/agent';
import { A, T0, SRC, mandate } from '../fixtures.mjs';
import { chainSim, grantAt, live, sig } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('N5 (a) a grant the seller\'s node does not show yet is answered 503 + Retry-After (pending), never 403, memoised as pending, and settles once it shows (g3)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { notFoundTtlMs: 300, retryAfterSeconds: 1 } });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const grant = seller.rpc.grants.get(s.grant_tx); seller.rpc.grants.delete(s.grant_tx); // the seller's node does not show the grant yet
  const ar = fakeRpc(); ar.grants = new Map([[s.grant_tx, grant]]); ar.account = seller.rpc.account; // the agent's node does
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const r1 = await a.fetch(seller.url); await r1.text();
  assert.equal(r1.status, 503, 'pending, not a refusal'); assert.ok(r1.headers.get('retry-after'));
  const reads = seller.rpc.calls.getTransaction;
  const r2 = await a.fetch(seller.url); await r2.text();
  assert.equal(r2.status, 503); assert.equal(seller.rpc.calls.getTransaction, reads, 'the miss is remembered: no second read');
  seller.rpc.grants.set(s.grant_tx, grant); await sleep(350); // the node caught up and the memo expired
  const r3 = await a.fetch(seller.url); await r3.text();
  assert.equal(r3.status, 200); assert.equal(facilitator.counts.settle, 1);
  await a.close(); seller.close(); facilitator.close();
});

test('N5 (b) maxConcurrentScans must be an integer >= 1 and maxQueuedScans an integer >= 0, in the gate and in the checker (g5)', () => {
  const base = { mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: 'solana:x', rpc: chainSim(), origin: 'http://127.0.0.1:1' };
  for (const v of [0, -1, NaN, null, '2', 1.5, Infinity]) {
    assert.throws(() => createSellerGate({ ...base, maxConcurrentScans: v }).close(), /maxConcurrentScans/, `gate ${v}`);
    assert.throws(() => createGrantChecker(chainSim(), { maxScans: v }), /maxConcurrentScans/, `checker ${v}`);
  }
  for (const v of [-1, NaN, null, '2', 0.5]) {
    assert.throws(() => createSellerGate({ ...base, maxQueuedScans: v }).close(), /maxQueuedScans/, `gate queue ${v}`);
    assert.throws(() => createGrantChecker(chainSim(), { maxQueuedScans: v }), /maxQueuedScans/, `checker queue ${v}`);
  }
  createSellerGate({ ...base, maxConcurrentScans: 1, maxQueuedScans: 0 }).close(); createGrantChecker(chainSim(), { maxScans: 1, maxQueuedScans: 0 });
});

test('N5 (c) a stored since or cursor that the node no longer knows (-32020) restarts that grant\'s scan from the grant instead of failing for ever', async () => {
  const M1 = mandate({ nonce: '0f'.repeat(16) });
  for (const stored of ['since', 'cursor']) {
    const c = chainSim(); const G1 = c.add('G1', grantAt(M1, 1000));
    for (let i = 1; i <= 5; i++) c.add(`D${i}`, dustCredit(1000 + i));
    c.setAccount(SRC, live(M1));
    const STALE = 'STALE'.padEnd(88, 'x');
    const o = c.getSignaturesForAddress.bind(c);
    c.getSignaturesForAddress = async (addr, opts = {}) => { if (opts.until === STALE || opts.before === STALE) throw new Error(`getSignaturesForAddress: Transaction ${STALE} not found`); return o(addr, opts); };
    const disk = new Map();
    const key = `${SRC}:${G1}:first`;
    disk.set(key, JSON.stringify(stored === 'since' ? { since: STALE, superseded: null, completed: true } : { since: G1, superseded: null, partial: { cursor: STALE, newest: sig('D5'), found: [] } }));
    const scanStore = { get: (k) => (disk.has(k) ? JSON.parse(disk.get(k)) : undefined), put: (k, v) => disk.set(k, JSON.stringify(v)) };
    const checker = createGrantChecker(c, { scanStore });
    const r = await checker.check(M1, G1, { active: true });
    assert.equal(r.ok, true, `${stored}: ${JSON.stringify(r)}`);
    assert.notEqual(JSON.parse(disk.get(key)).since, STALE, 'the row was reset');
    // a node that keeps answering -32020 for the grant itself still fails closed (the reset happens once, from the grant)
    const c2 = chainSim(); const H1 = c2.add('G1', grantAt(M1, 1000)); c2.setAccount(SRC, live(M1));
    c2.getSignaturesForAddress = async () => { throw new Error(`getSignaturesForAddress: Transaction ${H1} not found`); };
    assert.equal((await createGrantChecker(c2).check(M1, H1, { active: true })).ok, false);
  }
});
