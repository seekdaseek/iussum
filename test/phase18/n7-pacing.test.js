// N7 (Addendum N): pacing edge cases. A wall clock that steps back, a whole batch refused with HTTP 200 and a JSON "Too many requests", a bad rate or burst, and a configured
// rate below the floor (p1-pacing, p3-burst).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRpc } from '@iussum/core';

const ok = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });

test('N7 a wall clock that steps back one hour does not stall the next call for an hour (and the default clock is monotonic)', async () => {
  let t = 1_000_000_000_000; const sleeps = [];
  const rpc = makeRpc('https://api.devnet.solana.com', { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, fetchImpl: async () => ok(1) });
  await rpc.call('getSlot', []); t -= 3_600_000;
  for (let i = 0; i < 3; i++) await rpc.call('getSlot', []);
  assert.ok(Math.max(0, ...sleeps) < 10_000, `sleeps asked (ms): ${JSON.stringify(sleeps)}`);
  assert.ok(rpc.pacing().tokens >= 0);
  // the default `now` does not follow the wall clock: with Date.now stepped back and nothing else injected, calls still finish
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
  try {
    const r2 = makeRpc('https://rpc.example.com', { rate: 50, burst: 50, fetchImpl: async () => ok(1) });
    await r2.call('getSlot', []); skew = -3_600_000; const t0 = performance.now();
    for (let i = 0; i < 5; i++) await r2.call('getSlot', []);
    assert.ok(performance.now() - t0 < 2000, 'no hour-long wait after the wall clock went back');
  } finally { Date.now = realNow; }
});

for (const mode of ['http429', 'json200']) {
  test(`N7 a whole batch refused via ${mode} empties the bucket and halves the rate`, async () => {
    let t = 0, posts = 0, rateAtRetry = null, tokensAtRetry = null;
    const rpc = makeRpc('https://rpc.example.com', { rate: 10, burst: 4, now: () => t, sleep: async (ms) => { t += ms; }, fetchImpl: async (_u, init) => {
      posts++; const body = JSON.parse(init.body);
      if (posts === 2) { rateAtRetry = rpc.pacing().rate; tokensAtRetry = rpc.pacing().tokens; }
      if (posts === 1) return mode === 'http429' ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests for a specific RPC call' } }), { status: 200 });
      return new Response(JSON.stringify(body.map((b) => ({ jsonrpc: '2.0', id: b.id, result: { slot: 1 } }))), { status: 200 });
    } });
    await rpc.getTransactions(['a', 'b', 'c', 'd'], { nullRetries: 0 });
    assert.ok(rateAtRetry <= 5 + 1e-9, `the rate at the retry was ${rateAtRetry}/s (configured 10)`);
    assert.ok(tokensAtRetry < 1, `the bucket held ${tokensAtRetry} tokens at the retry`);
  });
}

test('N7 a bad rate or burst is refused at makeRpc: rate finite and > 0, burst finite and >= 1', () => {
  for (const rate of [0, NaN, -1, Infinity, '1']) assert.throws(() => makeRpc('https://rpc.example.com', { rate }), /rate/, `rate ${rate}`);
  for (const burst of [0, 0.5, NaN, -1, Infinity, '2']) assert.throws(() => makeRpc('https://rpc.example.com', { rate: 1, burst }), /burst/, `burst ${burst}`);
  makeRpc('https://rpc.example.com', { rate: 0.01, burst: 1 }); makeRpc('https://rpc.example.com'); // fine
});

test('N7 burst 1 paces 1/s exactly: 20 calls at rate 1 take 19 s', async () => {
  let t = 0;
  const rpc = makeRpc('https://api.devnet.solana.com', { rate: 1, burst: 1, now: () => t, sleep: async (ms) => { t += ms; }, fetchImpl: async () => ok(1) });
  for (let i = 0; i < 20; i++) await rpc.call('getSlot', []);
  assert.ok(Math.abs(t / 1000 - 19) < 0.5, `${t / 1000} s`);
});

test('N7 a configured rate below the floor is never raised by a 429', async () => {
  let t = 0, posts = 0;
  const rpc = makeRpc('https://rpc.example.com', { rate: 0.01, burst: 1, now: () => t, sleep: async (ms) => { t += ms; }, fetchImpl: async () => (++posts === 1 ? new Response('{}', { status: 429 }) : ok(1)) });
  await rpc.call('getSlot', []);
  assert.ok(rpc.pacing().rate <= 0.01 + 1e-12, `${rpc.pacing().rate}`);
});

test('N7 (p2-starve) the bucket serves its waiters in order: a batch that needs 2 tokens is not starved by a loop of single calls', async () => {
  const rpc = makeRpc('https://rpc.example.com', { rate: 50, burst: 2, fetchImpl: async (_u, init) => {
    const b = JSON.parse(init.body);
    return new Response(JSON.stringify(Array.isArray(b) ? b.map((x) => ({ jsonrpc: '2.0', id: x.id, result: { slot: 1 } })) : { jsonrpc: '2.0', id: b.id, result: 1 }), { status: 200 });
  } });
  let stop = false; const loop = (async () => { while (!stop) await rpc.call('getSlot', []); })();
  const t0 = performance.now(); // the batch is asked for in the same tick as the loop starts, like p2-starve.mjs
  const done = await Promise.race([rpc.getTransactions(['a', 'b'], { nullRetries: 0 }).then(() => 'done'), new Promise((r) => setTimeout(() => r('STARVED'), 1500))]);
  const took = performance.now() - t0;
  stop = true; await Promise.race([loop, new Promise((r) => setTimeout(r, 500))]);
  assert.equal(done, 'done', `the 2-element batch was still waiting after ${Math.round(took)} ms behind the single-call loop`);
  assert.ok(took < 500, `the 2-element batch waited ${Math.round(took)} ms`);
});
