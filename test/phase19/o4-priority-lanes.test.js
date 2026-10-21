// O4 (Addendum O). (a) The scan lanes split scan slots but not RPC tokens: cold scans' reads queued in the one bucket in front of a legitimate warm check. The bucket now has
// priority classes: everything except bulk reads goes first, bulk reads get one grant in four when both wait. (b) The warm lane was open to anyone's warm grant: a warm check
// whose listing shows nothing new takes no lane slot; a warm scan reads one page, one warm scan per account, and a full page continues in the cold lane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRpc, createGrantChecker } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { A, T0, SRC, mandate, grantTx, payTx, ata } from '../fixtures.mjs';
import { chainSim, grantAt, live } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';
import { startMockFacilitator, startSeller, blockhash, fakeRpc, liveAccount, newScenario } from '../harness.mjs';
import { generateKeyPairSigner } from '@solana/kit';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = T0 + 1000;
const ok = (b) => new Response(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: 1 }), { status: 200 });

test('O4a the bucket serves normal waiters before bulk ones, and bulk ones still get one grant in four', async () => {
  let t = 0; const order = [];
  const rpc = makeRpc('https://rpc.example.com', { rate: 1, burst: 1, now: () => t, sleep: async (ms) => { t += ms; }, fetchImpl: async (_u, init) => { const b = JSON.parse(init.body); order.push(b.method); return ok(b); } });
  const bulk = [0, 1, 2, 3].map((i) => rpc.call(`bulk${i}`, [], { priority: 'bulk' }));
  const normal = rpc.call('normal', []);
  await Promise.all([...bulk, normal]);
  assert.ok(order.indexOf('normal') <= 2, `served order: ${order}`);
  // with a steady stream of normal waiters the bulk ones are still served: one grant in four
  order.length = 0;
  const calls = [rpc.call('n-pre', [])];
  calls.push(rpc.call('b-first', [], { priority: 'bulk' }));
  for (let i = 0; i < 12; i++) calls.push(rpc.call(`n${i}`, []));
  await Promise.all(calls);
  assert.ok(order.indexOf('b-first') <= 4, `the bulk call waited behind ${order.indexOf('b-first')} normal ones: ${order}`);
});

// ---- r2: a local JSON-RPC node and the real gate on a real makeRpc
const nodeParts = () => {
  const lists = new Map(), txs = new Map(), accts = new Map(); const counts = { http: 0 };
  const answer = (b) => {
    const r = (result) => ({ jsonrpc: '2.0', id: b.id, result });
    if (b.method === 'getSignaturesForAddress') { const [addr, o = {}] = b.params; let l = lists.get(addr) ?? []; if (o.before) { const i = l.findIndex((x) => x.signature === o.before); l = i >= 0 ? l.slice(i + 1) : []; } if (o.until) { const i = l.findIndex((x) => x.signature === o.until); if (i >= 0) l = l.slice(0, i); } return r(l.slice(0, o.limit ?? 1000)); }
    if (b.method === 'getTransaction') return r(txs.get(b.params[0]) ?? null);
    if (b.method === 'getAccountInfo') return r({ context: { slot: 9_000_000 }, value: accts.get(b.params[0]) ?? null });
    return { jsonrpc: '2.0', id: b.id, error: { code: -32601, message: `no ${b.method}` } };
  };
  const srv = http.createServer((req, res) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { counts.http++; const j = JSON.parse(s); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(j) ? j.map(answer) : answer(j))); }); });
  return { lists, txs, accts, counts, srv };
};

