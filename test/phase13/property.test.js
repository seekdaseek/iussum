// Property test (Addendum F section 3, extended in Addendum G P1). A seeded random test over the simulated chain: random histories for one principal and
// one agent, a REFERENCE MODEL written below from the README rules (it imports nothing from the resolver), and these invariants.
//   I1  on a fully readable chain every disputed payment gets the model's verdict and liable party, never history_incomplete; with a tiny page size and
//       maxPages, history_incomplete for "more than N pages" is allowed and the verdict arrives after a few disputes (progress is kept)
//   I2  with RPC faults a dispute gets the model's verdict or no verdict (liable null, not stored), never a different decided verdict
//   I3  at most one refund per payment, and only on a seller-liable verdict
//   I4  under random concurrency, lost responses, seller-supplied blockhash fields, expired blockhashes, a lagging node and restarts (also while a seller
//       holds a payload) the agent never settles more than period_budget, and never refuses an in-scope payment for a history reason
//   I5  a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts
//   I6  a seller gate whose grant check is cold answers 503 with Retry-After, the agent retries with the SAME payload, and nothing is lost or doubled
// Phase 1.6 additions: a history node that lags after a proven expiry (I4), a same-mandate re-grant with a reused data directory (I4), batch responses with one null
// or errored element (I2, every history is read through getTransactions), the cold gate (I6).
// Deterministic: seed n always gives the same history. A failure prints the seed; PROPERTY_SEED=n reruns that one, PROPERTY_SEEDS=N sets the count.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getTransactionDecoder, getBase58Decoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { createAgent } from '@iussum/agent';
import { openStore, createResolver } from '@iussum/resolver';
import { mandateId } from '@iussum/core';
import { A, T0, SRC, SELLER_KEY, RES, mandate, receipt, payTx, grantTx } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig, tokenIx } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario, fakeRpc } from '../harness.mjs';
import { debitTx } from '../phase12/helpers.mjs';
import { selfTransfer, selfInner, selfMulti, dustCredit, payWithExtraDebit, recreateTx } from './helpers.mjs';

const SEEDS = Number(process.env.PROPERTY_SEEDS ?? 600);
const ONE = process.env.PROPERTY_SEED ? Number(process.env.PROPERTY_SEED) : null;
const seeds = ONE !== null ? [ONE] : Array.from({ length: SEEDS }, (_, i) => i + 1);

