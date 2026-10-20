// M3 (Addendum M): money over budget across a period boundary, across a restart against a lagging node, across an upgrade from a 142276f data directory, and
// an expiry answer without a context slot. The sixth review's repros (period-edge, restart-lag, upgrade-lock, upgrade-reservations, i3-nocontext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createAgent } from '@iussum/agent';
import { periodIndex, mandateId } from '@iussum/core';
import { T0, DAY, payTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, liveAccount } from '../harness.mjs';

const realFetch = globalThis.fetch;
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 60)}`; } };
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `m3-${n}-`));
const notExpired = (seller) => { seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: true }; if (m === 'getBlockHeight') return 50; throw new Error(m); }; };
const keepFirst = () => { let w = null; return { get: () => w, fetch: async (req) => { if (req.headers.get('payment-signature') && !w) { w = req.headers.get('payment-signature'); return new Response('{}', { status: 502 }); } return realFetch(req); } }; };

for (const landsAt of [T0 + DAY - 5, T0 + DAY + 5]) {
  test(`M3 (a) a payload kept in period 0 that lands at period ${periodIndex({ period_seconds: DAY, not_before: T0 }, landsAt)} cannot take period 1 over budget (period-edge)`, async () => {
    let now = T0 + DAY - 10;
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => now, price: '20000' });
    const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
    notExpired(seller);
    const k = keepFirst(); globalThis.fetch = k.fetch;
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => now });
    globalThis.fetch = realFetch;
    await out(a.fetch(seller.url));
    await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(k.get(), 'base64').toString()) }) });
    const sig1 = 'LANDED1'.padEnd(88, 'x'); const tx = payTx({ slot: 2000, blockTime: landsAt, amount: '20000', authority: s.signer.address }); tx.transaction.signatures = [sig1, a.reservations[0].agentSig];
    seller.rpc.grants.set(sig1, tx); seller.rpc.newer = [{ signature: sig1, slot: 2000, blockTime: landsAt, err: null }];
    seller.rpc.account = liveAccount(s.mandate, { delegatedAmount: { amount: String(BigInt(s.mandate.total_cap) - 20000n) } });
    now = T0 + DAY + 10;
    const r2 = await out(a.fetch(seller.url)); const r3 = await out(a.fetch(seller.url));
    const inPeriod1 = (periodIndex(s.mandate, landsAt) === 1 ? 20000 : 0) + (facilitator.counts.settle - 1) * 20000;
    assert.ok(inPeriod1 <= 30000, `payment 2 ${r2}, payment 3 ${r3}: ${inPeriod1} lands in period 1 against a budget of 30000`);
    await a.close(); facilitator.close(); seller.close();
  });
}

for (const lagging of [false, true]) {
  test(`M3 (b) a restart against a ${lagging ? 'lagging' : 'caught-up'} node does not forget a payment that settled (restart-lag)`, async () => {
    const NOW = T0 + 1000;
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
    const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
    const dataDir = tmp('lag');
    const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir });
    const a = await make();
    assert.equal(await out(a.fetch(seller.url)), 200);
    const settledSig = a.ledger[0]?.sig, agentSig = a.reservations[0]?.agentSig;
    if (!lagging) {
      const tx = payTx({ slot: 2000, blockTime: NOW, amount: '20000', authority: s.signer.address }); tx.transaction.signatures = [settledSig, agentSig];
      seller.rpc.grants.set(settledSig, tx); seller.rpc.newer = [{ signature: settledSig, slot: 2000, blockTime: NOW, err: null }];
      seller.rpc.account = liveAccount(s.mandate, { delegatedAmount: { amount: String(BigInt(s.mandate.total_cap) - 20000n) } });
    }
    await a.close();
    const b = await make();
    const r2 = await out(b.fetch(seller.url));
    assert.equal(r2, 'period_over_budget', `payment 2 after the restart: ${r2}; settled ${facilitator.counts.settle * 20000} against 30000`);
    assert.equal(facilitator.counts.settle, 1);
    await b.close();
    // once the node has caught up, the entry is dropped from the file and the payment is counted once
    if (lagging) {
      const tx = payTx({ slot: 2000, blockTime: NOW, amount: '20000', authority: s.signer.address }); tx.transaction.signatures = [settledSig, agentSig];
      seller.rpc.grants.set(settledSig, tx); seller.rpc.newer = [{ signature: settledSig, slot: 2000, blockTime: NOW, err: null }];
      seller.rpc.account = liveAccount(s.mandate, { delegatedAmount: { amount: String(BigInt(s.mandate.total_cap) - 20000n) } });
      const c = await make();
      assert.equal(c.ledger.filter((x) => x.sig === settledSig).length, 1, 'counted once');
      assert.equal(await out(c.fetch(seller.url)), 'period_over_budget');
      await c.close();
    }
    facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
  });
}

test('M3 (c) a live legacy agent.lock (a 142276f process on the same directory) stops a new agent; a dead one and our own pid do not', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 1000, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  const dataDir = tmp('legacy-lock');
  const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => T0 + 1000, dataDir });
  const live = spawn('sleep', ['30']); const dead = spawn('true'); await new Promise((r) => dead.on('exit', r));
  try {
    fs.writeFileSync(path.join(dataDir, 'agent.lock'), `${live.pid}\n`);
    await assert.rejects(() => make(), /legacy|agent\.lock|another agent/i);
    fs.writeFileSync(path.join(dataDir, 'agent.lock'), `${dead.pid}\n`);
    await (await make()).close();
    fs.writeFileSync(path.join(dataDir, 'agent.lock'), `${process.pid}\n`); // a restart in a container gets the same pid again: not a holder
    await (await make()).close();
  } finally { live.kill('SIGKILL'); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('M3 (c) the held entries of a 142276f reservations file are imported: a payload kept before the upgrade is not forgotten (upgrade-reservations)', async () => {
  const NOW = T0 + 1000;
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
  const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
  notExpired(seller);
  const dataDir = tmp('legacy-res');
  const k = keepFirst(); globalThis.fetch = k.fetch;
  const make = () => createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW, dataDir });
  const a = await make(); globalThis.fetch = realFetch;
  assert.equal(await out(a.fetch(seller.url)), 502);
  await a.close();
  // what 142276f would have left: the reservations file under its own name (mandate id prefix + agent prefix), no file under the new stem
  const f = fs.readdirSync(dataDir).find((x) => x.endsWith('.reservations.json'));
  const legacy = `${mandateId(s.mandate).slice(0, 16)}-${s.signer.address.slice(0, 8)}.reservations.json`;
  fs.renameSync(path.join(dataDir, f), path.join(dataDir, legacy));
  for (const x of fs.readdirSync(dataDir)) if (x.endsWith('.checkpoint.json') || x.endsWith('.scan.json')) fs.rmSync(path.join(dataDir, x));
  const b = await make();
  const rb = await out(b.fetch(seller.url));
  assert.equal(rb, 'period_over_budget', `the kept payload (20000) must count: run 2 paid ${rb}`);
  assert.ok(b.reservations.some((r) => r.state === 'held'), 'the legacy entry is held again');
  assert.ok(!fs.existsSync(path.join(dataDir, legacy)), 'the legacy file is moved aside, not read again at every start');
  await b.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});

for (const [label, answer] of [['false (no context)', false], ['{ value: false } (no context)', { value: false }], ['{ context: { slot: "200" }, value: false }', { context: { slot: '200' }, value: false }]]) {
  test(`M3 (d) an expiry answer without an integer context slot is not proof: ${label} (i3-nocontext)`, async () => {
    const NOW = T0 + 1000;
    const facilitator = await startMockFacilitator();
    const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '20000' });
    const s = await newScenario(seller, { mandate: { period_budget: '30000', per_payment_max: '20000' } });
    seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return answer; if (m === 'getBlockHeight') return 101; throw new Error(m); };
    const k = keepFirst(); globalThis.fetch = k.fetch;
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: bh, now: () => NOW });
    globalThis.fetch = realFetch;
    await out(a.fetch(seller.url));
    await realFetch(`${facilitator.url}/settle`, { method: 'POST', body: JSON.stringify({ paymentPayload: JSON.parse(Buffer.from(k.get(), 'base64').toString()) }) });
    const landedSig = 'LANDED1'.padEnd(88, 'x');
    const landedTx = payTx({ slot: 2000, blockTime: NOW, amount: '20000', authority: s.signer.address }); landedTx.transaction.signatures = [landedSig, a.reservations[0].agentSig];
    seller.rpc.grants.set(landedSig, landedTx); seller.rpc.nodeSlot = 198;
    const r2 = await out(a.fetch(seller.url));
    assert.equal(a.reservations[0].state, 'held'); assert.equal(r2, 'period_over_budget');
    await a.close(); facilitator.close(); seller.close();
  });
}
