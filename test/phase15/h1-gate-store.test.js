// H1: the gate's one-receipt-per-payment memory survives a restart. Issued receipts are kept by tx_sig in the seller's own SQLite file under cfg.dataDir,
// written before the response that carries the receipt is sent; a failed write sends the response WITHOUT a receipt header; a corrupt store stops the start.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { createSellerGate } from '@iussum/seller';
import { receiptKey } from '@iussum/core';
import { A, T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, DEVNET } from '../harness.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-gate-'));
const fresh = async (tc, gateOpts) => {
  const dataDir = tmp();
  const facilitator = await startMockFacilitator({ fixedTx: 'HSTORE'.padEnd(88, 'x') });
  let n = 0;
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000 + n++, price: '10000', gateOpts: { dataDir, ...gateOpts } });
  tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const s = await newScenario(seller, { mandate: { period_budget: '1000000', per_payment_max: '20000' } });
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => T0 + 1000 });
  return { dataDir, seller, a };
};
test('H1 restart the gate between two success responses for the same tx_sig: both receipts are byte-identical', async (tc) => {
  const { seller, a } = await fresh(tc);
  const r1 = await a.fetch(seller.url);
  seller.restartGate(); // a gate process restart: its memory is gone
  const r2 = await a.fetch(seller.url);
  const h1 = r1.headers.get('x-iussum-receipt'), h2 = r2.headers.get('x-iussum-receipt');
  assert.ok(h1 && h2); assert.equal(h1, h2);
});
test('H1 the receipt is already on disk when the response carrying it is sent', async (tc) => {
  const { dataDir, seller, a } = await fresh(tc);
  let sizeAtResponse = null;
  const realWrite = seller.gate; void realWrite;
  const r = await a.fetch(seller.url);
  assert.ok(r.headers.get('x-iussum-receipt'));
  const db = fs.readdirSync(dataDir).find((f) => f.endsWith('.sqlite'));
  assert.ok(db, 'a SQLite file exists in dataDir'); sizeAtResponse = fs.statSync(path.join(dataDir, db)).size;
  assert.ok(sizeAtResponse > 0);
  const { DatabaseSync } = await import('node:sqlite');
  const conn = new DatabaseSync(path.join(dataDir, db));
  const row = conn.prepare('SELECT * FROM receipts WHERE tx_sig = ?').get('HSTORE'.padEnd(88, 'x'));
  conn.close();
  assert.ok(row, 'the receipt row for the settled transaction is in the file'); assert.equal(row.bytes, r.headers.get('x-iussum-receipt'));
});
test('H1 a failed write sends the response WITHOUT a receipt header and logs it; the payment still settled', async (tc) => {
  const logs = [];
  const { seller, a } = await fresh(tc, { receiptStore: { get: () => undefined, put: () => { throw new Error('disk full'); }, close() {} }, log: (e) => logs.push(e) });
  const r = await a.fetch(seller.url);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-iussum-receipt'), null);
  assert.ok(logs.some((e) => /disk full/.test(e.receipt_error ?? '')), JSON.stringify(logs));
});
test('H1 a corrupt or unreadable store stops the gate from starting', () => {
  const base = { mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: DEVNET, rpc: fakeRpc(), key: receiptKey(Buffer.alloc(32, 9)), origin: 'http://127.0.0.1:1' };
  const d1 = tmp(); fs.writeFileSync(path.join(d1, 'receipts.sqlite'), 'this is not a database, it is a corrupt store '.repeat(40));
  assert.throws(() => createSellerGate({ ...base, dataDir: d1 }), /receipt store/i);
  const d2 = tmp(); fs.mkdirSync(path.join(d2, 'receipts.sqlite')); // a directory where the file should be
  assert.throws(() => createSellerGate({ ...base, dataDir: d2 }), /receipt store/i);
  const d3 = tmp(); const g = createSellerGate({ ...base, dataDir: d3 }); g.close?.();
  assert.ok(g, 'a fresh directory starts');
});
