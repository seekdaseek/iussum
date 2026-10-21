// K1, K2, K3 (review v5-lock.mjs, v5-agent.mjs): the data-directory lock is an OS-level lock held for the life of the agent (a SQLite connection inside BEGIN EXCLUSIVE),
// so two processes can never both run, a process that dies in ANY way (SIGTERM, SIGKILL) drops it, and there is no pid or stale-lock logic. After close() the agent
// refuses to work and writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, fakeRpc } from '../harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), CHILD = path.join(HERE, 'lock-child.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (f, ms = 15000) => { const t = Date.now(); while (!fs.existsSync(f)) { if (Date.now() - t > ms) throw new Error(`timeout waiting for ${f}`); await sleep(15); } };
function child(tc, role, dataDir, ctl, pause = 'none', fakePid = '-') {
  const k = spawn(process.execPath, ['--no-warnings', CHILD, role, dataDir, ctl, pause, fakePid], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = ''; k.stdout.on('data', (d) => { out += d; });
  tc.after(() => { try { k.kill('SIGKILL'); } catch { /* gone */ } });
  return { k, result: async () => { await waitFor(path.join(ctl, `${role}-done`)); return out.trim().split('\n')[0]; }, exited: () => new Promise((r) => k.on('exit', r)) };
}
const dirs = (tc) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-k-')); const ctl = `${d}-ctl`; fs.mkdirSync(ctl); tc.after(() => { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(ctl, { recursive: true, force: true }); }); return { d, ctl }; };
const started = (r) => r.startsWith('STARTED');

test('K1 L0 control: two processes start at once on one data directory: exactly one runs, the other is refused', async (tc) => {
  const { d, ctl } = dirs(tc);
  const a = child(tc, 'A', d, ctl), b = child(tc, 'B', d, ctl);
  const rs = [await a.result(), await b.result()];
  assert.equal(rs.filter(started).length, 1, rs.join(' | ')); assert.match(rs.find((x) => !started(x)), /REFUSED/);
});
test('K1 L2: B starts while A is at its lock attempt (between the create and the pid write of the old lock): exactly one agent runs', async (tc) => {
  const { d, ctl } = dirs(tc);
  const a = child(tc, 'A', d, ctl, 'lock'); await waitFor(path.join(ctl, 'A-at-lock'));
  const b = child(tc, 'B', d, ctl); const rb = await b.result();
  fs.writeFileSync(path.join(ctl, 'A-go'), ''); const ra = await a.result();
  assert.equal([ra, rb].filter(started).length, 1, `A: ${ra} | B: ${rb}`);
});
test('K1 repeated: 8 rounds of two processes starting together never give two running agents', async (tc) => {
  for (let i = 0; i < 8; i++) {
    const { d, ctl } = dirs(tc);
    const a = child(tc, 'A', d, ctl), b = child(tc, 'B', d, ctl);
    const rs = [await a.result(), await b.result()];
    assert.equal(rs.filter(started).length, 1, `round ${i}: ${rs.join(' | ')}`);
    a.k.kill('SIGKILL'); b.k.kill('SIGKILL'); await Promise.all([a.exited(), b.exited()]);
  }
});
for (const sig of ['SIGTERM', 'SIGKILL']) {
  test(`K2 the holder is stopped with ${sig}: a new agent starts at once, even when the restart gets the same pid as a live process (a container: pid 1)`, async (tc) => {
    const { d, ctl } = dirs(tc);
    const a = child(tc, 'A', d, ctl, 'none', String(process.pid)); // pretends to be a pid that is alive (this test process)
    assert.equal(await a.result(), 'STARTED');
    a.k.kill(sig); await a.exited();
    const { ctl: ctl2 } = dirs(tc);
    const b = child(tc, 'B', d, ctl2, 'none', String(process.pid));
    assert.equal(await b.result(), 'STARTED', 'the lock died with the process');
  });
}
test('K1 the same process cannot take the lock twice, and there is no stale-lock logic (agent.lock is only the rollback guard of Addendum N: our pid, no stale files)', async (tc) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-k-')); tc.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 1000, price: '100' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, {});
  const mk = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }), now: () => T0 + 1000, dataDir: d });
  const a = await mk();
  await assert.rejects(mk, /data directory|lock/i);
  const files = fs.readdirSync(d);
  assert.ok(files.some((f) => f.endsWith('.lock.db')), files.join());
  assert.ok(!files.some((f) => f.includes('.stale')), `a stale-lock file is there: ${files}`);
  assert.equal(Number.parseInt(fs.readFileSync(path.join(d, 'agent.lock'), 'utf8'), 10), process.pid, 'agent.lock holds our pid (the rollback guard), nothing decides on it');
  await a.close();
  assert.ok(!fs.existsSync(path.join(d, 'agent.lock')), 'and it goes away on close');
});
test('K3 after close() the agent refuses to fetch, and nothing is written to the data directory', async (tc) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-k-')); tc.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 1000, price: '100' });
  tc.after(() => { facilitator.close(); seller.close(); });
  const s = await newScenario(seller, { mandate: { per_payment_max: '1000', period_budget: '100000' } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }), now: () => T0 + 1000, dataDir: d });
  assert.equal((await a.fetch(seller.url)).status, 200);
  await a.close();
  const snap = () => fs.readdirSync(d).sort().map((f) => `${f}:${fs.statSync(path.join(d, f)).size}:${fs.statSync(path.join(d, f)).mtimeMs}`).join('|');
  const before = snap();
  await assert.rejects(() => a.fetch(seller.url), /closed/i);
  assert.equal(snap(), before, 'a file in the data directory changed after close()');
  assert.equal(facilitator.counts.settle, 1, 'nothing was paid after close()');
});
