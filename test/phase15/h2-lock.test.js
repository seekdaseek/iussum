// H2: one agent per data directory. An exclusive lock (a lock file with the PID, created with O_EXCL; a stale lock is cleared only when that PID is not
// running); a corrupt or partial reservations file makes the agent refuse to pay; a temp file left by a crash between write and rename is ignored.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
afterEach(() => { globalThis.fetch = realFetch; });
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
async function setup(tc) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-agent-'));
  tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: true }; if (m === 'getBlockHeight') return 50; throw new Error(`unexpected ${m}`); };
  const make = (extra = {}) => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir, ...extra });
  return { seller, s, dataDir, make };
}
const lockFile = (dir) => path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.lock')) ?? 'none.lock'); // one lock file per grant (Phase 1.6)
const reservationsFile = (dir) => path.join(dir, fs.readdirSync(dir).find((f) => f.includes('.reservations.json') && !f.endsWith('.tmp')));
test('H2 a second agent on the same dataDir refuses to start while the first one runs', async (tc) => {
  const t = await setup(tc);
  const a1 = await t.make(); tc.after(() => a1.close?.());
  await assert.rejects(() => t.make(), /data directory|lock/i);
  assert.ok(fs.existsSync(lockFile(t.dataDir)), 'the lock file holds the PID');
  assert.equal(fs.readFileSync(lockFile(t.dataDir), 'utf8').trim(), String(process.pid));
});
test('H2 after close() the next agent can start; a stale lock of a dead PID is cleared, a live one is not', async (tc) => {
  const t = await setup(tc);
  const a1 = await t.make(); const lock = lockFile(t.dataDir); await a1.close();
  const a2 = await t.make(); await a2.close();
  fs.writeFileSync(lock, '99999999\n'); // no such process
  const a3 = await t.make(); await a3.close();
  fs.writeFileSync(lock, `${process.ppid}\n`); // the parent process is running
  await assert.rejects(() => t.make(), /data directory|lock/i);
});
test('H2 a truncated reservations file makes the agent refuse to pay (it is never read as empty)', async (tc) => {
  const t = await setup(tc);
  globalThis.fetch = async (req) => (req.headers.get('payment-signature') ? new Response('{}', { status: 502 }) : realFetch(req));
  const a1 = await t.make(); globalThis.fetch = realFetch;
  await a1.fetch(t.seller.url).catch(() => {}); await a1.close();
  const f = reservationsFile(t.dataDir); const txt = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, txt.slice(0, Math.floor(txt.length / 2)));
  const a2 = await t.make(); tc.after(() => a2.close?.());
  const r = await a2.fetch(t.seller.url).then((x) => x.status, (e) => e.reason ?? e.message);
  assert.notEqual(r, 200, 'a payment went through although the reservations file was corrupt');
  assert.equal(r, 'history_incomplete');
});
test('H2 a temp file left behind by a crash between write and rename: the last complete file is loaded', async (tc) => {
  const t = await setup(tc);
  globalThis.fetch = async (req) => (req.headers.get('payment-signature') ? new Response('{}', { status: 502 }) : realFetch(req));
  const a1 = await t.make(); globalThis.fetch = realFetch;
  await a1.fetch(t.seller.url).catch(() => {}); await a1.close();
  const f = reservationsFile(t.dataDir);
  fs.writeFileSync(`${f}.4242.1700000000000.tmp`, '{"v":1,"reservations":[{"amount":"1'); // a half-written next version
  const a2 = await t.make(); tc.after(() => a2.close?.());
  assert.deepEqual(a2.reservations.map((r) => r.state), ['held'], 'the held payload from the last complete file is known');
  assert.equal(await a2.fetch(t.seller.url).then((x) => x.status, (e) => e.reason ?? e.message), 'period_over_budget');
  assert.deepEqual(fs.readdirSync(t.dataDir).filter((x) => x.endsWith('.tmp')), [], 'the stray temp file is removed once the lock is held');
});