test('O4a legitimate warm payments settle during four cold scans on accounts of the attacker\'s own, through ONE paced bucket (r2)', async (tc) => {
  const n = nodeParts(); await new Promise((r) => n.srv.listen(0, '127.0.0.1', r));
  const rpc = makeRpc(`http://127.0.0.1:${n.srv.address().port}`, { rate: 5, burst: 2 });
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => NOW, price: '10000', gateOpts: { rpc, grantCheckBudgetMs: 2000, retryAfterSeconds: 1 } });
  const agents = [];
  tc.after(async () => { for (const a of agents) await a.close(); seller.close(); facilitator.close(); n.srv.close(); });
  const allow = { pay_to: [A.sellerA], resource_prefix: [`${seller.origin}/v1/`] };
  const legitSigner = await generateKeyPairSigner();
  const lm = mandate({ agent: legitSigner.address, allow, nonce: 'aa'.repeat(16), period_budget: '1000000', per_payment_max: '20000' });
  const LG = 'LEGITGRANT'.padEnd(88, 'g');
  n.txs.set(LG, grantTx(lm)); n.accts.set(SRC, liveAccount(lm)); n.lists.set(SRC, [{ signature: LG, slot: 1000, err: null }]);
  const agentRpc = (g, src) => { const f = fakeRpc(); f.grants.set(g, n.txs.get(g)); f.account = n.accts.get(src); return f; };
  const mk = async (m, g, signer, src) => { const a = await createAgent({ mandate: m, grant_tx: g, signer, rpc: agentRpc(g, src), getBlockhash: blockhash, now: () => NOW, localChecks: false, retry: { max: 0 } }); agents.push(a); return a; };
  const pay = async (a) => { const r = await a.fetch(seller.url); await r.text(); return r.status; };
  const legit = await mk(lm, LG, legitSigner, SRC);
  assert.equal(await pay(legit), 200); assert.equal(await pay(legit), 200);
  const attackers = [];
  for (const [i, p] of [A.sellerB, A.sellerC, A.thief, A.agent].entries()) {
    const sg = await generateKeyPairSigner(); const src = await ata(p);
    const m = mandate({ principal: p, agent: sg.address, allow, nonce: (0xb0 + i).toString(16).repeat(16) });
    const g = `ATKGRANT${i}`.padEnd(88, 'g'); n.txs.set(g, grantTx(m, { source: src })); n.accts.set(src, liveAccount(m));
    const l = []; for (let k = 0; k < 2000; k++) { const s = `A${i}H${k}`.padEnd(88, 'h'); n.txs.set(s, payTx({ noTransfer: true, slot: 100000 - k })); l.push({ signature: s, slot: 100000 - k, err: null }); }
    l.push({ signature: g, slot: 1000, err: null }); n.lists.set(src, l);
    attackers.push(await mk(m, g, sg, src));
  }
  const atk = Promise.all(attackers.map(pay));
  await sleep(300);
  const during = []; for (let k = 0; k < 3; k++) { during.push(await pay(legit)); await sleep(300); }
  assert.deepEqual(during, [200, 200, 200], `legit payments during the attack: ${during}`);
  assert.deepEqual(await atk, [503, 503, 503, 503]);
});

test('O4b a warm check whose listing shows nothing new takes no lane slot, even when the warm lane is held by slow scans of other accounts (r3)', async (tc) => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => NOW, price: '10000', gateOpts: { grantCheckBudgetMs: 700, retryAfterSeconds: 1 } });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const rpc = seller.rpc; const attackerGrants = new Set(); let slow = false; const o = rpc.getSignaturesForAddress.bind(rpc);
  rpc.getSignaturesForAddress = async (addr, opts = {}) => { if (slow && attackerGrants.has(opts.until)) await sleep(2500); return o(addr, opts); };
  const ar = fakeRpc(); ar.grants = rpc.grants; ar.account = rpc.account;
  const agents = [];
  tc.after(async () => { for (const a of agents) await a.close(); seller.close(); facilitator.close(); });
  const mk = async (m, g) => { const a = await createAgent({ mandate: m, grant_tx: g, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => NOW, localChecks: false, retry: { max: 0 } }); agents.push(a); return a; };
  const pay = async (a) => { const r = await a.fetch(seller.url); await r.text(); return r.status; };
  const legit = await mk(s.mandate, s.grant_tx);
  assert.equal(await pay(legit), 200);
  const atk = [];
  for (let i = 0; i < 2; i++) { const m = { ...s.mandate, nonce: (0xc0 + i).toString(16).repeat(16) }; const g = `WRM${i}`.padEnd(88, 'w'); rpc.grants.set(g, grantTx(m)); attackerGrants.add(g); atk.push(await mk(m, g)); }
  assert.deepEqual(await Promise.all(atk.map(pay)), [200, 200], 'the attacker\'s two grants are scanned once: warm');
  slow = true; const attack = Promise.all(atk.map(pay));
  await sleep(100);
  const during = []; for (let k = 0; k < 3; k++) { during.push(await pay(legit)); await sleep(200); }
  assert.deepEqual(during, [200, 200, 200], `legit payments during the attack: ${during}`);
  await attack;
});

