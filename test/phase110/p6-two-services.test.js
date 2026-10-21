// P6 of Addendum P: two resolver services on ONE store must not pay the same refund twice. The claim is taken in the store, atomically, before sendRefund runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSigner } from '@solana/kit';
import { createResolver, openStore, makeRefundSender } from '@iussum/resolver';
import { A, T0, M, SRC, SELLER_KEY, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live } from '../regression/chainsim.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup({ delayA = 300 } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p6-')), 'verdicts.sqlite');
  const chain = chainSim();
  const G = chain.add('G'.repeat(88), grantAt(M, 1000));
  const P = chain.add('PAYP6', payAt(1100, { payTo: A.sellerC })); // out of scope: sellerC is not in allow.pay_to
  chain.setAccount(SRC, live(M));
  const float = await generateKeyPairSigner(); const sent = []; const clock = { t: T0 + 5000 };
  const rpcFor = (name, delayMs) => Object.assign(Object.create(chain), { async call(method, params) {
    if (method === 'getLatestBlockhash') { await sleep(delayMs); return { value: { blockhash: name === 'A' ? '11111111111111111111111111111111' : A.sellerB, lastValidBlockHeight: 100 } }; }
    if (method === 'sendTransaction') { sent.push(name); return 'ok'; }
    if (method === 'getSignatureStatuses') return { value: [{ confirmationStatus: 'confirmed', err: null }] };
    throw new Error(method);
  } });
  const mk = (name, delayMs, sendRefund) => { const rpc = rpcFor(name, delayMs); return createResolver({ rpc, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store: openStore(file), sendRefund: sendRefund ?? makeRefundSender({ rpc, float }), now: () => clock.t }); };
  const bundle = { tx_sig: P, mandate: M, grant_tx: G, receipt: receipt({ tx_sig: P, pay_to: A.sellerC }) };
  return { file, P, sent, clock, mk, bundle, delayA, chainRpc: (name) => rpcFor(name, 0) };
}

test('P6 a duplicate dispute on the other service, while the first service is still fetching its blockhash, does not pay a second refund (g3)', async () => {
  const t = await setup(); const a = t.mk('A', 300), b = t.mk('B', 0);
  const pa = a.dispute(t.bundle); await sleep(100);
  const rb = await b.dispute(t.bundle); const ra = await pa;
  assert.equal(t.sent.length, 1, `refund transactions broadcast: ${t.sent}`);
  assert.equal(ra.liable, 'seller'); assert.ok(ra.refund_tx, 'the winner paid');
  assert.equal(rb.refund_tx ?? null, null, 'the other service did not pay'); assert.equal(rb.refund_state, 'pending');
  assert.equal(openStore(t.file).get(t.P).refund_tx, ra.refund_tx);
  // asked again once the refund is recorded, the other service answers with it and still sends nothing
  const rb2 = await b.dispute(t.bundle); assert.equal(rb2.refund_tx, ra.refund_tx); assert.equal(t.sent.length, 1);
});

test('P6 two services disputing at the same instant broadcast exactly one refund', async () => {
  const t = await setup(); const a = t.mk('A', 50), b = t.mk('B', 50);
  await Promise.all([a.dispute(t.bundle), b.dispute(t.bundle)]);
  assert.equal(t.sent.length, 1, `${t.sent}`);
});

test('P6 the claim winner crashes before it signs: the other service waits out the grace period, then reclaims and pays once', async () => {
  const t = await setup();
  const crashed = t.mk('A', 0, () => new Promise(() => {})); // never returns: the process died after the claim
  void crashed.dispute(t.bundle); await sleep(100);
  const b = t.mk('B', 0);
  const r1 = await b.dispute(t.bundle); assert.equal(r1.refund_state, 'pending'); assert.equal(t.sent.length, 0, 'inside the grace period nothing is sent');
  t.clock.t += 149; const r2 = await b.dispute(t.bundle); assert.equal(r2.refund_state, 'pending'); assert.equal(t.sent.length, 0);
  t.clock.t += 2; const r3 = await b.dispute(t.bundle); assert.ok(r3.refund_tx, 'after the grace period the claim is reclaimed'); assert.equal(t.sent.length, 1);
  const r4 = await b.dispute(t.bundle); assert.equal(r4.refund_tx, r3.refund_tx); assert.equal(t.sent.length, 1);
});

