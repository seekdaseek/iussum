// H5 (Addendum H): the first read at scale, once, on devnet. A dedicated throw-away principal and grant; after the grant, 250 dust credits of 1 base unit each
// into the source account (paced), then 3 agent payments; then two disputes with an instrumented RPC: the first reads the whole history since the grant, the
// second shows what the checkpoint saves. Output: demo-runs-1.5/h5-scale.txt and demo-runs-1.5/h5-dust-signatures.txt.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes, createKeyPairSignerFromBytes } from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction } from '@solana-program/token';
import { createAgent } from '@iussum/agent';
import { createResolver, openStore } from '@iussum/resolver';
import { makeRpc, principalAta, mandateId } from '@iussum/core';
import { loadKeys, makeCtx, sendGrant, sendTx, startDemoSeller, sleep, NETWORK, MINT, RPC_URL } from './demo-lib.mjs';

const OUT = process.env.OUT_DIR ?? 'demo-runs-1.5';
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };
const ctx = makeCtx(), keys = await loadKeys();

// the throw-away principal (kept in .secrets, which is not in git)
const file = new URL('../.secrets/h5-principal.json', import.meta.url).pathname;
if (!fs.existsSync(file)) { const seed = randomBytes(32); const s = await createKeyPairSignerFromPrivateKeyBytes(seed, true); fs.writeFileSync(file, JSON.stringify([...seed, ...Buffer.from(await crypto.subtle.exportKey('raw', s.keyPair.publicKey))]), { mode: 0o600 }); }
const P2 = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(file, 'utf8'))));
say(`H5 on devnet, rpc ${RPC_URL}\nthrow-away principal ${P2.address}`);
const sol = async (a) => (await ctx.rpc.call('getBalance', [a])).value;
const p2ata = await principalAta(P2.address, MINT);
if ((await sol(P2.address)) < 20_000_000) {
  const sys = { programAddress: '11111111111111111111111111111111', accounts: [{ address: keys.principal.address, role: 3 }, { address: P2.address, role: 1 }], data: Uint8Array.from([2, 0, 0, 0, ...new Uint8Array(new BigUint64Array([30_000_000n]).buffer)]) };
  const sig = await sendTx(ctx.rpc, keys.principal, [sys, await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: keys.principal, mint: MINT, owner: P2.address }),
    getTransferCheckedInstruction({ source: await principalAta(keys.principal.address, MINT), mint: MINT, destination: p2ata, authority: keys.principal, amount: 200_000n, decimals: 6 })]);
  say(`funded the throw-away principal (0.03 SOL, 0.2 USDC): ${sig}`);
}

const A = await startDemoSeller(ctx, { name: 'A', signer: keys.sellerA, mode: 'enforce' });
const sellerPub = (await (await fetch(`${A.origin}/.well-known/iussum.json`)).json()).seller;
const t = Math.floor(Date.now() / 1000);
const m = { v: 'iussum/0.2', principal: P2.address, agent: keys.agent.address, network: NETWORK, asset: MINT, total_cap: '1000000', per_payment_max: '20000', period_budget: '100000', period_seconds: 86400, allow: { pay_to: [A.address], resource_prefix: [`${A.origin}/`] }, not_before: t - 60, expires_at: t + 86400, nonce: randomBytes(16).toString('hex') };
const grant_tx = await sendGrant(ctx, { principal: P2 }, m);
say(`grant (dedicated principal): ${grant_tx}\nmandate id ${mandateId(m)}`);

// 250 dust credits of 1 base unit, from the throw-away funding key (the refund float), paced to stay under the public RPC's rate limit
const dust = [];
const src = await principalAta(keys.float.address, MINT);
const t0d = Date.now();
for (let i = 1; i <= 250; i++) {
  for (let attempt = 0; ; attempt++) {
    try { dust.push(await sendTx(ctx.rpc, keys.float, [getTransferCheckedInstruction({ source: src, mint: MINT, destination: p2ata, authority: keys.float, amount: 1n, decimals: 6 })])); break; }
    catch (e) { if (attempt >= 5) throw e; await sleep(2000 * (attempt + 1)); }
  }
  await sleep(250);
  if (i % 50 === 0) say(`  ${i} dust credits sent (${((Date.now() - t0d) / 1000).toFixed(0)} s)`);
}
fs.writeFileSync(`${OUT}/h5-dust-signatures.txt`, `${dust.join('\n')}\n`);
say(`250 dust credits of 1 base unit into ${p2ata}; signatures in ${OUT}/h5-dust-signatures.txt (${new Set(dust).size} distinct)`);

// three agent payments (the agent's own first read happens at createAgent: measured too)
const counts = () => ({ c: {}, total: 0 });
const instrument = () => { const k = counts(); const fetchImpl = async (u, o) => { const method = JSON.parse(o.body).method; k.c[method] = (k.c[method] ?? 0) + 1; k.total++; return fetch(u, o); }; return { k, rpc: makeRpc(RPC_URL, { fetchImpl }) }; };
const ag = instrument();
const tA = Date.now();
const agent = await createAgent({ mandate: m, grant_tx, signer: keys.agent, rpc: ag.rpc });
say(`the agent's first read at start (250 dust credits in the account): ${ag.k.c.getSignaturesForAddress ?? 0} signature pages, ${ag.k.c.getTransaction ?? 0} transactions fetched, ${ag.k.total} RPC calls, ${((Date.now() - tA) / 1000).toFixed(1)} s`);
const rcpts = [];
for (let i = 0; i < 3; i++) { const r = await agent.fetch(A.url('quote')); if (r.status !== 200) throw new Error(`payment ${i + 1}: HTTP ${r.status}`); rcpts.push(r.receipt); say(`agent payment ${i + 1}: ${r.receipt.tx_sig}`); }

// two disputes with an instrumented resolver RPC (a fresh client with an empty cache), the same service and store
const rs = instrument();
const service = createResolver({ rpc: rs.rpc, network: NETWORK, sellerKey: async () => sellerPub, store: openStore(':memory:') });
async function dispute(label, r) {
  const before = { ...rs.k.c }, tot = rs.k.total, t1 = Date.now();
  const v = await service.dispute({ tx_sig: r.tx_sig, mandate: m, grant_tx, receipt: r });
  const d = (k) => (rs.k.c[k] ?? 0) - (before[k] ?? 0);
  say(`${label}: verdict ${v.verdict}/${v.reason}/${v.liable} | pages (getSignaturesForAddress) ${d('getSignaturesForAddress')} | transactions fetched (getTransaction) ${d('getTransaction')} | RPC calls ${rs.k.total - tot} | wall time ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  return v;
}
const v1 = await dispute('dispute 1 (first read of the whole history since the grant)', rcpts[0]);
const v2 = await dispute('dispute 2 (a different payment, the checkpoint is used)', rcpts[2]);
const ok = ['in_scope'].includes(v1.reason) && v1.reason === v2.reason && v1.liable === 'principal';
say(`both disputes decided (not history_incomplete): ${ok ? 'YES' : 'NO'}`);
fs.writeFileSync(`${OUT}/h5-scale.txt`, `${lines.join('\n')}\n`);
A.close(); process.exit(ok ? 0 : 1);
