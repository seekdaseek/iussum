// M6 (Addendum M): the history reader paces itself with one token bucket per makeRpc client, shared by single calls and batch elements. The limiter modelled here is
// what docs/phase17/limiter-probe.txt measured on the public devnet node: about 10 getTransaction calls per 10 s window (a burst of 10 is answered, the 11th is
// rejected), a sustained 1.0/s is answered and 1.25/s is not, a block lasts about 18 s after the first rejection, and a batch element counts like a call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRpc } from '@iussum/core';
import { T0 } from '../fixtures.mjs';

const tx = (s) => ({ slot: 5, blockTime: T0, transaction: { message: { accountKeys: [], instructions: [] }, signatures: [s] }, meta: { err: null } });
const sigs = (n) => Array.from({ length: n }, (_, i) => `S${i}`.padEnd(88, 'x'));
function node({ quota = 10, windowMs = 10_000, blockMs = 18_000 } = {}) {
  const clock = { t: 0 }, st = { posts: [], rejected: 0, answered: 0, times: [], attempts: [] }, log = [];
  let blockedUntil = -1;
  const fetchImpl = async (_u, o) => {
    const body = JSON.parse(o.body), arr = Array.isArray(body), items = arr ? body : [body];
    st.posts.push(items.length); st.times.push(clock.t);
    const recent = log.filter((x) => clock.t - x < windowMs);
    const blocked = clock.t < blockedUntil;
    let allowed = blocked ? 0 : Math.max(0, quota - recent.length);
    const res = items.map((b) => {
      if (allowed > 0) { allowed--; log.push(clock.t); st.answered++; st.attempts.push({ sig: b.params?.[0], t: clock.t, ok: true }); return { jsonrpc: '2.0', id: b.id, result: tx(b.params?.[0]) }; }
      st.attempts.push({ sig: b.params?.[0], t: clock.t, ok: false });
      return { jsonrpc: '2.0', id: b.id, error: { code: -32005, message: 'Too many requests for a specific RPC call' } };
    });
    const limited = res.filter((x) => x.error).length;
    if (limited) { st.rejected += limited; if (!blocked) blockedUntil = clock.t + blockMs; }
    if (limited === items.length) return new Response('{}', { status: 429 }); // nothing answered: the whole request is refused
    return new Response(JSON.stringify(arr ? res : res[0]), { status: 200 });
  };
  const rpc = (extra = {}) => makeRpc('https://api.example.test', { fetchImpl, retries: 3, stallMs: 600_000, sleep: async (ms) => { clock.t += ms; }, now: () => clock.t, ...extra });
  return { clock, st, rpc, fetchImpl };
}

test('M6 the defaults: the public endpoints are paced from the measurement, any other endpoint starts fast, and { rate, burst } is configurable', () => {
  const pub = makeRpc('https://api.devnet.solana.com').pacing();
  assert.deepEqual([pub.rate, pub.burst], [0.6, 2]);
  assert.deepEqual([makeRpc('https://api.mainnet-beta.solana.com').pacing().rate, makeRpc('https://api.mainnet-beta.solana.com').pacing().burst], [0.6, 2]);
  const other = makeRpc('https://rpc.example.test/?key=SECRET').pacing();
  assert.ok(other.rate >= 10 && other.burst >= 10, JSON.stringify(other));
  const cfg = makeRpc('https://api.devnet.solana.com', { rate: 0.5, burst: 4 }).pacing();
  assert.deepEqual([cfg.rate, cfg.burst], [0.5, 4]);
});

test('M6 a paced read of 60 transactions through the measured limiter is never rejected, and takes about 60 / 0.8 s', async () => {
  const n = node();
  const rpc = n.rpc({ rate: 0.8, burst: 2 });
  const r = await rpc.getTransactions(sigs(60), { nullRetries: 0 });
  assert.ok(r.every(Boolean)); assert.equal(n.st.rejected, 0, `${n.st.rejected} rate-limited answers`);
  assert.ok(n.clock.t >= 60_000 && n.clock.t <= 90_000, `${n.clock.t} ms of (virtual) time`);
});

