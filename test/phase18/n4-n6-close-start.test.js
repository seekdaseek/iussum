// N4 and N6 (Addendum N): close() during a paid request must not throw away a settled response (N4); start and abort leaks completed (N6): an abort before the lock, an
// abandoned start that keeps reading, the rollback direction of the lock (a 142276f agent started after a new one), and a bounded close().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createAgent } from '@iussum/agent';
import { T0, A, mandate, grantTx, payTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, fakeRpc, liveAccount, GRANT_SIG } from '../harness.mjs';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';

const realFetch = globalThis.fetch, NOW = T0 + 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `n46-${n}-`));
const isPaid = (req, init) => (req instanceof Request ? req.headers : new Headers(init?.headers ?? {})).get('payment-signature');

test('N4 close() while a paid request is in flight: the settled response is returned and the consumed entry is on disk (a1-close-paid-lost)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const dataDir = tmp('paid');
  globalThis.fetch = async (req, init) => { const r = await realFetch(req, init); if (isPaid(req, init)) await sleep(200); return r; };
  let a; try { a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; }
  const pa = a.fetch(seller.url).then((r) => `status ${r.status}`, (e) => `THREW: ${e.message.slice(0, 80)}`);
  await sleep(100); await a.close();
  assert.equal(await pa, 'status 200');
  const f = fs.readdirSync(dataDir).find((x) => x.endsWith('.reservations.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')).reservations.map((x) => x.state ?? 'held'), ['consumed']);
  assert.equal(facilitator.counts.settle, 1); assert.equal(seller.hits.handler, 1);
  facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

const signer7 = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
const m7 = mandate({ agent: signer7.address, allow: { pay_to: [A.sellerA], resource_prefix: ['https://seller.test/v1/'] }, nonce: 'aa'.repeat(16) });
const node7 = () => { const rpc = fakeRpc(); rpc.grants.set(GRANT_SIG, grantTx(m7)); rpc.account = liveAccount(m7); return rpc; };
const start7 = (dataDir, rpc, extra = {}) => createAgent({ mandate: m7, grant_tx: GRANT_SIG, signer: signer7, rpc, getBlockhash: bh, dataDir, ...extra });
const slowNode = (ms) => { const rpc = node7(); const o = rpc.getAccountContext.bind(rpc); rpc.getAccountContext = async (...x) => { await sleep(ms); return o(...x); }; return rpc; };

for (const how of ['signal already aborted', 'aborted while the start is still before the lock', 'aborted in the same tick as the call']) {
  test(`N6 a ${how}: createAgent rejects and the lock is not leaked (a3-signal-early)`, async () => {
    const dataDir = tmp('early');
    const ac = new AbortController();
    if (how === 'signal already aborted') ac.abort();
    const p = start7(dataDir, slowNode(200), { signal: ac.signal });
    if (how !== 'signal already aborted') ac.abort();
    await assert.rejects(() => p, /abort/i);
    await sleep(700); // the build, if there is one, has had time to reach the lock and the next abort check
    if (how === 'signal already aborted') assert.deepEqual(fs.readdirSync(dataDir), [], 'nothing was built: no lock file was even created');
    const again = await start7(dataDir, node7()); // with the lock leaked this is refused until a garbage collection
    await again.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  });
}

