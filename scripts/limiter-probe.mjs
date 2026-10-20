// Addendum M, M6 step 1: how does a public JSON-RPC endpoint limit getTransaction? Read-only, from the Mac, in Node. Uses the signatures of the H5 account (any
// signatures of a real account would do). The endpoint is named by host only; the URL can carry a key and is never printed.
//   node scripts/limiter-probe.mjs [outfile]      (RPC_URL in the environment selects another endpoint, default the public devnet one)
//   PHASES=burst,paced,prolong,batch   selects phases
import fs from 'node:fs';
const url = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const host = new URL(url).host;
const out = process.argv[2];
const lines = [];
const say = (s) => { console.log(s); lines.push(s); if (out) fs.writeFileSync(out, `${lines.join('\n')}\n`); };
const sigs = fs.readFileSync(new URL('../demo-runs-1.6/h5-dust-signatures.txt', import.meta.url), 'utf8').split(/\s+/).filter((s) => /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cursor = 0; const nextSig = () => sigs[cursor++ % sigs.length];
const cfg = { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' };
let id = 0;
// one POST; returns { kind: 'ok' | 'limited' | 'http429' | 'error', ms }. 'limited' = the JSON-RPC "Too many requests for a specific RPC call" error of an element.
async function post(body) {
  const t = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429) return { kind: 'http429', ms: Date.now() - t };
    if (r.status >= 500) return { kind: 'error', ms: Date.now() - t, why: `http ${r.status}` };
    const j = await r.json();
    return { j, ms: Date.now() - t };
  } catch (e) { return { kind: 'error', ms: Date.now() - t, why: e.message.slice(0, 40) }; }
}
const kindOf = (e) => (e.error ? (/too many|rate|limit/i.test(e.error.message) ? 'limited' : 'error') : 'ok');
async function single() { const r = await post({ jsonrpc: '2.0', id: ++id, method: 'getTransaction', params: [nextSig(), cfg] }); if (r.kind) return r; return { kind: kindOf(r.j), ms: r.ms }; }
async function batch(n) {
  const r = await post(Array.from({ length: n }, () => ({ jsonrpc: '2.0', id: ++id, method: 'getTransaction', params: [nextSig(), cfg] })));
  if (r.kind) return { whole: r.kind, answered: 0, limited: n, ms: r.ms };
  if (!Array.isArray(r.j)) return { whole: 'not-array', answered: 0, limited: n, ms: r.ms };
  const k = r.j.map(kindOf);
  return { whole: 'array', answered: k.filter((x) => x === 'ok').length, limited: k.filter((x) => x === 'limited').length, errors: k.filter((x) => x === 'error').length, ms: r.ms };
}
const quiet = async (s) => { say(`  (quiet ${s} s)`); await sleep(s * 1000); };
const phases = (process.env.PHASES ?? 'burst,paced,prolong,batch').split(',');
say(`limiter probe, host ${host}, ${sigs.length} signatures, started ${new Date().toISOString()}`);

if (phases.includes('burst')) {
  say('\n== 1. burst: back-to-back single calls (one at a time) after 30 s quiet, until the first rejected call');
  for (let rep = 1; rep <= 3; rep++) {
    await quiet(30);
    let ok = 0, first = null; const t0 = Date.now();
    for (let i = 0; i < 100; i++) { const r = await single(); if (r.kind === 'ok') ok++; else { first = r.kind; break; } }
    say(`  rep ${rep}: ${ok} answered before the first rejection (${first ?? 'none in 100'}), ${Date.now() - t0} ms`);
  }
}

if (phases.includes('paced')) {
  say('\n== 2. paced single calls for 60 s at each rate, after 30 s quiet');
  for (const rate of [0.5, 0.8, 1.0, 1.25]) {
    await quiet(30);
    const gap = 1000 / rate, t0 = Date.now(); const c = { ok: 0, limited: 0, http429: 0, error: 0 }; let n = 0;
    while (Date.now() - t0 < 60_000) { const due = t0 + n * gap; if (due > Date.now()) await sleep(due - Date.now()); const r = await single(); c[r.kind]++; n++; }
    say(`  ${rate}/s: ${n} calls, answered ${c.ok}, element-limited ${c.limited}, http 429 ${c.http429}, other errors ${c.error}`);
  }
}

if (phases.includes('prolong')) {
  say('\n== 3. does a rejected call prolong the block? A: provoke a block with a burst, then wait quietly and probe once per second (time to the first answer). B: provoke it the same way, then keep hammering at 5 calls/s for 10 s, then probe once per second');
  for (const mode of ['A (quiet after the block)', 'B (hammering during the block)', 'A again', 'B again']) {
    await quiet(30);
    let ok = 0; for (let i = 0; i < 100; i++) { const r = await single(); if (r.kind !== 'ok') break; ok++; }
    const tBlock = Date.now();
    if (mode.startsWith('B')) { const t = Date.now(); let k = 0; while (Date.now() - t < 10_000) { await single(); k++; await sleep(200); } say(`  ${mode}: burst answered ${ok}, then ${k} calls in 10 s during the block`); }
    else say(`  ${mode}: burst answered ${ok}, then quiet probes`);
    let recovered = null, probes = 0; const t1 = Date.now();
    while (Date.now() - t1 < 120_000) { await sleep(1000); probes++; const r = await single(); if (r.kind === 'ok') { recovered = Date.now() - tBlock; break; } }
    say(`  ${mode}: first answer ${recovered === null ? 'NOT within 120 s' : `${(recovered / 1000).toFixed(1)} s after the block began`} (${probes} probes at 1/s)`);
  }
}

if (phases.includes('batch')) {
  say('\n== 4. batches: one POST of N getTransaction elements after 30 s quiet, three times per size');
  for (const n of [5, 10, 20]) {
    for (let rep = 1; rep <= 3; rep++) {
      await quiet(30);
      const r = await batch(n);
      say(`  batch of ${n} (rep ${rep}): ${r.whole === 'array' ? `answered ${r.answered}, element-limited ${r.limited}, other errors ${r.errors}` : `whole request rejected (${r.whole})`}, ${r.ms} ms`);
    }
  }
}
say(`\nfinished ${new Date().toISOString()}`);
