// M8 (Addendum M): Retry-After is honoured only when it says when (whole seconds, or a future HTTP-date); the reservations file is made durable with a directory
// fsync after the rename (a power loss right after a payload leaves must not lose the reservation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
const out = async (p) => { try { return (await p).status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 60)}`; } };

const cases = [
  ['no Retry-After header', null, 1], ['an empty Retry-After', '', 1], ['Retry-After: -1', '-1', 1], ['Retry-After: 0.2 (not whole seconds)', '0.2', 1], ['Retry-After: 1e9', '1e9', 1], ['garbage', 'soon', 1],
  ['Retry-After: 1 (whole seconds)', '1', 4], ['Retry-After: 0', '0', 4], ['Retry-After: 99999999 (capped by maxWaitMs)', '99999999', 4], ['Retry-After: an HTTP-date 1 s ahead', 'date', 4], ['Retry-After: an HTTP-date in the past', 'past', 1],
];
test('M8 a 503 is retried only when Retry-After is whole seconds or a future HTTP-date; otherwise the paid request is sent once (retry-after)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '100' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '1000' } });
  seller.rpc.call = async (m) => { if (m === 'isBlockhashValid') return { context: { slot: 11 }, value: true }; if (m === 'getBlockHeight') return 50; throw new Error(m); };
  const result = {};
  for (const [label, header, want] of cases) {
    let sends = 0; const payloads = new Set();
    globalThis.fetch = async (req) => {
      const ps = req.headers.get('payment-signature'); if (!ps) return realFetch(req);
      sends++; payloads.add(ps);
      const h = header === null ? {} : { 'retry-after': header === 'date' ? new Date(Date.now() + 1000).toUTCString() : header === 'past' ? new Date(Date.now() - 60_000).toUTCString() : header };
      return new Response('{"error":"busy"}', { status: 503, headers: h });
    };
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, retry: { max: 3, maxWaitMs: 150 } });
    globalThis.fetch = realFetch;
    assert.equal(await out(a.fetch(seller.url)), 503);
    result[label] = [sends, payloads.size];
    assert.equal(sends, want, `${label}: ${sends} paid sends, wanted ${want}`);
    assert.equal(payloads.size, 1, 'the SAME payload every time');
    await a.close();
  }
  facilitator.close(); seller.close();
});

test('M8 the reservations file is fsynced, then its directory after the rename (fsync-trace)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: '100' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '1000' } });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm8-fsync-'));
  globalThis.fetch = async (req) => (req.headers.get('payment-signature') ? new Response('{}', { status: 502 }) : realFetch(req));
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW, dataDir });
  globalThis.fetch = realFetch;
  const events = []; const fdPath = new Map();
  const oOpen = fs.openSync, oSync = fs.fsyncSync, oRename = fs.renameSync;
  fs.openSync = (p, ...x) => { const fd = oOpen(p, ...x); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => { events.push(['fsync', fdPath.get(fd) ?? fd]); return oSync(fd); };
  fs.renameSync = (a2, b) => { events.push(['rename', String(b)]); return oRename(a2, b); };
  try { await out(a.fetch(seller.url)); } finally { fs.openSync = oOpen; fs.fsyncSync = oSync; fs.renameSync = oRename; }
  const iRes = events.findIndex((e) => e[0] === 'rename' && e[1].endsWith('.reservations.json'));
  assert.ok(iRes >= 0, JSON.stringify(events));
  assert.ok(events.slice(iRes + 1).some((e) => e[0] === 'fsync' && e[1] === dataDir), `the directory ${dataDir} is fsynced after the rename: ${JSON.stringify(events.slice(iRes))}`);
  await a.close(); facilitator.close(); seller.close(); fs.rmSync(dataDir, { recursive: true, force: true });
});