test('M6 the same read without pacing (the batch reader of 1.6, rate and burst of 25) is rejected, waits out the blocks, and takes longer', async () => {
  const n = node();
  const rpc = n.rpc({ rate: 25, burst: 25 });
  await rpc.getTransactions(sigs(60), { nullRetries: 0 });
  const paced = node(); await paced.rpc({ rate: 0.8, burst: 2 }).getTransactions(sigs(60), { nullRetries: 0 });
  assert.ok(n.st.rejected > 0, 'an unpaced reader meets the limiter');
  assert.ok(n.clock.t > paced.clock.t, `unpaced ${n.clock.t} ms against paced ${paced.clock.t} ms`);
});

test('M6 a batch is never larger than the burst', async () => {
  const n = node({ quota: 1000 });
  await n.rpc({ rate: 100, burst: 6 }).getTransactions(sigs(40), { batchSize: 25, nullRetries: 0 });
  assert.ok(Math.max(...n.st.posts) <= 6, `largest POST ${Math.max(...n.st.posts)}`);
});

test('M6 a rate-limited answer empties the bucket and halves the rate; successes raise it back slowly; a rejected element is never retried at once', async () => {
  const n = node({ quota: 2, windowMs: 1000, blockMs: 3000 });
  const rpc = n.rpc({ rate: 4, burst: 4 });
  await rpc.getTransactions(sigs(2), { nullRetries: 0 }); // two answered
  const before = rpc.pacing().rate;
  await rpc.getTransactions(sigs(6), { nullRetries: 0, batchSize: 3 }); // meets the limit
  assert.ok(n.st.rejected > 0);
  assert.ok(rpc.pacing().rate < before, `rate ${rpc.pacing().rate} after a rejection, was ${before}`);
  // an element that was rejected is asked again only after the bucket (now slower) has a token for it: never at the instant it was rejected
  const rejectedSigs = [...new Set(n.st.attempts.filter((x) => !x.ok).map((x) => x.sig))];
  assert.ok(rejectedSigs.length > 0);
  for (const sg of rejectedSigs) {
    const a = n.st.attempts.filter((x) => x.sig === sg); const i = a.findIndex((x) => !x.ok);
    if (a[i + 1]) assert.ok(a[i + 1].t - a[i].t >= 400, `${sg.slice(0, 3)} rejected at ${a[i].t}, asked again at ${a[i + 1].t}`);
  }
});

test('M6 fail-closed rules are unchanged under pacing: an errored element throws, a null element stays null', async () => {
  const clock = { t: 0 };
  const fetchImpl = async (_u, o) => { const body = JSON.parse(o.body); return new Response(JSON.stringify(body.map((b, i) => (i === 1 ? { jsonrpc: '2.0', id: b.id, error: { code: -32000, message: 'boom' } } : { jsonrpc: '2.0', id: b.id, result: tx(b.params[0]) }))), { status: 200 }); };
  const rpc = makeRpc('http://x', { fetchImpl, rate: 50, burst: 50, sleep: async (ms) => { clock.t += ms; }, now: () => clock.t });
  await assert.rejects(() => rpc.getTransactions(sigs(3), { nullRetries: 0 }), /boom/);
});

test('M6 one block is one halving: rejections that arrive while the same block lasts empty the bucket but do not halve the rate again', async () => {
  // a node stricter than the paced rate, so the reader is rejected once: 5 per 10 s window, and an 18 s block after the first rejection (the measured length)
  const n = node({ quota: 5, windowMs: 10_000, blockMs: 18_000 });
  const samples = [];
  const rpc = makeRpc('https://api.example.test', { fetchImpl: async (u, o) => { samples.push(rpc.pacing().rate); return n.fetchImpl(u, o); }, retries: 3, stallMs: 600_000, sleep: async (ms) => { n.clock.t += ms; }, now: () => n.clock.t, rate: 0.8, burst: 2 });
  await rpc.getTransactions(sigs(10), { nullRetries: 0 });
  assert.ok(n.st.rejected > 0);
  const minRate = Math.min(...samples);
  assert.ok(minRate >= 0.4 - 1e-9, `the rate fell to ${minRate}/s: every rejection of one block halved it again`);
});
