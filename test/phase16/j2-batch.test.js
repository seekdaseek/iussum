// J2: fewer HTTP calls per history read. Transactions are fetched in JSON-RPC batches (an array of getTransaction requests in one POST, 25 per batch by default,
// with a concurrency limit and 429 backoff), in the spend history and in the supersession scan. Fail-closed rules unchanged: any null or errored element makes
// the read incomplete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRpc, agentSpendHistory, createGrantChecker } from '@iussum/core';
import { A, SRC, T0, mandate } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';

const tx = (s) => ({ slot: 5, blockTime: T0, transaction: { message: { accountKeys: [], instructions: [] }, signatures: [s] }, meta: { err: null } });
function node(over = {}) {
  const log = { posts: [], inflight: 0, maxInflight: 0, singles: 0 };
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body); log.posts.push(Array.isArray(body) ? body.length : 1);
    log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
    await new Promise((r) => setTimeout(r, 15));
    log.inflight--;
    if (over.first429 && log.posts.length === 1) return new Response('{}', { status: 429 });
    const one = (b) => { if (!Array.isArray(body)) log.singles++; const sg = b.params[0]; if (over.nullFor === sg) return { jsonrpc: '2.0', id: b.id, result: null }; if (over.errFor === sg) return { jsonrpc: '2.0', id: b.id, error: { code: -32000, message: 'boom' } }; return { jsonrpc: '2.0', id: b.id, result: tx(sg) }; };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { status: 200 });
  };
  return { rpc: makeRpc('http://x', { fetchImpl, retries: 3 }), log };
}
const sigs = (n) => Array.from({ length: n }, (_, i) => `S${i}`.padEnd(88, 'x'));
test('J2 60 signatures go out as 3 batches (25, 25, 10), results aligned with the request', async () => {
  const { rpc, log } = node();
  const r = await rpc.getTransactions(sigs(60));
  assert.deepEqual([...log.posts].sort((a, b) => b - a), [25, 25, 10]); // two workers share the bucket: the order of the POSTs varies assert.equal(r.length, 60);
  r.forEach((t, i) => assert.equal(t.transaction.signatures[0], sigs(60)[i]));
});
test('J2 the batch size and the concurrency are limits', async () => {
  const { rpc, log } = node();
  await rpc.getTransactions(sigs(100), { batchSize: 10, concurrency: 2 });
  assert.equal(log.posts.length, 10); assert.ok(log.maxInflight <= 2, `${log.maxInflight} in flight`);
});
test('J2 a rate-limited batch (HTTP 429) is retried with backoff', async () => {
  const { rpc, log } = node({ first429: true });
  const r = await rpc.getTransactions(sigs(5));
  assert.equal(r.length, 5); assert.ok(log.posts.length >= 2);
});
test('J2 a rate-limited ELEMENT is retried on its own and the elements that succeeded are kept (no refetch of them)', async () => {
  const calls = [];
  let limited = true;
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body); calls.push(body.map((b) => b.params[0]));
    return new Response(JSON.stringify(body.map((b) => (b.params[0] === sigs(5)[1] && limited ? (limited = false, { jsonrpc: '2.0', id: b.id, error: { code: -32005, message: 'Too many requests for a specific RPC call' } }) : { jsonrpc: '2.0', id: b.id, result: tx(b.params[0]) }))), { status: 200 });
  };
  const r = await makeRpc('http://x', { fetchImpl, retries: 3 }).getTransactions(sigs(5));
  assert.equal(r.length, 5); assert.ok(r.every(Boolean));
  assert.deepEqual(calls.map((c) => c.length), [5, 1], 'the second POST carries only the limited element');
});
test('J2 an errored element makes the call throw (fail closed); a null element stays null for the caller to treat as unreadable', async () => {
  await assert.rejects(() => node({ errFor: sigs(5)[2] }).rpc.getTransactions(sigs(5)), /boom/);
  const r = await node({ nullFor: sigs(5)[3] }).rpc.getTransactions(sigs(5), { nullRetries: 0 });
  assert.equal(r[3], null); assert.ok(r[2]);
});
test('J2 the spend history and the supersession scan use the batch call when the RPC has it', async () => {
  const M = mandate({ nonce: 'b2'.repeat(16), per_payment_max: '1000', period_budget: '100000' });
  const c = chainSim(); c.add('G', grantAt(M, 1000));
  for (let i = 1; i <= 60; i++) c.add(`D${i}`, dustCredit(1000 + i));
  c.setAccount(SRC, live(M));
  let batches = 0, singles = 0;
  const rpc = { ...c, getSignaturesForAddress: c.getSignaturesForAddress, getTransaction: async (s) => { singles++; return c.getTransaction(s); }, getTransactions: async (list) => { batches++; return Promise.all(list.map((s) => c.getTransaction(s))); }, getAccountInfoParsed: c.getAccountInfoParsed, getAccountContext: c.getAccountContext, getBlockSignatures: c.getBlockSignatures };
  const h = await agentSpendHistory(rpc, { source: SRC, agent: A.agent, mint: A.asset, until: sig('G') });
  assert.equal(h.complete, true); assert.ok(batches >= 1); assert.equal(singles, 0, 'no per-signature calls');
  const before = batches;
  const chk = await createGrantChecker(rpc).check(M, sig('G'), { active: true });
  assert.equal(chk.ok, true); assert.ok(batches > before, 'the supersession scan batched too');
});
test('J2 in the history a null element makes the read incomplete and an errored element too (the same as today)', async () => {
  const M = mandate({ nonce: 'b3'.repeat(16) });
  const mk = (bad) => { const c = chainSim(); c.add('G', grantAt(M, 1000)); for (let i = 1; i <= 30; i++) c.add(`D${i}`, dustCredit(1000 + i)); c.setAccount(SRC, live(M)); return { ...c, getSignaturesForAddress: c.getSignaturesForAddress, getTransactions: async (list) => list.map((s) => { if (s === sig('D7')) { if (bad === 'throw') throw new Error('boom'); if (bad === 'null') return null; } return c.txs.find((t) => t.sig === s)?.tx ?? null; }) }; };
  for (const bad of ['null', 'throw']) {
    const h = await agentSpendHistory(mk(bad), { source: SRC, agent: A.agent, mint: A.asset, until: sig('G') });
    assert.equal(h.complete, false, bad); assert.match(h.reason, /D7|boom/);
  }
});

