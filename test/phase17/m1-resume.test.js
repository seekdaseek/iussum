// M1 (Addendum M, sixth review): a resumed supersession scan must read what landed after the old scan's top before it answers "current".
// A scan cut short after its first full page (an RPC error, the J2 stall, a restart) is the normal J1 case. The three repros of the review (core, real gate
// with and without a restart, resolver) plus M1 (a) a non-null element that is not a jsonParsed transaction and (b) a scan_state row that does not parse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createGrantChecker, scanSupersede, mandateId } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, grantTx, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, liveAccount } from '../harness.mjs';

const M1 = mandate({ nonce: '01'.repeat(16) });
const M2 = mandate({ nonce: '02'.repeat(16), total_cap: '500000', per_payment_max: '20000' });
function chain() {
  const c = chainSim();
  const G1 = c.add('G1', grantAt(M1, 1000));
  for (let i = 1; i <= 150; i++) c.add(`D${i}`, dustCredit(1000 + i)); // more than one page of 100
  c.setAccount(SRC, live(M1));
  return { c, G1 };
}
const memStore = () => { const disk = new Map(); return { disk, get: (k) => (disk.has(k) ? JSON.parse(disk.get(k)) : undefined), put: (k, v) => disk.set(k, JSON.stringify(v)) }; };

test('M1 core: a resumed scan sees the re-grant that landed after the cut-short scan began (r1)', async () => {
  const { c, G1 } = chain(); const store = memStore();
  const checker = createGrantChecker(c, { scanStore: store });
  c.failPage = 2;
  const r1 = await checker.check(M1, G1, { active: true });
  assert.equal(r1.ok, false, 'the cut-short scan fails closed');
  const G2 = c.add('G2', grantAt(M2, 2000)); c.setAccount(SRC, live(M2));
  c.failPage = null;
  const r2 = await checker.check(M1, G1, { active: true });
  assert.equal(r2.ok, false, JSON.stringify(r2)); assert.match(r2.detail, new RegExp(G2));
  assert.equal((await createGrantChecker(c).check(M1, G1, { active: true })).ok, false, 'control: a fresh checker agrees');
});
test('M1 core: a resume after a restart (state from the store, new checker) sees it too', async () => {
  const { c, G1 } = chain(); const store = memStore();
  c.failPage = 2; await createGrantChecker(c, { scanStore: store }).check(M1, G1, { active: true });
  c.add('G2', grantAt(M2, 2000)); c.setAccount(SRC, live(M2)); c.failPage = null;
  const r = await createGrantChecker(c, { scanStore: store }).check(M1, G1, { active: true });
  assert.equal(r.ok, false);
});
test('M1 core: when nothing new landed, a resumed scan answers current and reads the new part only once', async () => {
  const { c, G1 } = chain(); const store = memStore();
  const checker = createGrantChecker(c, { scanStore: store });
  c.failPage = 2; await checker.check(M1, G1, { active: true }); c.failPage = null;
  const r = await checker.check(M1, G1, { active: true });
  assert.equal(r.ok, true);
  const before = c.calls.pages.length;
  assert.equal((await checker.check(M1, G1, { active: true })).ok, true);
  assert.ok(c.calls.pages.length - before <= 1, 'the next check reads only what is newer than the marker');
});

async function gate({ restart = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-gate-'));
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { grantCheckBudgetMs: 5000, retryAfterSeconds: 1, ...(restart ? { dataDir } : {}) } });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const rpc = seller.rpc;
  const dust = Array.from({ length: 150 }, (_, i) => `DUST${i}`.padEnd(88, 'x'));
  for (const [i, d] of dust.entries()) rpc.grants.set(d, dustCredit(1001 + i));
  rpc.newer = dust.map((signature) => ({ signature, err: null })).reverse();
  const orig = rpc.getSignaturesForAddress.bind(rpc); let n = 0;
  rpc.getSignaturesForAddress = async (...a) => { if (++n === 2) throw new Error('rpc http 429 (simulated)'); return orig(...a); };
  const agentRpc = fakeRpc(); agentRpc.grants = rpc.grants; agentRpc.account = rpc.account;
  const agent = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: agentRpc, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const r1 = await agent.fetch(seller.url); await r1.text();
  if (restart) seller.restartGate();
  const M2b = { ...s.mandate, nonce: 'bb'.repeat(16), total_cap: '500000' };
  const G2 = 'G2'.padEnd(88, 'y'); const g2 = grantTx(M2b); g2.slot = 5000;
  rpc.grants.set(G2, g2); rpc.newer = [{ signature: G2, err: null }, ...rpc.newer];
  rpc.account = liveAccount(M2b); agentRpc.account = rpc.account;
  return { seller, facilitator, agent, close: async () => { await agent.close(); seller.close(); facilitator.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }, first: r1.status };
}
for (const [label, restart, conc] of [['default', false, 1], ['after a gate restart', true, 1], ['5 requests at once', false, 5]]) {
  test(`M1 gate (${label}): nothing settles under M1 after G2 superseded it (r2)`, async () => {
    const t = await gate({ restart });
    try {
      const rs = await Promise.all(Array.from({ length: conc }, () => t.agent.fetch(t.seller.url)));
      for (const r of rs) await r.text();
      assert.deepEqual(rs.map((r) => r.status).filter((s) => s === 200), [], `statuses ${rs.map((r) => r.status)}`);
      assert.equal(t.facilitator.counts.settle, 0);
    } finally { await t.close(); }
  });
}