test('N6 an abandoned start makes no more chain calls once it is aborted (a5-abandoned-keeps-reading)', async () => {
  const dataDir = tmp('reads');
  const rpc = node7();
  for (let i = 0; i < 150; i++) { const sg = `D${String(i).padStart(4, '0')}`.padEnd(88, 'z'); rpc.newer.push({ signature: sg, slot: 5000 - i, blockTime: null, err: null }); rpc.grants.set(sg, payTx({ noTransfer: true, slot: 5000 - i })); }
  rpc.newer.push({ signature: GRANT_SIG, slot: 1000, err: null });
  let aborted = false, after = 0; const o = rpc.getTransaction.bind(rpc);
  rpc.getTransaction = async (...x) => { if (aborted) after++; await sleep(10); return o(...x); };
  const ac = new AbortController();
  const p = start7(dataDir, rpc, { signal: ac.signal });
  await sleep(200); ac.abort(); aborted = true;
  await assert.rejects(() => p, /abort/i);
  await sleep(1500);
  assert.ok(after <= 12, `${after} getTransaction calls after the abort (the reads in flight when it came)`);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// the 142276f lock, as its code does it: O_EXCL create of agent.lock with the pid; if it exists, parseInt the pid and refuse while that process is alive
function legacyStart(dataDir) {
  const lock = path.join(dataDir, 'agent.lock');
  try { const fd = fs.openSync(lock, 'wx'); fs.writeSync(fd, `${process.pid}\n`); fs.closeSync(fd); return 'STARTED'; }
  catch (e) { if (e.code !== 'EEXIST') throw e; const pid = Number.parseInt(fs.readFileSync(lock, 'utf8'), 10); try { process.kill(pid, 0); return `REFUSED (pid ${pid})`; } catch { return 'STALE (it would break the lock and start)'; } }
}
test('N6 rollback: while a new agent holds a directory, a 142276f agent that starts afterwards is refused by agent.lock; the file goes away on close (a2-reverse-lock)', async () => {
  const dataDir = tmp('rollback');
  const a = await start7(dataDir, node7());
  const lock = path.join(dataDir, 'agent.lock');
  assert.ok(fs.existsSync(lock), 'agent.lock exists while the SQLite lock is held');
  assert.equal(Number.parseInt(fs.readFileSync(lock, 'utf8'), 10), process.pid, 'the first line is our pid, which is all a 142276f agent reads');
  assert.match(legacyStart(dataDir), /^REFUSED/);
  // a second agent of another grant in the same directory and process shares the guard; the file stays until the last one is closed
  const m8 = mandate({ agent: signer7.address, allow: m7.allow, nonce: 'ab'.repeat(16) }); const rpc8 = node7(); rpc8.grants.set('G8'.padEnd(88, 'h'), grantTx(m8));
  const b = await createAgent({ mandate: m8, grant_tx: 'G8'.padEnd(88, 'h'), signer: signer7, rpc: Object.assign(rpc8, { account: liveAccount(m8) }), getBlockhash: bh, dataDir });
  await a.close(); assert.ok(fs.existsSync(lock), 'still there: b is running');
  await b.close(); assert.ok(!fs.existsSync(lock), 'removed with the last agent');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
test('N6 rollback: the legacy check ignores a lock file that names a live NEW-format holder, and a stale new-format file is replaced', async () => {
  const dataDir = tmp('newfmt');
  const live = spawn('sleep', ['30']);
  try {
    fs.writeFileSync(path.join(dataDir, 'agent.lock'), `${live.pid}\niussum-sqlite someotherstem\n`);
    const a = await start7(dataDir, node7()); // not refused: the file is a new-format holder's (another grant), not a legacy agent
    assert.equal(Number.parseInt(fs.readFileSync(path.join(dataDir, 'agent.lock'), 'utf8'), 10), live.pid, 'and the other holder\'s file is left alone');
    await a.close(); assert.ok(fs.existsSync(path.join(dataDir, 'agent.lock')), 'a does not remove a file it did not create');
    fs.writeFileSync(path.join(dataDir, 'agent.lock'), `999999\niussum-sqlite deadstem\n`); // a crashed new-format holder
    const b = await start7(dataDir, node7());
    assert.equal(Number.parseInt(fs.readFileSync(path.join(dataDir, 'agent.lock'), 'utf8'), 10), process.pid, 'a stale new-format file is replaced by ours');
    await b.close();
  } finally { live.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('N6 close({ timeoutMs }) rejects when a payment is still in flight and KEEPS the lock; without a timeout close() still waits (a4-close-hang)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const dataDir = tmp('hang');
  let release; const gate = new Promise((r) => (release = r));
  globalThis.fetch = async (req, init) => { if (isPaid(req, init)) { await gate; } return realFetch(req, init); };
  let a; try { a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir }); } finally { globalThis.fetch = realFetch; }
  const pa = a.fetch(seller.url).then((r) => r.status, (e) => e.message);
  await sleep(200);
  const closing = await Promise.race([a.close({ timeoutMs: 300 }).then(() => 'resolved', (e) => e.message), sleep(3000).then(() => 'HUNG: close({ timeoutMs }) did not return')]);
  assert.match(closing, /payments still in flight/);
  await assert.rejects(() => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir }), /another agent holds/, 'the lock is kept');
  release(); await pa;
  await a.close({ timeoutMs: 2000 }); // nothing in flight any more: it closes and releases
  const b = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir });
  await b.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});
