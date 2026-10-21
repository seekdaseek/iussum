// P1, P2, P3 of Addendum P (the final money-safety review of c3c2e79): a negative or malformed amount in a 402, a redirect out of allow.resource_prefix, and a signer
// that replaces the recent blockhash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAgent } from '@iussum/agent';
import { scopeViolations } from '@iussum/core';
import { partiallySignTransactionMessageWithSigners, setTransactionMessageLifetimeUsingBlockhash, setTransactionMessageLifetimeUsingDurableNonce } from '@solana/kit';
import { A, T0, mandate } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, listen } from '../harness.mjs';

const NOW = T0 + 1000, realFetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = async (p) => { try { const r = await p; await r.text(); return r.status; } catch (e) { return e.reason ?? e.message.slice(0, 120); } };

// ---- P1
const BAD = ['-100000000', '-1', '-0', '0x10', ' 5', '5 ', '007', '00', '1e3', '+5', '', '1.0', '1_000', '١٢٣', '10000\n'];
test('P1 scopeViolations judges an amount that is not a plain decimal integer string as over the cap, for every malformed spelling', () => {
  const m = mandate(); const base = { pay_to: m.allow.pay_to[0], resource: `${m.allow.resource_prefix[0]}x`, asset: m.asset, network: m.network, payer: m.agent, time: m.not_before + 1 };
  for (const amount of BAD) assert.ok(scopeViolations(m, { ...base, amount }).some((v) => v.code === 'amount_over_cap'), `amount ${JSON.stringify(amount)}`);
  for (const amount of [5, null, undefined, {}, [], 10000n]) assert.ok(scopeViolations(m, { ...base, amount }).some((v) => v.code === 'amount_over_cap'), `amount ${String(amount)} (${typeof amount})`);
  for (const amount of ['0', '1', '10000']) assert.ok(!scopeViolations(m, { ...base, amount }).some((v) => v.code === 'amount_over_cap'), `amount ${amount}`);
});

test('P1 a 402 with a negative amount is refused before anything is reserved: it cannot cancel the period budget for payments checked meanwhile (a1)', async (tc) => {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  let NEG = '-100000000';
  globalThis.fetch = async (req, init) => {
    const res = await realFetch(req, init);
    const u = new URL(req instanceof Request ? req.url : String(req));
    if (u.searchParams.has('neg') && res.status === 402) { const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString()); pr.accepts[0].amount = NEG; const h = new Headers(res.headers); h.set('payment-required', Buffer.from(JSON.stringify(pr)).toString('base64')); return new Response('{}', { status: 402, headers: h }); }
    return res;
  };
  tc.after(() => { globalThis.fetch = realFetch; });
  const getBlockhash = async () => { await sleep(150); return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }; };
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash, now: () => NOW });
  for (let i = 0; i < 3; i++) assert.equal(await out(a.fetch(seller.url)), 200);
  const pNeg = out(a.fetch(`${seller.url}?neg=1`)); await sleep(40);
  const rest = await Promise.all([1, 2, 3].map(() => out(a.fetch(seller.url))));
  assert.equal(await pNeg, 'amount_over_cap');
  assert.deepEqual(rest, ['period_over_budget', 'period_over_budget', 'period_over_budget']);
  assert.equal(facilitator.counts.settle, 3, 'settled 3 x 10000 against a period budget of 30000');
  // a malformed amount is refused on the first line of the payment hook: no grant check, no account read, no blockhash, nothing reserved
  const reads = () => seller.rpc.calls.getAccountInfoParsed + seller.rpc.calls.getTransaction; let bhCalls = 0;
  for (const bad of ['0x10', '007', '1e3', ' 5', '-1']) { NEG = bad; const before = reads(); assert.equal(await out(a.fetch(`${seller.url}?neg=1`)), 'amount_over_cap', bad); assert.equal(reads(), before, `no chain read for ${bad}`); }
  void bhCalls;
  assert.equal(facilitator.counts.settle, 3); assert.equal(a.reservations.filter((r) => r.state === 'held').length, 0);
  await a.close();
});