test('M1 resolver: a final verdict is not stored for a payment made after M1 was superseded (r3)', async () => {
  const MM1 = mandate({ total_cap: '1000000', per_payment_max: '50000', period_budget: '100000', nonce: '03'.repeat(16) });
  const MM2 = mandate({ total_cap: '990000', per_payment_max: '5000', period_budget: '100000', nonce: '04'.repeat(16) });
  const c = chainSim();
  const G1 = c.add('G1', grantAt(MM1, 1000)); const P1 = c.add('P1', payAt(1001, { amount: '10000' }));
  for (let i = 1; i <= 150; i++) c.add(`D${i}`, dustCredit(1001 + i));
  c.setAccount(SRC, live(MM1));
  const store = openStore();
  const svc = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  const rc = (tx, at) => receipt({ mandate_id: mandateId(MM1), grant_tx: G1, tx_sig: tx, settled_at: T0 + at });
  c.failPage = 2;
  await svc.dispute({ tx_sig: P1, mandate: MM1, grant_tx: G1, receipt: rc(P1, 1001) });
  c.failPage = null;
  c.add('G2', grantAt(MM2, 2000)); c.setAccount(SRC, live(MM2));
  const P2 = c.add('P2', payAt(2001, { amount: '10000' }));
  const v2 = await svc.dispute({ tx_sig: P2, mandate: MM1, grant_tx: G1, receipt: rc(P2, 2001) });
  assert.equal(v2.reason, 'mandate_superseded', JSON.stringify(v2)); assert.equal(v2.liable, null);
  assert.equal(store.count(), 0, 'nothing stored: the dispute can be resubmitted');
});

test('M1 (a): a non-null element that is not a jsonParsed transaction is unreadable, not "does not supersede"', async () => {
  for (const bad of [{}, { slot: 1050, blockTime: 1, meta: { err: null }, transaction: ['AQID', 'base64'] }, { slot: 1050, transaction: { message: { instructions: [] } } }]) {
    const { c, G1 } = chain();
    c.txs.find((t) => t.sig === sig('D7')).tx = bad; // the node lists D7 (it touches the account) but answers with something that is not a jsonParsed transaction
    c.setAccount(SRC, live(M1, { delegatedAmount: { amount: M1.total_cap } })); // the fake would otherwise derive the account from the malformed transaction
    await assert.rejects(() => scanSupersede(c, SRC, G1), /not a jsonParsed transaction/);
    const r = await createGrantChecker(c).check(M1, G1, { active: true });
    assert.equal(r.ok, false, `grant ok must not be true for ${JSON.stringify(bad).slice(0, 40)}`);
  }
});

test('M1 (b): a scan_state row that does not parse is treated as absent: the scan restarts from the grant and the gate recovers', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-corrupt-'));
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000', gateOpts: { dataDir } });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const ar = fakeRpc(); ar.grants = seller.rpc.grants; ar.account = seller.rpc.account;
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  try {
    const r0 = await a.fetch(seller.url); await r0.text(); assert.equal(r0.status, 200);
    const db = new DatabaseSync(path.join(dataDir, 'receipts.sqlite'));
    const row = db.prepare('SELECT key, json FROM scan_state').get();
    db.prepare('UPDATE scan_state SET json = ? WHERE key = ?').run(row.json.slice(0, 20), row.key); db.close();
    seller.restartGate();
    const r1 = await a.fetch(seller.url); const b = await r1.text();
    assert.equal(r1.status, 200, b);
  } finally { await a.close(); seller.close(); facilitator.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
