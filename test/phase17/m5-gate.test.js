// M5 (Addendum M): gate resource limits. (a) scan fan-out, an active check stops at the first superseding signature, (b) the grant cache is bounded, (c) an unknown
// grant costs one read, (d) the budget timer does not leak and a budget above 2^31-1 is refused at start, (e) observe mode on a cold check still runs the scope checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker, mandateId } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { A, T0, SRC, mandate, grantTx } from '../fixtures.mjs';
import { chainSim, grantAt, live } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, GRANT_SIG, liveAccount } from '../harness.mjs';
import { createSellerGate } from '@iussum/seller';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (i) => mandate({ nonce: i.toString(16).padStart(32, '0') });

test('M5 (a) supersession scans run at most a small number at a time, whatever the number of grants (r4)', async () => {
  const c = chainSim(); const K = 12, ms = [], gs = [];
  for (let i = 0; i < K; i++) { ms.push(mk(i)); gs.push(c.add(`G${i}`, grantAt(ms[i], 1000 + i))); }
  for (let i = 0; i < 250; i++) c.add(`D${i}`, dustCredit(2000 + i)); // 3 pages above every grant
  c.setAccount(SRC, live(ms[K - 1]));
  let inflight = 0, max = 0; const o = c.getSignaturesForAddress.bind(c);
  c.getSignaturesForAddress = async (...a) => { inflight++; max = Math.max(max, inflight); await sleep(30); try { return await o(...a); } finally { inflight--; } };
  const checker = createGrantChecker(c);
  await Promise.allSettled(gs.map((g) => checker.supersededBy(SRC, g)));
  assert.ok(max <= 4, `${max} signature pages in flight at once (one per running scan)`);
});

test('M5 (a) a queued scan waits its turn; a full queue answers busy, and the gate turns busy into 503 (not 403)', async () => {
  const c = chainSim(); const ms = [], gs = [];
  for (let i = 0; i < 6; i++) { ms.push(mk(i)); gs.push(c.add(`G${i}`, grantAt(ms[i], 1000 + i))); }
  for (let i = 0; i < 150; i++) c.add(`D${i}`, dustCredit(2000 + i));
  c.setAccount(SRC, live(ms[5]));
  const o = c.getSignaturesForAddress.bind(c); c.getSignaturesForAddress = async (...a) => { await sleep(40); return o(...a); };
  const checker = createGrantChecker(c, { maxScans: 1, maxQueuedScans: 2 });
  const rs = await Promise.all(gs.map((g, i) => checker.check(ms[i], g, { active: true })));
  assert.equal(rs.filter((r) => r.busy).length, 3, JSON.stringify(rs.map((r) => r.busy ?? r.ok)));
  assert.ok(rs.every((r) => r.busy || r.ok || /superseded by/.test(r.detail)), 'the others were answered by a scan that ran when its turn came (an earlier grant is superseded by a later one on the same account)');
});

test('M5 (a) the gate answers 503 with Retry-After at once for a check that finds no scan slot (not 403), while the running scan completes', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: 5000, retryAfterSeconds: 1, maxConcurrentScans: 1, maxQueuedScans: 0 } });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const rpc = seller.rpc;
  const dust = Array.from({ length: 150 }, (_, i) => `DUST${i}`.padEnd(88, 'x'));
  for (const [i, d] of dust.entries()) rpc.grants.set(d, dustCredit(1001 + i));
  rpc.newer = dust.map((signature) => ({ signature, err: null })).reverse();
  const o = rpc.getSignaturesForAddress.bind(rpc); rpc.getSignaturesForAddress = async (...a) => { await sleep(200); return o(...a); };
  const m2 = { ...s.mandate, nonce: 'cd'.repeat(16) }; const G2 = 'G2'.padEnd(88, 'y'); rpc.grants.set(G2, grantTx(m2));
  const ar = fakeRpc(); ar.grants = rpc.grants; ar.account = rpc.account;
  const a1 = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const a2 = await createAgent({ mandate: m2, grant_tx: G2, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const p1 = a1.fetch(seller.url); await sleep(50);
  const r2 = await a2.fetch(seller.url); await r2.text();
  const r1 = await p1; await r1.text();
  assert.equal(r1.status, 200); assert.equal(r2.status, 503, 'the second grant found no slot: 503, not an out-of-scope 403');
  assert.ok(r2.headers.get('retry-after'));
  assert.equal(facilitator.counts.settle, 1);
  await a1.close(); await a2.close(); seller.close(); facilitator.close();
});