// ------------------------------------------------------------------ random numbers
function rngFor(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const int = (r, n) => Math.floor(r() * n);
const pick = (r, xs) => xs[int(r, xs.length)];
const hex = (r) => Array.from({ length: 16 }, () => int(r, 256).toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ generator: an abstract history, then the same history as chain transactions
// event kinds: pay (x402 TransferChecked), payExtra (x402 shape plus a second agent debit), hidden (agent debit outside x402), hidden2 (two agent debits of the
// source in one transaction), self (agent self-transfer: top level, inner, multisig), dust (a stranger credits the source), principal (the principal's own
// transfer), grant (a re-grant: M2), revoke, close, recreate.
function generate(seed) {
  const r = rngFor(seed);
  const ppm = pick(r, [20000, 50000]);
  const nbOffset = pick(r, [0, 0, 0, 1500]); // not_before = T0 + nbOffset: payments before it are mandate_not_yet_valid
  const expOffset = pick(r, [604800, 604800, 3000 + int(r, 3000)]); // sometimes the validity window closes in the middle of the history: mandate_expired
  const base = { total_cap: '10000000', per_payment_max: String(ppm), period_budget: String(pick(r, [60000, 100000, 200000])), period_seconds: pick(r, [500, 2000, 100000]), not_before: T0 + nbOffset, expires_at: T0 + expOffset };
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
    const kinds = ended ? ['dust', 'principal', ...(closed ? ['recreate'] : [])] : ['pay', 'pay', 'pay', 'pay', 'pay', 'payExtra', 'hidden', 'hidden2', 'self', 'dust', 'dust', 'principal'];
    const kind = pick(r, kinds);
    const e = { kind, slot, label };
    if (kind === 'pay' || kind === 'payExtra') { e.amount = pick(r, [5000, 10000, ppm, ppm + 1000]); e.payTo = pick(r, [A.sellerA, A.sellerA, A.sellerB, A.sellerC]); e.resourceIn = r() < 0.7; }
    if (kind === 'hidden' || kind === 'hidden2') { e.hidden = kind === 'hidden2' ? 'twoTransfers' : pick(r, ['transfer', 'burn', 'burnChecked', 'cpi']); e.amount = pick(r, [5000, 10000, 20000]); }
    if (kind === 'self') e.selfKind = pick(r, ['transfer', 'transferChecked', 'inner', 'multisig']);
    if (kind === 'recreate') ended = true;
    events.push(e);
  }
  events.forEach((e, ord) => { e.ord = ord; });
  return { r, M1, M2: events.find((e) => e.kind === 'grant' && e.label !== 'G1')?.mandate ?? null, events, nbOffset };
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
      case 'hidden': case 'hidden2': tx = debitTx(e.hidden, { slot: e.slot, amount: String(e.amount) }); break;
      case 'self': tx = e.selfKind === 'inner' ? selfInner(e.slot) : e.selfKind === 'multisig' ? selfMulti(e.slot) : selfTransfer(e.selfKind, { slot: e.slot }); break;
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
  c.getTransactions = async (list) => Promise.all(list.map((x) => c.getTransaction(x))); // histories are read in batches (J2): a null or throwing element is one of the batch
  return c;
}

// ------------------------------------------------------------------ the reference model (README rules, no resolver code)
// the reported reason when several violations apply: the seller-visible ones first (in the order the README lists them), the period last
const PRIORITY = ['amount_over_cap', 'pay_to_not_allowed', 'resource_not_allowed', 'network_mismatch', 'mandate_not_yet_valid', 'mandate_expired', 'period_over_budget'];
const agentDebits = (e) => (e.kind === 'pay' || e.kind === 'payExtra' || e.kind === 'hidden' ? [Number(e.amount)] : e.kind === 'hidden2' ? [Number(e.amount), Number(e.amount)] : []);
function model(h, Mx, target, { receiptKind, network }) {
  const ev = h.events;
  const grantOrd = ev.find((e) => e.kind === 'grant' && e.mandate === Mx).ord;
  // a later re-grant, a revoke or a close of the source supersedes the mandate from that point on (README item 3)
  const sup = ev.find((e) => e.ord > grantOrd && (e.kind === 'revoke' || e.kind === 'close' || (e.kind === 'grant' && e.mandate !== Mx)));
  if (sup && sup.ord < target.ord) return { liable: null, why: 'mandate superseded before the payment' };
  const isAgentDebit = ['pay', 'payExtra', 'hidden', 'hidden2'].includes(target.kind);
  if (!isAgentDebit) return { liable: null, why: 'not a debit signed by the agent' }; // self-transfers (any form) and the principal's own transfer: nothing the agent paid
  if (target.ord < grantOrd) return { liable: null, why: 'made before the grant' };
  if (target.kind !== 'pay') return { verdict: 'valid', reason: 'debit_not_x402', liable: 'agent_operator' }; // cannot have gone through x402 or a seller gate
  const violations = [];
  const withReceipt = receiptKind !== 'none';
  if (target.amount > Number(Mx.per_payment_max)) violations.push('amount_over_cap');
  if (![A.sellerA, A.sellerB].includes(target.payTo)) violations.push('pay_to_not_allowed');
  if (withReceipt && !target.resourceIn) violations.push('resource_not_allowed'); // the resource is known only from a seller receipt
  if (network !== Mx.network) violations.push('network_mismatch');
  const t = T0 + target.slot; // block time
  if (t < Mx.not_before) violations.push('mandate_not_yet_valid');
  if (t >= Mx.expires_at) violations.push('mandate_expired');
  // the period budget: every debit the agent signed since the grant, in the target's period, up to and including the target
  const periodOf = (slot) => Math.floor((T0 + slot - Mx.not_before) / Mx.period_seconds);
  let spent = 0;
  for (const e of ev) if (e.ord > grantOrd && e.ord <= target.ord && periodOf(e.slot) === periodOf(target.slot)) for (const a of agentDebits(e)) spent += a;
  if (spent > Number(Mx.period_budget)) violations.push('period_over_budget');
  if (!violations.length) return { verdict: 'invalid', reason: 'in_scope', liable: 'principal' };
  const visible = violations.some((v) => v !== 'period_over_budget');
  const reason = PRIORITY.find((p) => violations.includes(p));
  return { verdict: 'valid', reason, liable: visible && receiptKind === 'bound' ? 'seller' : 'agent_operator' }; // only a receipt that binds the mandate shows the seller saw it
}

// ------------------------------------------------------------------ running a dispute
const G = (Mx, h) => sig(h.events.find((e) => e.kind === 'grant' && e.mandate === Mx).label);
function receiptFor(h, Mx, e, kind) {
  const bound = kind === 'bound';
  return receipt({ mandate_id: bound ? mandateId(Mx) : null, grant_tx: bound ? G(Mx, h) : null, tx_sig: sig(e.label), amount: String(e.amount), pay_to: e.payTo, payer: A.agent, settled_at: T0 + e.slot, resource: e.resourceIn ? `${RES}quote` : 'https://other.example/x' });
}
function makeService(rpc, { refunds = null, network = A.net, ...opts } = {}) {
  const store = openStore();
  const sendRefund = refunds ? async (p, { onSigned }) => { const s = `R${refunds.length}`.padEnd(88, 'r'); await onSigned(s); refunds.push(p.reason); return s; } : null;
  return { store, svc: createResolver({ rpc, network, sellerKey: async () => SELLER_KEY.publicKey, store, sendRefund, now: () => T0 + 999999, ...opts }) };
}
function targets(h) {
  const r = rngFor(h.seed * 7 + 1);
  const all = h.events.filter((e) => ['pay', 'payExtra', 'hidden', 'hidden2', 'self', 'principal'].includes(e.kind));
  return [...all].sort(() => r() - 0.5).slice(0, 6);
}
function chosenMandate(h, e, r) {
  const current = h.M2 && e.ord > h.events.find((x) => x.mandate === h.M2).ord ? h.M2 : h.M1;
  if (h.M2 && r() < 0.2) return current === h.M1 ? h.M2 : h.M1;
  return current;
}
function choice(h, r, e) {
  const Mx = chosenMandate(h, e, r);
  const receiptKind = e.kind === 'pay' ? pick(r, ['none', 'none', 'bound', 'bound', 'unbound']) : 'none';
  const network = r() < 0.12 ? A.mainnet : A.net; // the network the resolver watches; a mandate for another one is a seller-visible violation
  return { Mx, receiptKind, network };
}
const describe = (h, seed, e, c) => `seed ${seed}: dispute ${e.label} (${e.kind}) under ${c.Mx === h.M1 ? 'M1' : 'M2'} with ${c.receiptKind} receipt on ${c.network === A.net ? 'devnet' : 'mainnet'}; window nb+${h.nbOffset} exp ${h.M1.expires_at - T0}; history ${h.events.map((x) => `${x.label}:${x.kind}@${x.slot}`).join(' ')}`;
const same = (v, m) => v.liable === m.liable && (m.liable === null || (v.verdict === m.verdict && v.reason === m.reason));
const dispute = (svc, h, e, c) => svc.dispute({ tx_sig: sig(e.label), mandate: c.Mx, grant_tx: G(c.Mx, h), receipt: c.receiptKind === 'none' ? null : receiptFor(h, c.Mx, e, c.receiptKind) });

test(`property I1: ${seeds.length} random histories, every dispute gets the model's verdict on a readable chain (seeds ${seeds[0]}..${seeds.at(-1)})`, async () => {
  let disputes = 0, decided = 0, paged = 0, pageLimitHits = 0;
  for (const seed of seeds) {
    const h = generate(seed); h.seed = seed;
    const r = rngFor(seed * 31 + 5);
    const c = await build(h);
    for (const e of targets(h)) {
      const ch = choice(h, r, e);
      const m = model(h, ch.Mx, e, ch);
      const ctx = describe(h, seed, e, ch);
      if (seed % 4 === 0) { // a history longer than one page: a tiny page size and maxPages, so the limit is reached and progress has to carry over
        const { svc, store } = makeService(c, { network: ch.network, historyPageSize: 3, historyMaxPages: 2 });
        let v, tries = 0;
        do { v = await dispute(svc, h, e, ch); tries++; if (v.reason === 'history_incomplete') { assert.match(JSON.stringify(v.delta), /more than 2 pages/, `${ctx}: history_incomplete for a reason other than maxPages: ${JSON.stringify(v.delta)}`); pageLimitHits++; } } while (v.reason === 'history_incomplete' && tries < 25);
        assert.ok(same(v, m), `${ctx}\nafter ${tries} disputes\nmodel ${JSON.stringify(m)}\ncode  ${JSON.stringify({ verdict: v.verdict, reason: v.reason, liable: v.liable })}\n${JSON.stringify(v.delta)}`);
        assert.equal(store.count(), m.liable === null ? 0 : 1, ctx);
        paged++; disputes++; if (m.liable !== null) decided++;
        continue;
      }
      const { svc, store } = makeService(c, { network: ch.network });
      const v = await dispute(svc, h, e, ch);
      disputes++; if (m.liable !== null) decided++;
      assert.notEqual(v.reason, 'history_incomplete', `${ctx}\n${JSON.stringify(v)}`);
      assert.ok(same(v, m), `${ctx}\nmodel ${JSON.stringify(m)}\ncode  ${JSON.stringify({ verdict: v.verdict, reason: v.reason, liable: v.liable })}\n${JSON.stringify(v.delta)}`);
      assert.equal(store.count(), m.liable === null ? 0 : 1, ctx);
    }
  }
  console.log(`property I1: ${seeds.length} histories (seeds ${seeds[0]}..${seeds.at(-1)}), ${disputes} disputes, ${decided} with a decided model verdict, ${paged} with a 3-signature page and maxPages 2 (the page limit was hit ${pageLimitHits} times and the verdict still arrived)`);
  assert.ok(ONE !== null || decided > disputes / 3, 'the generator produces enough decided cases');
  assert.ok(ONE !== null || SEEDS < 50 || pageLimitHits > 0, 'maxPages was reached at least once');
});

test(`property I2: RPC faults give the model's verdict or no verdict, never a different decided verdict (${seeds.length} histories)`, async () => {
  let none = 0, same_ = 0;
  const counts = {};
  for (const seed of seeds) {
    const h = generate(seed); h.seed = seed;
    const r = rngFor(seed * 17 + 3);
    for (const e of targets(h)) {
      const ch = choice(h, r, e);
      const m = model(h, ch.Mx, e, ch);
      const c = await build(h);
      const fault = pick(r, ['unreadable', 'block', 'heal', 'page', 'account', 'batchNull', 'batchError']);
      counts[fault] = (counts[fault] ?? 0) + 1;
      const victim = pick(r, h.events);
      if (fault === 'unreadable') { const o = c.getTransaction.bind(c); c.getTransaction = async (s) => (s === sig(victim.label) ? null : o(s)); }
      if (fault === 'block') c.hiddenBlocks.add(victim.slot);
      if (fault === 'heal') { let left = 3; const o = c.getTransaction.bind(c); c.getTransaction = async (s) => (s === sig(victim.label) && left-- > 0 ? null : o(s)); } // not found, then it heals
      if (fault === 'page') c.failPage = 1 + int(r, 3); // a signature page that cannot be read
      if (fault === 'batchNull') { const o = c.getTransactions; c.getTransactions = async (list) => (await o(list)).map((t, i) => (list[i] === sig(victim.label) ? null : t)); } // one null element in a batch
      if (fault === 'batchError') { const o = c.getTransactions; c.getTransactions = async (list) => { if (list.includes(sig(victim.label))) throw new Error('batch element failed'); return o(list); }; } // one errored element
      if (fault === 'account') c.getAccountContext = async () => { throw new Error('account read failed'); }; // the account cannot be read
      const { svc, store } = makeService(c, { network: ch.network });
      const v = await dispute(svc, h, e, ch);
      const ctx = `${describe(h, seed, e, ch)}\nfault ${fault} on ${victim.label}`;
      if (v.liable === null) { assert.equal(store.count(), 0, `${ctx}: no verdict means nothing stored`); none++; }
      else { assert.ok(same(v, m), `${ctx}\nmodel ${JSON.stringify(m)}\ncode  ${JSON.stringify({ verdict: v.verdict, reason: v.reason, liable: v.liable })}`); same_++; }
    }
  }
  console.log(`property I2: ${none} disputes with no verdict, ${same_} with the model's verdict, 0 different (faults: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')})`);
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
      const genuine = receiptFor(h, Mx, e, 'bound');
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
const b58 = getBase58Decoder(), txDec = getTransactionDecoder(), msgDec = getCompiledTransactionMessageDecoder();
const decodeTx = (b64) => txDec.decode(Uint8Array.from(Buffer.from(b64, 'base64')));
test('property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds)', async (tc) => {
  const NOW = T0 + 1000;
  let settledTotal = 0, refusals = 0, restarts = 0, restartsWithKept = 0, expiries = 0, lags = 0, histLags = 0, regrants = 0;
  for (const seed of seeds.slice(0, 60)) {
    const r = rngFor(seed * 101 + 9);
    const price = pick(r, [10000, 20000]), budget = pick(r, [30000, 50000, 70000]);
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: String(price) });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-prop-'));
    const s = await newScenario(seller, { mandate: { period_budget: String(budget), per_payment_max: String(price), total_cap: '10000000' } });
    // the chain: a height, the last valid height of every blockhash the agent was handed, and a node that may lag
    let height = 50, lagging = false, issued = 0;
    const lastValidOf = new Map();
    seller.rpc.call = async (m, p) => {
      if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: lagging ? false : (lastValidOf.get(p[0]) ?? 0) >= height }; // a lagging node: false for everything it has not seen
      if (m === 'getBlockHeight') return lagging ? height - 300 : height; // ... and its height is behind
      throw new Error(`unexpected rpc call ${m}`);
    };
    const getBlockhash = async () => { const bh = b58.decode(crypto.getRandomValues(new Uint8Array(32))); lastValidOf.set(bh, height + 150); issued++; return { blockhash: bh, lastValidBlockHeight: BigInt(height + 150), contextSlot: 10 + issued }; };
    let mirrored = 0, dropNext = 0, tamper = false, withhold = 0, histLag = false, mirrorBase = 0, settleBase = 0, grantSig = s.grant_tx;
    const withheld = []; // payloads a seller keeps (answers 502) and may land later
    const ctxs = `seed ${seed} price ${price} budget ${budget}`;
    // mirror every payment the facilitator settled onto the fake chain, WITH the agent's signature, so a restarted agent can rebuild from it
    const sync = () => {
      for (; mirrored < facilitator.settled.length; mirrored++) {
        const id = `MOCKSETTLE${mirrored + 1}`.padEnd(88, 'x');
        const agentSig = b58.decode(decodeTx(facilitator.settled[mirrored].payload.transaction).signatures[s.signer.address]);
        const tx = payTx({ slot: 2000 + mirrored, blockTime: T0 + 500, amount: String(price), authority: s.signer.address });
        tx.transaction.signatures = [id, agentSig];
        seller.rpc.grants.set(id, tx);
        seller.rpc.newer = [{ signature: id, slot: 2000 + mirrored, blockTime: T0 + 500, err: null }, ...seller.rpc.newer];
      }
      seller.rpc.account = { data: { parsed: { info: { owner: s.mandate.principal, mint: s.mandate.asset, delegate: s.mandate.agent, delegatedAmount: { amount: String(10000000 - (mirrored - mirrorBase) * price) } } } } };
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
    const make = async () => { globalThis.fetch = wrapper; try { return await createAgent({ mandate: s.mandate, grant_tx: grantSig, signer: s.signer, rpc: seller.rpc, getBlockhash, now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; } };
    const land = async () => { for (const w of withheld.splice(0)) { // what the seller kept lands only if its blockhash is still valid
      const pp = JSON.parse(Buffer.from(w, 'base64').toString());
      const lv = lastValidOf.get(msgDec.decode(decodeTx(pp.payload.transaction).messageBytes).lifetimeToken);
      if (lv !== undefined && lv >= height) await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: pp }) });
    } };
    let agent = await make();
    try {
      for (let step = 0; step < 8; step++) {
        const op = r();
        const trace = (m) => { if (process.env.PROPERTY_TRACE) console.log(`  [seed ${seed} step ${step}] ${m}; settled ${facilitator.counts.settle}, height ${height}, lagging ${lagging}, agent reservations ${agent.reservations.map((x) => x.state[0]).join('')}`); };
        if (op < 0.08) dropNext = 1 + int(r, 2);
        else if (op < 0.22) withhold = 1 + int(r, 2);
        else if (op < 0.28) tamper = !tamper;
        else if (op < 0.34) { lagging = !lagging; if (lagging) lags++; }
        else if (op < 0.40) { height += 200; expiries++; } // blockhashes handed out so far expire: the kept payloads can no longer land
        else if (op < 0.46) { histLag = !histLag; seller.rpc.nodeSlot = histLag ? 1 : null; if (histLag) histLags++; } // the node that answers the history reads is behind (after an expiry, I3)
        else if (op < 0.50 && dropNext === 0 && withhold === 0 && withheld.length === 0) { // the principal re-grants the SAME mandate; the agent restarts on the new grant with the same data directory (I4)
          sync(); await agent.close(); regrants++;
          grantSig = `REGRANT${regrants}`.padEnd(88, 'g'); seller.rpc.grants.set(grantSig, grantTx(s.mandate));
          mirrorBase = mirrored; settleBase = facilitator.counts.settle; seller.rpc.newer = []; sync(); agent = await make();
        }
        else if (op < 0.66 && dropNext === 0 && withhold === 0) { sync(); if (withheld.length) restartsWithKept++; await agent.close(); agent = await make(); restarts++; } // restart: the ledger comes from the chain, the held reservations from disk
        trace(op < 0.08 ? 'lose' : op < 0.22 ? 'withhold' : op < 0.28 ? 'tamper' : op < 0.34 ? 'lag' : op < 0.40 ? 'expire' : op < 0.46 ? 'histlag' : op < 0.50 ? 'regrant?' : op < 0.66 ? 'restart?' : 'plain');
        if (r() < 0.3) { trace('land kept payloads'); await land(); }
        sync(); // the chain is live: whatever the facilitator settled so far is on it, with the agent's signature
        const k = 1 + int(r, 5);
        const rs = await Promise.allSettled(Array.from({ length: k }, () => agent.fetch(seller.url)));
        trace(`batch of ${k}: ${rs.map((x) => (x.status === 'fulfilled' ? x.value.status : x.reason?.reason ?? 'ERR ' + x.reason?.message)).join(',')}`);
        for (const x of rs) if (x.status === 'rejected' && x.reason?.reason) { refusals++; assert.equal(x.reason.reason, 'period_over_budget', `${ctxs}: an honest agent refused for ${x.reason.reason}: ${JSON.stringify(x.reason.delta)}`); }
        assert.ok((facilitator.counts.settle - settleBase) * price <= budget, `${ctxs}: settled ${(facilitator.counts.settle - settleBase) * price} since the last grant > budget ${budget}`);
      }
      await land(); // finally the seller lands everything it kept that can still land
      assert.ok((facilitator.counts.settle - settleBase) * price <= budget, `${ctxs}: after the seller landed what it kept, settled ${(facilitator.counts.settle - settleBase) * price} > budget ${budget}`);
      settledTotal += facilitator.counts.settle;
    } finally { globalThis.fetch = realFetch; await agent.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  }
  console.log(`property I4: 60 seeds, ${settledTotal} payments settled, ${refusals} local refusals (all period_over_budget), ${restarts} restarts (${restartsWithKept} while a seller held a payload), ${expiries} expiries, ${lags} lagging-node phases, ${histLags} lagging-history-node phases, ${regrants} same-mandate re-grants with the data directory reused, never above the budget`);
});