// ---- P2
async function twoOrigins(facilitator, S, { omit = false } = {}) {
  const tmpl = JSON.parse(Buffer.from((await realFetch(S.url)).headers.get('payment-required'), 'base64').toString());
  const X = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (u.pathname === '/v1/go') { res.writeHead(302, { location: u.searchParams.get('to') }); return res.end(); } res.writeHead(404); res.end(); });
  const xo = `http://127.0.0.1:${await listen(X)}`;
  const got = [];
  const M = http.createServer((req, res) => {
    const ps = req.headers['payment-signature'];
    if (!ps) { const pr = structuredClone(tmpl); if (omit) delete pr.resource; else pr.resource = { ...pr.resource, url: `${xo}/v1/go` }; res.writeHead(402, { 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64'), 'content-type': 'application/json' }); return res.end('{}'); }
    const p = JSON.parse(Buffer.from(ps, 'base64').toString()); got.push(p.accepted.amount);
    res.writeHead(200, { 'payment-response': Buffer.from(JSON.stringify({ success: true, transaction: 'M'.repeat(88), network: p.accepted.network, payer: 'x' })).toString('base64'), 'content-type': 'application/json' }); res.end('{"premium":true}');
  });
  const mo = `http://127.0.0.1:${await listen(M)}`;
  return { X, M, xo, mo, got };
}
for (const omit of [false, true]) {
  test(`P2 an open redirect under the allowed prefix does not take the agent, or its payment header, to a server outside the mandate (a2${omit ? ' omit' : ''})`, async (tc) => {
    const facilitator = await startMockFacilitator(); const S = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
    const o = await twoOrigins(facilitator, S, { omit });
    tc.after(() => { facilitator.close(); S.close(); o.X.close(); o.M.close(); });
    const s = await newScenario(S, { payTos: [A.sellerA], mandate: { allow: { pay_to: [A.sellerA], resource_prefix: [`${o.xo}/v1/`] } } });
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: S.rpc, getBlockhash: blockhash, now: () => NOW });
    const direct = await out(a.fetch(`${o.mo}/premium`)); assert.match(String(direct), /resource_/, 'asked directly it is refused');
    const r = await a.fetch(`${o.xo}/v1/go?to=${encodeURIComponent(`${o.mo}/premium`)}`);
    assert.equal(r.status, 302, 'the redirect is returned to the caller, unfollowed'); assert.equal(r.headers.get('location'), `${o.mo}/premium`);
    assert.deepEqual(o.got, [], 'no payment header reached the other server'); assert.deepEqual(a.ledger, []); assert.equal(a.reservations.length, 0);
    await a.close();
  });
}
test('P2 a 3xx answer to a PAID request is non-delivery: it is returned unfollowed and the reservation stays held until it is proven landed or expired', async (tc) => {
  const facilitator = await startMockFacilitator(); const S = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '10000' });
  const tmpl = JSON.parse(Buffer.from((await realFetch(S.url)).headers.get('payment-required'), 'base64').toString());
  const seen = []; let origin = '';
  const X = http.createServer((req, res) => {
    if (!req.headers['payment-signature']) { const pr = structuredClone(tmpl); pr.resource = { ...pr.resource, url: `${origin}/v1/quote` }; res.writeHead(402, { 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') }); return res.end('{}'); }
    seen.push(req.url); res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' }); res.end();
  });
  origin = `http://127.0.0.1:${await listen(X)}`;
  tc.after(() => { facilitator.close(); S.close(); X.close(); });
  const s = await newScenario(S, { payTos: [A.sellerA], mandate: { allow: { pay_to: [A.sellerA], resource_prefix: [`${origin}/v1/`] } } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: S.rpc, getBlockhash: blockhash, now: () => NOW });
  const r = await a.fetch(`${origin}/v1/quote`); assert.equal(r.status, 302);
  assert.equal(seen.length, 1, 'one paid request, never repeated at the Location');
  assert.deepEqual(a.reservations.map((x) => [x.state, x.created]), [['held', true]]); assert.deepEqual(a.ledger, []);
  await a.close();
});

// ---- P3
const own = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';
async function lifetimeScenario(tc, signFor) {
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, sign: signFor(s), getBlockhash: async () => ({ blockhash: own, lastValidBlockHeight: 5000n, contextSlot: 10 }), now: () => NOW });
  return { a, facilitator, seller, s };
}
test('P3 a signer that replaces the recent blockhash is refused by the guard, so the expiry proof is always about the blockhash the payload carries (a3)', async (tc) => {
  const { a, facilitator, seller } = await lifetimeScenario(tc, () => (msg) => partiallySignTransactionMessageWithSigners(setTransactionMessageLifetimeUsingBlockhash({ blockhash: A.sellerC, lastValidBlockHeight: 9000n }, msg)));
  const r = await out(a.fetch(seller.url));
  assert.match(String(r), /lifetime|blockhash/i, `the guard names the lifetime: ${r}`);
  assert.equal(facilitator.counts.settle, 0); assert.equal(a.reservations.filter((x) => x.created).length, 0, 'no payload was released with a reservation that cannot be proven');
  await a.close();
});
test('P3 a signer that keeps the blockhash still works (control)', async (tc) => {
  const { a, facilitator, seller } = await lifetimeScenario(tc, () => (msg) => partiallySignTransactionMessageWithSigners(msg));
  assert.equal(await out(a.fetch(seller.url)), 200); assert.equal(facilitator.counts.settle, 1); await a.close();
});
test('P3 a durable-nonce lifetime is refused outright, and the guard says so', async (tc) => {
  const { a, facilitator, seller } = await lifetimeScenario(tc, () => (msg) => partiallySignTransactionMessageWithSigners(setTransactionMessageLifetimeUsingDurableNonce({ nonce: A.sellerC, nonceAccountAddress: A.sellerB, nonceAuthorityAddress: A.principal }, msg)));
  const r = await out(a.fetch(seller.url));
  assert.match(String(r), /durable/i, `the guard names the durable nonce: ${r}`);
  assert.equal(facilitator.counts.settle, 0); await a.close();
});