test('M5 (a) an active check stops at the first superseding signature it finds', async () => {
  const c = chainSim(); const M1 = mk(1), M2 = mk(2);
  const G1 = c.add('G1', grantAt(M1, 1000));
  for (let i = 0; i < 250; i++) c.add(`D${i}`, dustCredit(1001 + i));
  c.add('G2', grantAt(M2, 5000)); c.setAccount(SRC, live(M2));
  const checker = createGrantChecker(c);
  const r = await checker.check(M1, G1, { active: true });
  assert.equal(r.ok, false); assert.match(r.detail, /superseded by/);
  assert.equal(c.calls.pages.length, 1, `${c.calls.pages.length} pages read: the newest page already holds the superseding grant`);
  // the resolver asks for the EARLIEST superseding transaction and still reads everything
  const c2 = chainSim(); const H1 = c2.add('G1', grantAt(M1, 1000)); for (let i = 0; i < 250; i++) c2.add(`D${i}`, dustCredit(1001 + i)); c2.add('G2', grantAt(M2, 5000)); c2.setAccount(SRC, live(M2));
  await createGrantChecker(c2).supersededBy(SRC, H1);
  assert.equal(c2.calls.pages.length, 3);
});

test('M5 (b) the grant cache is bounded and a grant_mismatch is not cached per mandate id (r8)', async () => {
  const c = chainSim(); const M = mk(1); const G = c.add('G1', grantAt(M, 1000)); c.setAccount(SRC, live(M));
  const checker = createGrantChecker(c);
  for (let i = 0; i < 3000; i++) await checker.check(mk(10_000 + i), G, { active: false });
  assert.equal(checker.stats().grants, 0, `${checker.stats().grants} cached grant inspections after 3000 distinct mandate ids that do not match the grant`);
  for (let i = 0; i < 1200; i++) { const m = mk(i); const g = c.add(`H${i}`, grantAt(m, 1000)); await checker.check(m, g, { active: false }); }
  assert.ok(checker.stats().grants <= 1000);
});

test('M5 (c) an unknown grant_tx costs one read inside a request, and an immediate repeat none (r11)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const ar = fakeRpc(); ar.grants = seller.rpc.grants; ar.account = seller.rpc.account;
  const unknown = 'U'.repeat(88);
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  // the agent carries a grant_tx that is not on chain: forge it in the extension through a second agent object with the unknown id
  const b = await createAgent({ mandate: s.mandate, grant_tx: unknown, signer: s.signer, rpc: Object.assign(fakeRpc(), { account: seller.rpc.account }), getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  seller.rpc.calls.getTransaction = 0;
  const t0 = Date.now();
  const statuses = [];
  for (let i = 0; i < 5; i++) { const r = await b.fetch(seller.url); statuses.push(r.status); await r.text(); }
  const calls = seller.rpc.calls.getTransaction;
  assert.ok(statuses.every((x) => x === 403), `${statuses}`); assert.ok(calls <= 2, `${calls} getTransaction calls for 5 requests with an unknown grant`); assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`); await b.close();
  await a.close(); seller.close(); facilitator.close();
});

test('M5 (d) the budget timer is cleared when the check rejects, and a budget outside 1..2^31-1 refuses to start (r5, r12)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: 60_000 } });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  seller.rpc.getAccountInfoParsed = async () => { throw new Error('rpc exploded'); }; // the grant read rejects
  const ar = fakeRpc(); ar.grants = seller.rpc.grants; ar.account = seller.rpc.account;
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
  const before = timers();
  for (let i = 0; i < 30; i++) { const r = await a.fetch(seller.url); await r.text(); }
  assert.ok(timers() - before < 5, `${timers() - before} Timeout handles left behind by 30 requests`);
  await a.close(); seller.close(); facilitator.close();
  const base = { mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: 'solana:x', rpc: fakeRpc(), origin: 'http://127.0.0.1:1' };
  for (const bad of [2 ** 31, 2 ** 31 + 1, Infinity, NaN, 0, -5, '10']) assert.throws(() => createSellerGate({ ...base, grantCheckBudgetMs: bad }), /grantCheckBudgetMs/, String(bad));
  createSellerGate({ ...base, grantCheckBudgetMs: 2 ** 31 - 1 }).close();
});

test('M5 (e) observe mode on a cold check still runs the scope checks and marks the check as pending (r6)', async () => {
  const facilitator = await startMockFacilitator();
  const logs = [];
  const seller = await startSeller({ facilitator, mode: 'observe', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: 80, log: (x) => logs.push(x) } });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const o = seller.rpc.getSignaturesForAddress.bind(seller.rpc); seller.rpc.getSignaturesForAddress = async (...x) => { await sleep(400); return o(...x); };
  let seen = null; const mw = seller.gate.middleware; seller.gate.middleware = async (req, res, next) => mw(req, res, (e) => { seen = req.iussum; next(e); });
  const ar = fakeRpc(); ar.grants = seller.rpc.grants; ar.account = seller.rpc.account;
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const r = await a.fetch(seller.otherUrl); await r.text();
  assert.equal(r.status, 200, 'observe never blocks');
  assert.equal(seen.grant_check, 'pending');
  assert.ok(seen.violations.some((v) => v.code === 'resource_not_allowed'), JSON.stringify(seen.violations.map((v) => v.code)));
  await a.close(); seller.close(); facilitator.close();
});