test('P6 a refund that fails before it is signed releases its claim, so a retry is not held for the grace period', async () => {
  const t = await setup(); let n = 0;
  const flaky = t.mk('A', 0, async (...args) => { if (n++ === 0) throw new Error('rpc down'); return 'S'.repeat(88); });
  const r1 = await flaky.dispute(t.bundle); assert.equal(r1.refund_error, 'rpc down');
  const r2 = await flaky.dispute(t.bundle); assert.equal(r2.refund_tx, 'S'.repeat(88), 'the retry went straight through');
});

test('P6 a claim that lost its place does not send: a service whose claim was reclaimed meanwhile gets an error from onSigned and broadcasts nothing', async () => {
  const t = await setup();
  const store = openStore(t.file);
  // service A claims, stalls, and its claim is reclaimed by B after the grace period; A then wakes up and signs
  let wake; const stall = new Promise((r) => { wake = r; }); let aSent = 0;
  const a = t.mk('A', 0, async (_r, hooks) => { await stall; await hooks.onSigned('A'.repeat(88)); aSent++; return 'A'.repeat(88); });
  const pa = a.dispute(t.bundle); await sleep(100);
  t.clock.t += 151; const b = t.mk('B', 0); const rb = await b.dispute(t.bundle); assert.ok(rb.refund_tx); assert.equal(t.sent.length, 1);
  wake(); const ra = await pa;
  assert.equal(aSent, 0, 'A\'s onSigned refused: its claim is gone'); assert.ok(ra.refund_error); assert.equal(store.get(t.P).refund_tx, rb.refund_tx);
});

test('P6 the claim is what keeps the second service from sending: a service that read the row BEFORE the first one claimed it still sends nothing (the race between read and claim, across processes)', async () => {
  const t = await setup();
  let release; const stall = new Promise((r) => { release = r; });
  const a = t.mk('A', 0, async (_r, hooks) => { await stall; await hooks.onSigned('A'.repeat(88)); return 'A'.repeat(88); });
  const pa = a.dispute(t.bundle); await sleep(100); // A holds the claim and has signed nothing
  // B's view of the row is the one from before A's claim: no refund_pending
  const real = openStore(t.file);
  const stale = { ...real, get: (tx) => { const r = real.get(tx); return r ? { ...r, refund_pending: null, refund_pending_at: null } : r; } };
  let bSent = 0;
  const b = (await import('@iussum/resolver')).createResolver({ rpc: t.chainRpc('B'), network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store: stale, sendRefund: async () => { bSent++; return 'B'.repeat(88); }, now: () => t.clock.t });
  const rb = await b.dispute(t.bundle);
  assert.equal(bSent, 0, 'B lost the claim and sent nothing'); assert.equal(rb.refund_state, 'pending');
  release(); const ra = await pa; assert.equal(ra.refund_tx, 'A'.repeat(88));
});

test('P6 the store claim is atomic and compare-and-swap: one winner, takeover only of the value read, signing only with the own claim', () => {
  const s = openStore(); s.put('T', { mandate_sha: 'm', receipt_sha: 'r', verdict: { verdict: 'valid', liable: 'seller' }, now: 1 });
  assert.equal(s.claimRefund('T', 'claim:a', 10), true); assert.equal(s.claimRefund('T', 'claim:b', 11), false, 'a second claim of a free row loses');
  assert.equal(s.claimRefund('T', 'claim:b', 200, { pending: 'claim:zzz', at: 10 }), false, 'a takeover of a value that is not the current one loses');
  assert.equal(s.claimRefund('T', 'claim:b', 200, { pending: 'claim:a', at: 10 }), true, 'a takeover of the value read wins');
  assert.equal(s.signRefund('T', 'claim:a', 'SIG-A', 201), false, 'the old holder cannot sign'); assert.equal(s.signRefund('T', 'claim:b', 'SIG-B', 201), true);
  assert.equal(s.releaseClaim('T', 'claim:b'), false, 'a signed claim is not released'); assert.equal(s.get('T').refund_pending, 'SIG-B');
});
