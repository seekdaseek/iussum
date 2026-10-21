// N3 (Addendum N): the global scan cap let anyone starve warm, legitimate grants into 503. A warm incremental scan (from a completed state) has its own small lane and
// never queues behind cold ones; one cold scan per source account at a time, so one account's grants cannot take every slot; a cold check for an account with no
// completed state keeps the cap and the queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker, mandateId } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { A, T0, mandate, grantTx, ata } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, liveAccount } from '../harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PRINCIPALS = [A.sellerB, A.sellerC, A.thief, A.agent, A.sellerA, A.principal];
// a tiny node: grants are found by signature, every signature page takes `delay(addr)` ms and is counted per account
async function node() {
  const grants = new Map(), accounts = new Map(), st = { inflight: new Map(), peak: new Map(), peakAll: 0, delays: new Map(), pages: [] };
  const sources = new Map();
  const add = async (i, nonce) => {
    const p = PRINCIPALS[i % PRINCIPALS.length];
    const m = mandate({ principal: p, nonce: nonce.toString(16).padStart(32, '0') });
    const src = sources.get(p) ?? await ata(p); sources.set(p, src);
    const sig = `G${i}_${nonce}`.padEnd(88, 'g');
    grants.set(sig, grantTx(m, { source: src })); accounts.set(src, liveAccount(m).data ? liveAccount(m) : null);
    return { m, sig, src };
  };
  const rpc = {
    async getTransaction(sig) { return grants.get(sig) ?? null; },
    async getAccountInfoParsed(addr) { return accounts.get(addr) ?? null; },
    async getSignaturesForAddress(addr) {
      st.pages.push(addr);
      st.inflight.set(addr, (st.inflight.get(addr) ?? 0) + 1); st.peak.set(addr, Math.max(st.peak.get(addr) ?? 0, st.inflight.get(addr)));
      const all = [...st.inflight.values()].filter((x) => x > 0).length; st.peakAll = Math.max(st.peakAll, all);
      try { await sleep(st.delays.get(addr) ?? 0); return []; } finally { st.inflight.set(addr, st.inflight.get(addr) - 1); }
    },
    async call() { throw new Error('unexpected'); },
  };
  return { rpc, add, st };
}

test('N3 one cold scan per source account: three grants of one account scan one after the other', async () => {
  const n = await node();
  const gs = []; for (let k = 0; k < 3; k++) gs.push(await n.add(0, 100 + k));
  n.st.delays.set(gs[0].src, 60);
  const checker = createGrantChecker(n.rpc);
  await Promise.all(gs.map((g) => checker.check(g.m, g.sig, { active: true })));
  assert.equal(n.st.peak.get(gs[0].src), 1, 'never two scans of one account at once');
});

test('N3 different accounts still scan in parallel, up to the cap', async () => {
  const n = await node();
  const gs = []; for (let k = 0; k < 6; k++) { const g = await n.add(k, 200 + k); gs.push(g); n.st.delays.set(g.src, 80); }
  const checker = createGrantChecker(n.rpc, { maxScans: 4, maxQueuedScans: 10 });
  await Promise.all(gs.map((g) => checker.check(g.m, g.sig, { active: true })));
  assert.ok(n.st.peakAll > 1 && n.st.peakAll <= 4, `${n.st.peakAll} accounts scanned at once`);
});

test('N3 a warm grant\'s incremental check is answered at once while cold scans hold every cold slot', async () => {
  const n = await node();
  const legit = await n.add(5, 300); // principal A.principal: the warm one
  const atk = []; for (let k = 0; k < 4; k++) atk.push(await n.add(k, 400 + k));
  const checker = createGrantChecker(n.rpc, { maxScans: 4, maxQueuedScans: 10 });
  assert.equal((await checker.check(legit.m, legit.sig, { active: true })).ok, true, 'the first check warms the grant');
  for (const g of atk) n.st.delays.set(g.src, 600);
  const cold = atk.map((g) => checker.check(g.m, g.sig, { active: true })); // all four cold slots busy
  await sleep(50);
  const t = Date.now();
  const r = await checker.check(legit.m, legit.sig, { active: true });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(!r.busy);
  assert.ok(Date.now() - t < 300, `the warm check took ${Date.now() - t} ms behind 600 ms cold scans`);
  await Promise.all(cold);
});

test('N3 a cold check for an account with no completed state keeps the cap and the queue: full queue answers busy', async () => {
  const n = await node();
  const gs = []; for (let k = 0; k < 6; k++) { const g = await n.add(k, 500 + k); gs.push(g); n.st.delays.set(g.src, 150); }
  const checker = createGrantChecker(n.rpc, { maxScans: 1, maxQueuedScans: 2 });
  const rs = await Promise.all(gs.map((g) => checker.check(g.m, g.sig, { active: true })));
  assert.equal(rs.filter((r) => r.busy).length, 3, JSON.stringify(rs.map((r) => r.busy ?? r.ok)));
});

test('N3 real gate (g2): legitimate warm payments settle during an attack with four grants on slow accounts', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: 400, retryAfterSeconds: 1 } });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const rpc = seller.rpc; const attackerGrants = new Set();
  const o = rpc.getSignaturesForAddress.bind(rpc);
  rpc.getSignaturesForAddress = async (addr, opts = {}) => { if (attackerGrants.has(opts.until)) await sleep(3000); return o(addr, opts); };
  const ar = fakeRpc(); ar.grants = rpc.grants; ar.account = rpc.account;
  const mk = (m, g) => createAgent({ mandate: m, grant_tx: g, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const legit = await mk(s.mandate, s.grant_tx);
  for (let i = 0; i < 2; i++) { const r = await legit.fetch(seller.url); await r.text(); assert.equal(r.status, 200); }
  const atk = [];
  for (let i = 0; i < 4; i++) { const m = { ...s.mandate, nonce: (0xa0 + i).toString(16).repeat(16) }; const g = `ATK${i}`.padEnd(88, 'z'); rpc.grants.set(g, grantTx(m)); attackerGrants.add(g); atk.push(await mk(m, g)); }
  const attack = Promise.all(atk.map(async (a) => { const x = await a.fetch(seller.url); await x.text(); return x.status; }));
  await sleep(100);
  const during = [];
  for (let k = 0; k < 3; k++) { const r = await legit.fetch(seller.url); await r.text(); during.push(r.status); }
  assert.deepEqual(during, [200, 200, 200], `legit payments during the attack: ${during}`);
  await attack;
  for (const a of [legit, ...atk]) await a.close(); seller.close(); facilitator.close();
});
