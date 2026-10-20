// Fourth pass (b5dfa77, imports ../). R1 persistence and T1 error paths, on the repo's own harness (real @x402/express seller, mock facilitator).
//  A: a reservations file that cannot be parsed is read as "no reservations" (agent.js readJson -> null -> []), so a payload the seller kept is forgotten.
//  B: two processes of one agent on one dataDir: last writer wins, a held reservation disappears from disk.
//  C: T1 error paths: minContextSlot not reached / getBlockHeight error must leave the reservation held.
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../packages/agent/src/index.js';
import { T0 } from '../test/fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../test/harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const BASE = '/tmp/claude-0/-home-claude/14b15ee1-14b1-5e02-8b04-582538b3093f/scratchpad/review/v4-data';
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? e.message; } };
async function setup(name, budget, call) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const dataDir = path.join(BASE, name); fs.rmSync(dataDir, { recursive: true, force: true });
  const s = await newScenario(seller, { mandate: { period_budget: String(budget), per_payment_max: '20000' } });
  seller.rpc.call = call ?? (async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: true }; if (m === 'getBlockHeight') return 50; throw new Error(`unexpected ${m}`); }); // the payload's blockhash is still valid
  const withheld = [];
  const keep = async (req) => { if (req.headers.get('payment-signature')) { withheld.push(req.headers.get('payment-signature')); return new Response('{}', { status: 502 }); } return realFetch(req); }; // the seller keeps the payload
  const make = async (f = realFetch) => { globalThis.fetch = f; try { return await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; } };
  const land = async () => { for (const w of withheld.splice(0)) await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(w, 'base64').toString()) }) }); };
  const resFile = () => path.join(dataDir, fs.readdirSync(dataDir).find((f) => f.endsWith('.reservations.json')));
  return { facilitator, seller, make, keep, land, resFile, close: () => { facilitator.close(); seller.close(); } };
}
// A
for (const damage of ['none (control)', 'truncated to half', 'replaced by {}']) {
  const t = await setup(`A-${damage.split(' ')[0]}`, 30000);
  const a1 = await t.make(t.keep);
  const r1 = await out(a1.fetch(t.seller.url)); // 502: the seller kept payload 1, the reservation is held and on disk
  const f = t.resFile(), txt = fs.readFileSync(f, 'utf8');
  if (damage.startsWith('truncated')) fs.writeFileSync(f, txt.slice(0, Math.floor(txt.length / 2)));
  if (damage.startsWith('replaced')) fs.writeFileSync(f, '{}');
  const a2 = await t.make(); // restart
  const r2 = await out(a2.fetch(t.seller.url));
  await t.land(); // the seller lands payload 1 within its blockhash life
  console.log(`A file ${damage}: 1st ${r1}; after restart ${a2.reservations.filter((r) => r.state === 'held').length} held, 2nd ${r2} | settled ${t.facilitator.counts.settle * 20000} vs budget 30000`);
  t.close();
}
// B
{
  const t = await setup('B', 50000);
  const p1 = await t.make(t.keep), p2 = await t.make(t.keep); // two processes of the same agent, same dataDir
  await out(p1.fetch(t.seller.url)); await out(p2.fetch(t.seller.url)); // each: seller keeps the payload
  const onDisk = JSON.parse(fs.readFileSync(t.resFile(), 'utf8')).reservations.length;
  const p3 = await t.make(); const r = await out(p3.fetch(t.seller.url)); await t.land();
  console.log(`B two processes kept 2 payloads; on disk ${onDisk}; restarted agent holds ${p3.reservations.filter((x) => x.state === 'held').length}, next payment ${r} | settled ${t.facilitator.counts.settle * 20000} vs budget 50000`);
  t.close();
}
// C
for (const [label, call] of [
  ['minContextSlot not reached', async (m) => { if (m === 'isBlockhashValid' || m === 'getBlockHeight') throw new Error('Minimum context slot has not been reached'); throw new Error(m); }],
  ['getBlockHeight error', async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: false }; if (m === 'getBlockHeight') throw new Error('rpc http 503'); throw new Error(m); }],
  ['control: proven expiry', async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: false }; if (m === 'getBlockHeight') return 101; throw new Error(m); }],
]) {
  const t = await setup(`C-${label.split(' ')[0]}`, 30000, call);
  const a = await t.make(t.keep); await out(a.fetch(t.seller.url));
  const r2 = await out(a.fetch(t.seller.url));
  console.log(`C ${label}: reservation ${a.reservations[0].state}, next payment ${r2}`);
  t.close();
}