test('property I5: a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts (20 seeds)', async (tc) => {
  let twice = 0;
  for (const seed of seeds.slice(0, 20)) {
    const r = rngFor(seed * 53 + 1);
    const facilitator = await startMockFacilitator({ fixedTx: `DUP${seed}`.padEnd(88, 'x') });
    let n = 0;
    const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000 + n++, price: '10000' });
    const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
    try {
      const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: b58.decode(crypto.getRandomValues(new Uint8Array(32))), lastValidBlockHeight: 150n, contextSlot: 10 }), now: () => T0 + 1000 });
      const k = 2 + int(r, 3);
      const hs = [];
      for (let i = 0; i < k; i++) hs.push((await a.fetch(seller.url)).headers.get('x-iussum-receipt'));
      twice += k - 1;
      assert.ok(hs.every((x) => x && x === hs[0]), `seed ${seed}: ${new Set(hs).size} different receipts for one transaction`);
    } finally { facilitator.close(); seller.close(); }
  }
  console.log(`property I5: ${twice} repeated successes over 20 seeds, always the identical receipt`);
});

test('property I6: a seller gate whose grant check is cold answers 503 with Retry-After, the agent retries with the SAME payload, nothing is lost or doubled (12 seeds)', async () => {
  let w503 = 0, retried = 0, gaveUp = 0;
  for (const seed of seeds.slice(0, 12)) {
    const r = rngFor(seed * 67 + 11);
    const budgetMs = pick(r, [20, 40, 80]), slowMs = pick(r, [120, 250]), slowCalls = 1 + int(r, 2), retryMax = int(r, 3), payments = 1 + int(r, 2);
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: budgetMs, retryAfterSeconds: 1 } });
    const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
    const orig = seller.rpc.getSignaturesForAddress.bind(seller.rpc);
    let n = 0; seller.rpc.getSignaturesForAddress = async (...a) => { if (n++ < slowCalls) await new Promise((res) => setTimeout(res, slowMs)); return orig(...a); }; // the cold first read
    const agentRpc = fakeRpc(); agentRpc.grants = seller.rpc.grants; agentRpc.account = seller.rpc.account; // the agent has its own, fast node
    const ctxs = `seed ${seed} budget ${budgetMs} ms slow ${slowMs} ms x${slowCalls} retries ${retryMax}`;
    try {
      const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: agentRpc, getBlockhash: async () => ({ blockhash: b58.decode(crypto.getRandomValues(new Uint8Array(32))), lastValidBlockHeight: 150n, contextSlot: 10 }), now: () => T0 + 1000, retry: { max: retryMax } });
      const statuses = [];
      for (let i = 0; i < payments; i++) {
        const t0 = Date.now(); const res = await a.fetch(seller.url); statuses.push(res.status);
        assert.ok(Date.now() - t0 < (retryMax + 1) * (budgetMs + 1300) + 500, `${ctxs}: a request took ${Date.now() - t0} ms`);
        if (res.status === 503) { assert.ok(res.headers.get('retry-after'), `${ctxs}: 503 without Retry-After`); w503++; gaveUp++; } else if (retryMax > 0 && i === 0 && slowMs > budgetMs) retried++;
      }
      assert.equal(facilitator.counts.settle, statuses.filter((x) => x === 200).length, `${ctxs}: a 503 settled something, or a 200 did not: ${statuses}`);
      assert.equal(a.reservations.length, payments, `${ctxs}: a retry made a second reservation`);
      for (const [i, x] of a.reservations.entries()) assert.equal(x.state, statuses[i] === 200 ? 'consumed' : 'held', `${ctxs}: reservation ${i} is ${x.state} after ${statuses[i]}`);
      let last; // the background scan finishes (slow reads x slowMs); the same agent now gets through
      for (let i = 0; i < 12; i++) { last = await a.fetch(seller.url); if (last.status === 200) break; await new Promise((res) => setTimeout(res, 300)); }
      assert.equal(last.status, 200, `${ctxs}: the gate still answered ${last.status} after the scan should have finished`);
    } finally { facilitator.close(); seller.close(); }
  }
  console.log(`property I6: 12 seeds, ${w503} final 503s with Retry-After (retries exhausted), ${retried} first payments that needed a retry, every settled payment matched a 200, no second reservation`);
});
