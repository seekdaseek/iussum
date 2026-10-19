// Property test (Addendum F, section 3). A seeded random test over the simulated chain: random histories for one principal and one agent, a
// REFERENCE MODEL written below from the README rules (it imports nothing from the resolver), and four invariants.
//   I1  on a fully readable chain every disputed payment gets the model's verdict and liable party, never history_incomplete
//   I2  with RPC faults a dispute gets the model's verdict or no verdict (liable null, not stored), never a different decided verdict
//   I3  at most one refund per payment, and only on a seller-liable verdict
//   I4  under random concurrency, lost responses, seller-supplied blockhash fields and restarts the agent never settles more than period_budget,
//       and an honest agent with a readable chain never refuses an in-scope payment for a history reason
// Deterministic: seed n always gives the same history. A failure prints the seed; PROPERTY_SEED=n reruns that one, PROPERTY_SEEDS=N sets the count.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { openStore, createResolver } from '@iussum/resolver';
import { mandateId } from '@iussum/core';
import { A, T0, SRC, SELLER_KEY, RES, mandate, receipt, payTx, grantTx } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig, tokenIx } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';
import { debitTx } from '../phase12/helpers.mjs';
import { selfTransfer, dustCredit, payWithExtraDebit, recreateTx } from './helpers.mjs';

const SEEDS = Number(process.env.PROPERTY_SEEDS ?? 600);
const ONE = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : null;
const seeds = ONE !== null ? [ONE] : Array.from({ length: SEEDS }, (_, i) => i + 1);

