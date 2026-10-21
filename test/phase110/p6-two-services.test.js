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
  return { file, P, sent, clock, mk, bundle, delayA };
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
