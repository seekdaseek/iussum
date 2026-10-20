// M2 (Addendum M, K3 completed): close() stops every new payload and every write. Three review repros (a payment in flight at close(), agent.client used after
// close(), the naive agent through agent.client) and the start-up leaks (a start that fails, a start the caller abandons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { wrapFetchWithPayment } from '@x402/fetch';
import { createAgent } from '@iussum/agent';
import { T0, A as ADDR } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, fakeRpc, liveAccount, GRANT_SIG, blockhash } from '../harness.mjs';
import { mandate, grantTx } from '../fixtures.mjs';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';

const realFetch = globalThis.fetch, NOW = T0 + 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 70)}`; } };
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `m2-${n}-`));

test('M2 a payment in flight at close() never signs a payload: B on the same directory cannot be exposed to 40000 against 30000 (v6-close)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: true }; if (m === 'getBlockHeight') return 50; throw new Error(m); };
  const dataDir = tmp('inflight');
  const make = async (f) => { globalThis.fetch = f; try { return await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; } };
  let kept = 0;
  const slowKeep = async (req) => { await sleep(200); if (req.headers.get('payment-signature')) { kept++; return new Response('{}', { status: 502 }); } return realFetch(req); };
  const a = await make(slowKeep);
  const pa = out(a.fetch(seller.url));
  await sleep(50);
  await a.close(); // returns once A's payment has returned
  const b = await make(realFetch);
  const rb = await out(b.fetch(seller.url));
  const ra = await pa;
  assert.equal(kept, 0, 'A signed and sent no payload after close()');
  assert.ok((kept + facilitator.counts.settle) * 20000 <= 30000, `exposure ${(kept + facilitator.counts.settle) * 20000} (A ${ra}, B ${rb})`);
  await b.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('M2 close() waits for the payments in flight, then releases the lock', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const dataDir = tmp('wait');
  globalThis.fetch = async (req) => { await sleep(300); return realFetch(req); };
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir });
  globalThis.fetch = realFetch;
  let returned = false;
  const pa = out(a.fetch(seller.url)).then((r) => { returned = true; return r; });
  await sleep(50);
  await a.close();
  assert.equal(returned, true, 'close() returned only after the in-flight payment returned');
  await pa; facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('M2 agent.client used after close() reads no chain, writes nothing, and cannot erase the next agent\'s held reservation (close-client)', async () => {
  const BH_A = ADDR.sellerB, BH_B = '11111111111111111111111111111111';
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m, p) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: p[0] !== BH_A }; if (m === 'getBlockHeight') return 150; throw new Error(m); };
  const dataDir = tmp('client');
  const keep = async (req) => (req.headers.get('payment-signature') ? new Response('{}', { status: 502 }) : realFetch(req));
  const make = async (f, bhash) => { globalThis.fetch = f; try { return await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: bhash, lastValidBlockHeight: 100n, contextSlot: 10 }), now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; } };
  const a = await make(keep, BH_A); await out(a.fetch(seller.url)); await a.close();
  const b = await make(keep, BH_B); await out(b.fetch(seller.url));
  const snap = () => fs.readdirSync(dataDir).filter((f) => !f.includes('.lock.db')).sort().map((f) => `${f}@${fs.statSync(path.join(dataDir, f)).ino}:${fs.readFileSync(path.join(dataDir, f), 'utf8').length}`).join(' ');
  const calls = []; const origCall = seller.rpc.call; seller.rpc.call = async (...x) => { calls.push(x[0]); return origCall(...x); };
  const before = snap();
  const challenge = await realFetch(seller.url);
  const paymentRequired = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString('utf8'));
  await assert.rejects(() => a.client.createPaymentPayload(paymentRequired));
  assert.equal(snap(), before, 'the data directory is untouched');
  assert.deepEqual(calls, [], 'the hook reads no chain once the agent is closed');
  await b.close();
  const b2 = await make(realFetch, BH_B);
  assert.equal(await out(b2.fetch(seller.url)), 'period_over_budget', 'B\'s held reservation survived: the restarted B is refused');
  await b2.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

test('M2 the naive agent cannot sign or pay through agent.client after close() (close-client-naive)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '100' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '1000' } });
  const dataDir = tmp('naive');
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, dataDir, localChecks: false });
  const viaClient = wrapFetchWithPayment(fetch, a.client);
  assert.equal(await out(a.fetch(seller.url)), 200);
  await a.close();
  const r = await out(viaClient(seller.url));
  assert.notEqual(r, 200, `agent.client paid after close(): ${r}`);
  assert.equal(facilitator.counts.settle, 1);
  facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

const signer7 = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
const m7 = mandate({ agent: signer7.address, allow: { pay_to: [ADDR.sellerA], resource_prefix: ['https://seller.test/v1/'] }, nonce: 'aa'.repeat(16) });
const rpc7 = (over = {}) => { const rpc = fakeRpc(); rpc.grants.set(GRANT_SIG, grantTx(m7)); rpc.account = liveAccount(m7); return Object.assign(rpc, over); };
const start7 = (dataDir, rpc, extra = {}) => createAgent({ mandate: m7, grant_tx: GRANT_SIG, signer: signer7, rpc, getBlockhash: bh, dataDir, ...extra });

test('M2 a start that fails after the lock was taken releases it (leak-enospc: the directory becomes unwritable during the start)', async () => {
  // the failed start runs in a child that stays alive and idle, so a leaked lock cannot be freed by a garbage collection while the parent tries
  const dataDir = tmp('enospc');
  const k = spawn(process.execPath, ['--no-warnings', path.join(path.dirname(new URL(import.meta.url).pathname), 'm2-child-failstart.mjs'), dataDir], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const line = await new Promise((r) => { let o = ''; k.stdout.on('data', (d) => { o += d; if (o.includes('\n')) r(o.trim()); }); });
    assert.match(line, /^FAILED/);
    const again = await start7(dataDir, rpc7()); // with the lock leaked by the failed start this is refused
    await again.close();
  } finally { k.kill('SIGKILL'); fs.chmodSync(dataDir, 0o700); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('M2 a start the caller abandons through cfg.signal releases the lock at once and writes nothing afterwards (leak-abandoned)', async () => {
  const dataDir = tmp('abandoned');
  const rpc = rpc7(); const o = rpc.getSignaturesForAddress.bind(rpc);
  rpc.getSignaturesForAddress = async (...x) => { await sleep(500); return o(...x); }; // the first read of the history is slow
  const ctl = new AbortController(); setTimeout(() => ctl.abort(), 150);
  await assert.rejects(() => start7(dataDir, rpc, { signal: ctl.signal }), /abort/i);
  await sleep(1500); // the abandoned start finishes its slow read: it must not write the directory it no longer owns
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => !f.includes('.lock.db')), [], 'the abandoned start wrote nothing');
  const again = await start7(dataDir, rpc7()); // and its lock was released at once
  await again.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});