// ---- the lane rules on the checker itself
const accounts = async () => {
  const grants = new Map(), accts = new Map(), lists = new Map(), delays = new Map(), st = { inflight: new Map(), peak: new Map(), calls: [] };
  const add = async (p, nonce) => { const m = mandate({ principal: p, nonce: nonce.toString(16).padStart(32, '0') }); const src = await ata(p); const sig = `L${nonce}`.padEnd(88, 'g'); grants.set(sig, grantTx(m, { source: src })); accts.set(src, liveAccount(m)); lists.set(src, [{ signature: sig, slot: 1000, err: null }]); return { m, sig, src }; };
  const rpc = {
    async getTransaction(sig) { return grants.get(sig) ?? (rpc.extra.get(sig) ?? null); },
    async getAccountInfoParsed(addr) { return accts.get(addr) ?? null; },
    async getSignaturesForAddress(addr, o = {}) {
      st.calls.push({ addr, limit: o.limit, before: o.before, priority: o.priority });
      const scanPage = o.limit !== 1; // a probe of one signature is not a scan
      if (scanPage) { st.inflight.set(addr, (st.inflight.get(addr) ?? 0) + 1); st.peak.set(addr, Math.max(st.peak.get(addr) ?? 0, st.inflight.get(addr))); }
      try { await sleep(delays.get(addr) ?? 0); let l = lists.get(addr) ?? []; if (o.before) { const i = l.findIndex((x) => x.signature === o.before); l = i >= 0 ? l.slice(i + 1) : []; } if (o.until) { const i = l.findIndex((x) => x.signature === o.until); if (i >= 0) l = l.slice(0, i); } return l.slice(0, o.limit ?? 1000); }
      finally { if (scanPage) st.inflight.set(addr, st.inflight.get(addr) - 1); }
    },
    extra: new Map(), async call() { throw new Error('unexpected'); },
  };
  const addHistory = (src, n, from = 0) => { const l = lists.get(src); for (let k = 0; k < n; k++) { const s = `H${src.slice(0, 4)}${from + k}`.padEnd(88, 'h'); rpc.extra.set(s, dustCredit(5000 + from + k)); l.unshift({ signature: s, slot: 5000 + from + k, err: null }); } };
  return { rpc, add, st, delays, addHistory };
};
const P = [A.sellerB, A.sellerC, A.thief, A.agent, A.sellerA, A.principal];

test('O4b one warm scan per source account: two questions about one grant (a gate and a resolver) scan one after the other', async () => {
  const n = await accounts(); const g1 = await n.add(P[0], 1);
  const checker = createGrantChecker(n.rpc);
  await Promise.all([checker.supersededBy(g1.src, g1.sig), checker.supersededBy(g1.src, g1.sig, { first: true })]); // warm both
  n.addHistory(g1.src, 5); n.delays.set(g1.src, 80); n.st.peak.clear();
  await Promise.all([checker.supersededBy(g1.src, g1.sig), checker.supersededBy(g1.src, g1.sig, { first: true })]);
  assert.equal(n.st.peak.get(g1.src), 1, 'never two scans of one account at once');
});

test('O4b a warm scan reads one page; a full page gives the warm slot back and the rest runs in the cold lane', async () => {
  const n = await accounts(); const g = await n.add(P[0], 11);
  const checker = createGrantChecker(n.rpc);
  await checker.check(g.m, g.sig, { active: true }); // warm
  n.addHistory(g.src, 250); n.st.calls.length = 0; n.delays.set(g.src, 150);
  let during = null;
  const run = checker.check(g.m, g.sig, { active: true });
  await sleep(380); during = checker.stats(); // the first page is done, the second is being read
  await run;
  assert.equal(during.warmRunning, 0, 'the warm slot was given back after one page');
  assert.ok(during.coldRunning >= 1, 'and the continuation runs in the cold lane');
  assert.ok(n.st.calls.length >= 3, `all three pages were read (${n.st.calls.length} calls)`);
});

test('O4b with the warm lane held by slow scans, a warm check that finds something new waits for a slot only up to its budget and a check with nothing new is answered at once', async () => {
  const n = await accounts(); const a1 = await n.add(P[0], 21), a2 = await n.add(P[1], 22), legit = await n.add(P[5], 23);
  const checker = createGrantChecker(n.rpc, { maxWarmScans: 2 });
  for (const g of [a1, a2, legit]) await checker.check(g.m, g.sig, { active: true });
  n.addHistory(a1.src, 3); n.addHistory(a2.src, 3); n.delays.set(a1.src, 400); n.delays.set(a2.src, 400);
  const holders = [checker.check(a1.m, a1.sig, { active: true }), checker.check(a2.m, a2.sig, { active: true })];
  await sleep(60);
  const t = Date.now(); const r = await checker.check(legit.m, legit.sig, { active: true });
  assert.equal(r.ok, true); assert.ok(Date.now() - t < 200, `the check with nothing new took ${Date.now() - t} ms`);
  await Promise.all(holders);
});