// ---- the public devnet node (measured Oct 2026): about 9 getTransaction elements per window, the rest of that batch "Too many requests for a specific RPC call", and
// HTTP 429 for the whole request while the window is used up. A cold read through it must wait the limiter out (minutes), not give up after a fixed number of rounds.
// Time is a fake clock handed to makeRpc (`sleep`, `now`), so the tests do not wait.
function limited({ window = 10_000, quota = 9, alwaysFor = 0 } = {}) {
  const clock = { t: 0 }, st = { sent: 0, posts: 0, wStart: 0, used: 0 };
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body); st.posts++; st.sent += Array.isArray(body) ? body.length : 1;
    if (clock.t - st.wStart >= window) { st.wStart = clock.t; st.used = 0; }
    if (clock.t < alwaysFor || st.used >= quota) return new Response('{}', { status: 429 });
    return new Response(JSON.stringify(body.map((b) => (st.used++ < quota ? { jsonrpc: '2.0', id: b.id, result: tx(b.params[0]) } : { jsonrpc: '2.0', id: b.id, error: { code: -32005, message: 'Too many requests for a specific RPC call' } }))), { status: 200 });
  };
  const rpc = makeRpc('http://x', { fetchImpl, retries: 3, stallMs: 90_000, sleep: async (ms) => { clock.t += ms; }, now: () => clock.t });
  return { rpc, clock, st };
}
test('J2 a long rate-limited stretch is waited out: 60 signatures through a node that answers 9 elements per 10 s window', async () => {
  const { rpc, clock, st } = limited();
  const r = await rpc.getTransactions(sigs(60), { nullRetries: 0 });
  assert.equal(r.length, 60); assert.ok(r.every(Boolean));
  assert.ok(clock.t >= 50_000, `the limiter was respected (${clock.t} ms of waiting)`);
  assert.ok(st.sent < 400, `a limited read does not hammer the node: ${st.sent} elements sent for 60`);
});
test('J2 a node that answers HTTP 429 for 40 s and then recovers is waited out', async () => {
  const { rpc } = limited({ alwaysFor: 40_000 });
  const r = await rpc.getTransactions(sigs(30), { nullRetries: 0 });
  assert.ok(r.every(Boolean));
});
test('J2 a node that answers nothing for stallMs gives up (fail closed), after that long and not before', async () => {
  const { rpc, clock } = limited({ alwaysFor: Infinity });
  await assert.rejects(() => rpc.getTransactions(sigs(5), { nullRetries: 0 }), /rate limited|429/);
  assert.ok(clock.t >= 90_000 && clock.t < 125_000, `${clock.t} ms`);
});