// ------------------------------------------------------------------ random numbers
function rngFor(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const int = (r, n) => Math.floor(r() * n);
const pick = (r, xs) => xs[int(r, xs.length)];
const hex = (r) => Array.from({ length: 16 }, () => int(r, 256).toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ generator: an abstract history, then the same history as chain transactions
// event kinds: pay (x402 TransferChecked), payExtra (x402 shape plus a second agent debit), hidden (agent debit outside x402), self (agent
// self-transfer), dust (a stranger credits the source), principal (the principal's own transfer), grant (a re-grant: M2), revoke, close, recreate.
function generate(seed) {
  const r = rngFor(seed);
  const ppm = pick(r, [20000, 50000]);
  const base = { total_cap: '10000000', per_payment_max: String(ppm), period_budget: String(pick(r, [60000, 100000, 200000])), period_seconds: pick(r, [500, 2000, 100000]) };
  const M1 = mandate({ ...base, nonce: hex(r) });
  const M2 = mandate({ ...base, per_payment_max: String(ppm / 2), period_budget: String(pick(r, [40000, 120000])), nonce: hex(r) });
  const events = [{ kind: 'grant', mandate: M1, slot: 1000, label: 'G1' }];
  let slot = 1000, ended = false;
  const special = r() < 0.5 ? pick(r, ['regrant', 'revoke', 'close']) : null;
  const n = 4 + int(r, 11), specialAt = 1 + int(r, n);
  for (let i = 1; i <= n; i++) {
    slot += r() < 0.25 ? 0 : 1 + int(r, 300); // 25% of events share the slot of the one before (same-slot ties: block order = execution order)
    const label = `E${i}`;
    if (special && i === specialAt) {
      if (special === 'regrant') events.push({ kind: 'grant', mandate: M2, slot, label });
      else if (special === 'revoke') { events.push({ kind: 'revoke', slot, label }); ended = true; }
      else { events.push({ kind: 'close', slot, label }); ended = true; }
      continue;
    }
    const closed = events.some((e) => e.kind === 'close');
    const kinds = ended ? ['dust', 'principal', ...(closed ? ['recreate'] : [])] : ['pay', 'pay', 'pay', 'pay', 'pay', 'payExtra', 'hidden', 'self', 'dust', 'dust', 'principal'];
    const kind = pick(r, kinds);
    const e = { kind, slot, label };
    if (kind === 'pay' || kind === 'payExtra') { e.amount = pick(r, [5000, 10000, ppm, ppm + 1000]); e.payTo = pick(r, [A.sellerA, A.sellerA, A.sellerB, A.sellerC]); e.resourceIn = r() < 0.7; }
    if (kind === 'hidden') { e.hidden = pick(r, ['transfer', 'burn', 'burnChecked', 'cpi']); e.amount = pick(r, [5000, 10000, 20000]); }
    if (kind === 'self') e.selfKind = pick(r, ['transfer', 'transferChecked']);
    if (kind === 'recreate') ended = true;
    events.push(e);
  }
  events.forEach((e, ord) => { e.ord = ord; });
  return { r, M1, M2: events.find((e) => e.kind === 'grant' && e.label !== 'G1')?.mandate ?? null, events };
}

async function build(h) {
  const c = chainSim();
  let account = live(h.M1);
  for (const e of h.events) {
    let tx;
    switch (e.kind) {
      case 'grant': tx = grantAt(e.mandate, e.slot); account = live(e.mandate); break;
      case 'pay': tx = payAt(e.slot, { amount: String(e.amount), payTo: e.payTo }); break;
      case 'payExtra': tx = await payWithExtraDebit(e.slot, { amount: String(e.amount), payTo: e.payTo }); break;
      case 'hidden': tx = debitTx(e.hidden, { slot: e.slot, amount: String(e.amount) }); break;
      case 'self': tx = selfTransfer(e.selfKind, { slot: e.slot }); break;
      case 'dust': tx = dustCredit(e.slot); break;
      case 'principal': tx = payAt(e.slot, { authority: A.principal, payTo: A.sellerB, amount: '1000' }); break;
      case 'revoke': tx = tokenIx('revoke', { source: SRC, owner: A.principal }, e.slot); account = live(h.M1, { delegate: undefined, delegatedAmount: undefined }); break;
      case 'close': { tx = tokenIx('closeAccount', { account: SRC, destination: A.principal, owner: A.principal }, e.slot); tx.meta.preTokenBalances = [{ accountIndex: 1, mint: A.asset, owner: A.principal, uiTokenAmount: { amount: '0', decimals: 6 } }]; tx.meta.postTokenBalances = []; account = null; break; }
      case 'recreate': tx = recreateTx(e.slot); account = { data: { parsed: { info: { owner: A.principal, mint: A.asset, delegatedAmount: { amount: '0' } } } } }; break;
      default: throw new Error(e.kind);
    }
    c.add(e.label, tx);
  }
  c.setAccount(SRC, account);
  return c;
}

// ------------------------------------------------------------------ the reference model (README rules, no resolver code)
const PRIORITY = ['amount_over_cap', 'pay_to_not_allowed', 'resource_not_allowed', 'period_over_budget'];
const agentDebits = (e) => (e.kind === 'pay' || e.kind === 'payExtra' ? [Number(e.amount)] : e.kind === 'hidden' ? [Number(e.amount)] : []);
function model(h, Mx, target, withReceipt) {
  const ev = h.events;
  const grantOrd = ev.find((e) => e.kind === 'grant' && e.mandate === Mx).ord;
  // a later re-grant, a revoke or a close of the source supersedes the mandate from that point on (README item 3)
  const sup = ev.find((e) => e.ord > grantOrd && (e.kind === 'revoke' || e.kind === 'close' || (e.kind === 'grant' && e.mandate !== Mx)));
  if (sup && sup.ord < target.ord) return { liable: null, why: 'mandate superseded before the payment' };
  const isAgentDebit = ['pay', 'payExtra', 'hidden'].includes(target.kind);
  if (!isAgentDebit) return { liable: null, why: 'not a debit signed by the agent' }; // self-transfer, principal transfer: nothing the agent paid
  if (target.ord < grantOrd) return { liable: null, why: 'made before the grant' };
  if (target.kind === 'hidden' || target.kind === 'payExtra') return { verdict: 'valid', reason: 'debit_not_x402', liable: 'agent_operator' }; // cannot have gone through x402 or a seller gate
  const violations = [];
  if (target.amount > Number(Mx.per_payment_max)) violations.push('amount_over_cap');
  if (![A.sellerA, A.sellerB].includes(target.payTo)) violations.push('pay_to_not_allowed');
  if (withReceipt && !target.resourceIn) violations.push('resource_not_allowed'); // the resource is known only from a seller receipt
  // the period budget: every debit the agent signed since the grant, in the target's period, up to and including the target
  const periodOf = (slot) => Math.floor((slot - 0) / Mx.period_seconds); // not_before = T0 and block time = T0 + slot
  let spent = 0;
  for (const e of ev) if (e.ord > grantOrd && e.ord <= target.ord && periodOf(e.slot) === periodOf(target.slot)) for (const a of agentDebits(e)) spent += a;
  if (spent > Number(Mx.period_budget)) violations.push('period_over_budget');
  if (!violations.length) return { verdict: 'invalid', reason: 'in_scope', liable: 'principal' };
  const visible = violations.some((v) => v !== 'period_over_budget');
  const reason = PRIORITY.find((p) => violations.includes(p));
  return { verdict: 'valid', reason, liable: visible && withReceipt ? 'seller' : 'agent_operator' };
}

// ------------------------------------------------------------------ running a dispute
const G = (Mx, h) => sig(h.events.find((e) => e.kind === 'grant' && e.mandate === Mx).label);
function receiptFor(h, Mx, e) {
  return receipt({ mandate_id: mandateId(Mx), grant_tx: G(Mx, h), tx_sig: sig(e.label), amount: String(e.amount), pay_to: e.payTo, payer: A.agent, settled_at: T0 + e.slot, resource: e.resourceIn ? `${RES}quote` : 'https://other.example/x' });
}
function makeService(rpc, { refunds = null } = {}) {
  const store = openStore();
  const sendRefund = refunds ? async (p, { onSigned }) => { const s = `R${refunds.length}`.padEnd(88, 'r'); await onSigned(s); refunds.push(p.reason); return s; } : null;
  return { store, svc: createResolver({ rpc, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, sendRefund, now: () => T0 + 999999 }) };
}
function targets(h) {
  const r = rngFor(h.seed * 7 + 1);
  const all = h.events.filter((e) => ['pay', 'payExtra', 'hidden', 'self', 'principal'].includes(e.kind));
  return [...all].sort(() => r() - 0.5).slice(0, 6);
}
function chosenMandate(h, e, r) {
  const current = h.M2 && e.ord > h.events.find((x) => x.mandate === h.M2).ord ? h.M2 : h.M1;
  if (h.M2 && r() < 0.2) return current === h.M1 ? h.M2 : h.M1;
  return current;
}
const describe = (h, seed, e, Mx, withReceipt) => `seed ${seed}: dispute ${e.label} (${e.kind}) under ${Mx === h.M1 ? 'M1' : 'M2'} ${withReceipt ? 'with' : 'without'} receipt; history ${h.events.map((x) => `${x.label}:${x.kind}@${x.slot}`).join(' ')}`;
const same = (v, m) => v.liable === m.liable && (m.liable === null || (v.verdict === m.verdict && v.reason === m.reason));

test(`property I1: ${seeds.length} random histories, every dispute gets the model's verdict on a readable chain (seeds ${seeds[0]}..${seeds.at(-1)})`, async () => {
  let disputes = 0, decided = 0;
  for (const seed of seeds) {
    const h = generate(seed); h.seed = seed;
    const r = rngFor(seed * 31 + 5);
    const c = await build(h);
    for (const e of targets(h)) {
      const Mx = chosenMandate(h, e, r);
      const withReceipt = e.kind === 'pay' && r() < 0.5;
      const m = model(h, Mx, e, withReceipt);
      const { svc, store } = makeService(c);
      const v = await svc.dispute({ tx_sig: sig(e.label), mandate: Mx, grant_tx: G(Mx, h), receipt: withReceipt ? receiptFor(h, Mx, e) : null });
      disputes++; if (m.liable !== null) decided++;
      const ctx = describe(h, seed, e, Mx, withReceipt);
      assert.notEqual(v.reason, 'history_incomplete', `${ctx}\n${JSON.stringify(v)}`);
      assert.ok(same(v, m), `${ctx}\nmodel ${JSON.stringify(m)}\ncode  ${JSON.stringify({ verdict: v.verdict, reason: v.reason, liable: v.liable })}\n${JSON.stringify(v.delta)}`);
      assert.equal(store.count(), m.liable === null ? 0 : 1, ctx);
    }
  }
  console.log(`property I1: ${seeds.length} histories (seeds ${seeds[0]}..${seeds.at(-1)}), ${disputes} disputes, ${decided} with a decided model verdict`);
  assert.ok(ONE !== null || decided > disputes / 3, 'the generator produces enough decided cases');
});

test(`property I2: RPC faults give the model's verdict or no verdict, never a different decided verdict (${seeds.length} histories)`, async () => {
  let none = 0, same_ = 0;
  for (const seed of seeds) {
    const h = generate(seed); h.seed = seed;
    const r = rngFor(seed * 17 + 3);
    for (const e of targets(h)) {
      const Mx = chosenMandate(h, e, r);
      const withReceipt = e.kind === 'pay' && r() < 0.5;
      const m = model(h, Mx, e, withReceipt);
      const c = await build(h);
      const fault = pick(r, ['unreadable', 'block', 'heal']);
      const victim = pick(r, h.events);
      if (fault === 'unreadable') { const o = c.getTransaction.bind(c); c.getTransaction = async (s) => (s === sig(victim.label) ? null : o(s)); }
      if (fault === 'block') c.hiddenBlocks.add(victim.slot);
      if (fault === 'heal') { let left = 3; const o = c.getTransaction.bind(c); c.getTransaction = async (s) => (s === sig(victim.label) && left-- > 0 ? null : o(s)); } // not found, then it heals
      const { svc, store } = makeService(c);
      const v = await svc.dispute({ tx_sig: sig(e.label), mandate: Mx, grant_tx: G(Mx, h), receipt: withReceipt ? receiptFor(h, Mx, e) : null });
      const ctx = `${describe(h, seed, e, Mx, withReceipt)}\nfault ${fault} on ${victim.label}`;
      if (v.liable === null) { assert.equal(store.count(), 0, `${ctx}: no verdict means nothing stored`); none++; }
      else { assert.ok(same(v, m), `${ctx}\nmodel ${JSON.stringify(m)}\ncode  ${JSON.stringify({ verdict: v.verdict, reason: v.reason, liable: v.liable })}`); same_++; }
    }
  }
  console.log(`property I2: ${none} disputes with no verdict, ${same_} with the model's verdict, 0 different`);
});

test('property I3: at most one refund per payment, and only on a seller-liable verdict (200 histories)', async () => {
  let refundsPaid = 0;
  for (const seed of seeds.slice(0, 200)) {
    const h = generate(seed); h.seed = seed;
    const c = await build(h);
    const refunds = [];
    const { svc, store } = makeService(c, { refunds });
    for (const e of h.events.filter((x) => x.kind === 'pay')) {
      const Mx = h.M2 && e.ord > h.events.find((x) => x.mandate === h.M2).ord ? h.M2 : h.M1;
      const genuine = receiptFor(h, Mx, e);
      const forged = receipt({ mandate_id: mandateId(Mx), grant_tx: G(Mx, h), tx_sig: sig(e.label), amount: String(e.amount), pay_to: e.payTo, payer: A.agent, settled_at: T0 + e.slot + 1, resource: `${RES}other` });
      const before = refunds.length;
      for (const rc of [null, genuine, forged, genuine, null, forged]) await svc.dispute({ tx_sig: sig(e.label), mandate: Mx, grant_tx: G(Mx, h), receipt: rc });
      const paid = refunds.length - before;
      const stored = store.get(sig(e.label));
      assert.ok(paid <= 1, `seed ${seed} ${e.label}: ${paid} refunds`);
      if (paid === 1) assert.equal(stored.verdict.liable, 'seller', `seed ${seed} ${e.label}: a refund needs a seller-liable verdict`);
      refundsPaid += paid;
    }
  }
  console.log(`property I3: ${refundsPaid} refunds over 200 histories, never two for one payment`);
});

// ------------------------------------------------------------------ I4: the agent
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
test('property I4: the agent never settles more than period_budget under concurrency, lost responses, seller blockhash fields and restarts (60 seeds)', async (tc) => {
  const NOW = T0 + 1000;
  let settledTotal = 0, refusals = 0, restarts = 0;
  for (const seed of seeds.slice(0, 60)) {
    const r = rngFor(seed * 101 + 9);
    const price = pick(r, [10000, 20000]), budget = pick(r, [30000, 50000, 70000]);
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: String(price) });
    const s = await newScenario(seller, { mandate: { period_budget: String(budget), per_payment_max: String(price), total_cap: '10000000' } });
    seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 1 }, value: true }; if (m === 'getBlockHeight') return 1000; throw new Error(`unexpected rpc call ${m}`); }; // the chain: height 1000 and no blockhash ever expires in this test
    let mirrored = 0, dropNext = 0, tamper = false, withhold = 0;
    const withheld = []; // payloads a seller keeps (answers 502) and may land later
    const ctxs = `seed ${seed} price ${price} budget ${budget}`;
    // mirror every payment the facilitator settled onto the fake chain, so a restarted agent can rebuild its ledger from it
    const sync = () => {
      for (; mirrored < facilitator.counts.settle; mirrored++) {
        const id = `MOCKSETTLE${mirrored + 1}`.padEnd(88, 'x');
        seller.rpc.grants.set(id, payTx({ slot: 2000 + mirrored, blockTime: T0 + 500, amount: String(price), authority: s.signer.address }));
        seller.rpc.newer = [{ signature: id, slot: 2000 + mirrored, blockTime: T0 + 500, err: null }, ...seller.rpc.newer];
      }
      seller.rpc.account = { data: { parsed: { info: { owner: s.mandate.principal, mint: s.mandate.asset, delegate: s.mandate.agent, delegatedAmount: { amount: String(10000000 - mirrored * price) } } } } };
    };
    const wrapper = async (req) => {
      const paid = !!req.headers?.get?.('payment-signature');
      if (paid && withhold > 0) { withhold--; withheld.push(req.headers.get('payment-signature')); return new Response('{}', { status: 502 }); } // the seller keeps the payload and answers 502
      const res = await realFetch(req);
      if (paid && dropNext > 0) { dropNext--; throw new TypeError('fetch failed: socket hang up'); } // settled, response lost
      if (res.status === 402 && tamper && res.headers.get('payment-required')) {
        const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString());
        pr.accepts[0].extra = { ...pr.accepts[0].extra, recentBlockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 1 + int(r, 5) };
        const hd = new Headers(res.headers); hd.set('payment-required', Buffer.from(JSON.stringify(pr)).toString('base64'));
        return new Response(await res.text(), { status: 402, headers: hd });
      }
      return res;
    };
    // the agent captures the global fetch when it is created, so the wrapper (lost responses, tampered 402s) is installed only for that moment
    const make = async () => { globalThis.fetch = wrapper; try { return await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW }); } finally { globalThis.fetch = realFetch; } };
    let agent = await make();
    try {
      for (let step = 0; step < 6; step++) {
        const op = r();
        if (op < 0.12) { dropNext = 1 + int(r, 2); }
        else if (op < 0.24) withhold = 1 + int(r, 2);
        else if (op < 0.34) tamper = !tamper;
        else if (op < 0.42 && dropNext === 0 && withheld.length === 0 && withhold === 0) { sync(); agent = await make(); restarts++; } // restart: only when no response is outstanding, the ledger is rebuilt from the chain
        if (r() < 0.3) { for (const w of withheld.splice(0)) await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(w, 'base64').toString()) }) }); } // the seller lands what it kept
        const k = 1 + int(r, 5);
        const rs = await Promise.allSettled(Array.from({ length: k }, () => agent.fetch(seller.url)));
        for (const x of rs) if (x.status === 'rejected' && x.reason?.reason) { refusals++; assert.equal(x.reason.reason, 'period_over_budget', `${ctxs}: an honest agent refused for ${x.reason.reason}`); }
        assert.ok(facilitator.counts.settle * price <= budget, `${ctxs}: settled ${facilitator.counts.settle * price} > budget ${budget}`);
        for (const res of agent.reservations) assert.equal(res.blockhash == null || res.blockhash === '11111111111111111111111111111111', true, `${ctxs}: the agent used a blockhash the seller named`);
      }
      for (const w of withheld.splice(0)) await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(w, 'base64').toString()) }) }); // finally the seller lands everything it kept
      assert.ok(facilitator.counts.settle * price <= budget, `${ctxs}: after the seller landed what it kept, settled ${facilitator.counts.settle * price} > budget ${budget}`);
      settledTotal += facilitator.counts.settle;
    } finally { globalThis.fetch = realFetch; facilitator.close(); seller.close(); }
  }
  console.log(`property I4: 60 seeds, ${settledTotal} payments settled, ${refusals} local refusals (all period_over_budget), ${restarts} restarts, never above the budget`);
});
