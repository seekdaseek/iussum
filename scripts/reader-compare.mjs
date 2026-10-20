// Addendum M, M6 step 3: the same COLD read of the H5 account (250 dust credits on the source account) through the three history readers, one after the other,
// alternating, read-only. The readers come from three code trees (git worktrees): the Phase 1.5 one-by-one reader (142276f), the Phase 1.6 batch reader (c521b31) and
// the paced reader (this tree). Each read starts with an empty transaction cache (a fresh client). Counted at the HTTP layer, whatever the reader does:
// POSTs, JSON-RPC elements sent, whole-request 429 answers and rate-limited elements.
//   node scripts/reader-compare.mjs <worktree 142276f> <worktree c521b31> [rounds] [outfile]        RPC_HOST=helius reads through devnet.helius-rpc.com instead
// The endpoint is named by host only: a keyed URL is built in memory from HELIUS_API_KEY (length checked, never printed).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadKeys, MINT } from './demo-lib.mjs';
const [W15, W16, roundsArg, out] = process.argv.slice(2);
const rounds = Number(roundsArg ?? 2);
const keyed = process.env.RPC_HOST === 'helius';
let url = 'https://api.devnet.solana.com';
if (keyed) { const k = process.env.HELIUS_API_KEY ?? ''; if (k.length < 20) throw new Error('RPC_HOST=helius needs HELIUS_API_KEY in the environment'); url = `https://devnet.helius-rpc.com/?api-key=${k}`; }
const host = new URL(url).host;
const lines = []; const say = (s) => { console.log(s); lines.push(s); if (out) fs.writeFileSync(out, `${lines.join('\n')}\n`); };
const SRC = process.env.H5_SOURCE ?? 'H9w4NsSrmFHrGsrU8G9pAL3emFeaVtDfegk9KNQHhfVc';
const GRANT = process.env.H5_GRANT ?? '4PmrfbJHdyq6RaMwQp7XYWu3APPqTNzrc8PZLfv9T23A4myMtKd7HYNfdfxAoduqAdmHy1CgwGGF276XaMe3MPJt';
const keys = await loadKeys();
const agent = keys.agent.address;
const load = async (root) => import(pathToFileURL(path.join(root, 'packages/core/src/index.js')).href);
const all = [
  ['Phase 1.5 one-by-one reader (142276f)', await load(W15)],
  ['Phase 1.6 batch reader (c521b31)', await load(W16)],
  ['paced reader (this tree)', await load(process.cwd())],
];
// READERS=15,paced (a subset, in this order; a reader may be repeated) for a shorter second run
const pick = { 15: 0, 16: 1, paced: 2 };
const readers = process.env.READERS ? process.env.READERS.split(',').map((k) => all[pick[k]]) : all;
function counting() {
  const st = { posts: 0, elements: 0, http429: 0, limitedElements: 0 };
  const fetchImpl = async (u, o) => {
    const body = JSON.parse(o.body); const n = Array.isArray(body) ? body.length : 1;
    st.posts++; st.elements += n;
    const r = await fetch(u, o);
    if (r.status === 429) st.http429++;
    else { try { const j = await r.clone().json(); st.limitedElements += (Array.isArray(j) ? j : [j]).filter((e) => e?.error && /too many|rate|limit/i.test(e.error.message)).length; } catch { /* not json */ } }
    return r;
  };
  return { st, fetchImpl };
}
say(`reader comparison, host ${host}${keyed ? ' (keyed)' : ' (public)'}, source ${SRC}, started ${new Date().toISOString()}`);
const rows = [];
for (let round = 1; round <= rounds; round++) {
  for (const [name, core] of readers) {
    if (!keyed) { say('  (quiet 45 s before the read, so the previous read\'s block has passed)'); await new Promise((r) => setTimeout(r, 45_000)); }
    const { st, fetchImpl } = counting();
    const rpc = core.makeRpc(url, { fetchImpl });
    const t0 = Date.now();
    let h, err = null;
    try { h = await core.agentSpendHistory(rpc, { source: SRC, agent, mint: MINT, until: GRANT }); } catch (e) { err = e.message.slice(0, 80); }
    const ms = Date.now() - t0;
    const row = { round, name, ms, ...st, complete: h?.complete ?? false, entries: h?.entries?.length ?? 0, err };
    rows.push(row);
    say(`round ${round} | ${name} | ${(ms / 1000).toFixed(1)} s | ${st.posts} POSTs, ${st.elements} elements | whole-request 429: ${st.http429}, rate-limited elements: ${st.limitedElements} | complete ${row.complete}, ${row.entries} agent debits${h && !h.complete ? `, incomplete because: ${String(h.reason).slice(0, 90)}` : ''}${err ? `, error: ${err}` : ''}`);
  }
}
say('\nmedian wall time per reader:');
for (const [name] of [...new Map(readers.map((r) => [r[0], r])).values()]) { const t = rows.filter((r) => r.name === name).map((r) => r.ms).sort((a, b) => a - b); say(`  ${name}: ${(t[Math.floor(t.length / 2)] / 1000).toFixed(1)} s over ${t.length} reads (${t.map((x) => (x / 1000).toFixed(0)).join(', ')} s)`); }
say(`finished ${new Date().toISOString()}`);
