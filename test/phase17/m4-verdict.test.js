// M4 (Addendum M): verdict_id must be what an auditor can recompute. The sixth review's repros: an unchecked grant_tx in the equivocation path (l2-eq-http),
// legacy rows without a stored id (mig-old / mig-new), recomputability from a response alone (l2-audit), two services on one store (l2-two-instances).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalize, mandateId } from '@iussum/core';
import { createResolver, createResolverApp, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from '../phase12/helpers.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const M = mandate({ nonce: '2d'.repeat(16) });
const G = sig('G'), P1 = sig('P1'), P2 = sig('P2'), P3 = sig('P3');
const chain = () => { const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P1', payAt(1100)); c.add('P2', payAt(1200)); c.add('P3', payAt(1300)); c.setAccount(SRC, live(M)); return c; };
const at = { [P1]: 1100, [P2]: 1200, [P3]: 1300 };
const rcpt = (tx, ro = {}) => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: tx, amount: '10000', settled_at: T0 + at[tx], ...ro });
const bundle = (tx, r) => ({ tx_sig: tx, mandate: M, grant_tx: G, receipt: r });
const BAD = 'https://not-allowed.example/x';
const wire = (x) => JSON.parse(JSON.stringify(x)); // what an HTTP client sees
// the documented recipe, applied by a third party to a record
const idOf = (rec) => sha(canonicalize(rec));
const receiptHash = (r) => sha(canonicalize(r));

async function serve(svc) {
  const srv = http.createServer(createResolverApp(svc)); await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, close: () => srv.close(), post: async (b) => { const r = await fetch(`${base}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; }, page: async (tx) => (await fetch(`${base}/v/${tx}`)).text() };
}

test('M4 (a) a second filer\'s grant_tx never enters the record of a receipt-equivocation verdict (l2-eq-http)', async () => {
  for (const bad of ['not-a-signature', 12345678901234567890, { a: 1 }, null]) {
    const { svc, store } = service(chain(), { store: openStore() });
    const web = await serve(svc);
    try {
      const first = await web.post(bundle(P2, rcpt(P2, { settled_at: T0 + 1201 })));
      assert.equal(first.body.reason, 'in_scope');
      const eq = await web.post({ tx_sig: P2, mandate: M, grant_tx: bad, receipt: rcpt(P2, { resource: BAD }) });
      if (typeof bad !== 'string' && bad !== null) { assert.equal(eq.status, 400, `a ${typeof bad} grant_tx is a bad request`); continue; }
      assert.equal(eq.body.reason, 'receipt_equivocation', JSON.stringify(eq.body));
      const row = store.get(P2);
      assert.equal(row.grant_tx, G, 'the verified grant stays in the record');
      assert.equal(idOf(wire(eq.body.record)), eq.body.verdict_id);
      assert.equal(eq.body.record.grant_tx, G);
    } finally { web.close(); }
  }
});

test('M4 (b) a legacy row (stored before L2, no verdict_id column value) shows its computed id on /v/:tx, the one /dispute returns; the id hashes grant_tx null', async () => {
  const file = `${process.env.TMPDIR ?? '/tmp'}/m4-legacy-${process.pid}.sqlite`;
  const store = openStore(file);
  const { svc } = service(chain(), { store });
  const v = await svc.dispute(bundle(P3, rcpt(P3, { resource: BAD })));
  store.close();
  const db = new DatabaseSync(file); db.prepare('UPDATE verdicts SET verdict_id = NULL, grant_tx = NULL WHERE tx_sig = ?').run(P3); db.close(); // what 142276f left
  const store2 = openStore(file);
  const svc2 = service(chain(), { store: store2 }).svc;
  const web = await serve(svc2);
  try {
    const dup = await web.post(bundle(P3, rcpt(P3, { resource: BAD })));
    assert.equal(dup.body.reason, 'duplicate_dispute');
    const page = await web.page(P3);
    const line = page.split('\n').find((l) => l.startsWith('Verdict id:'));
    assert.ok(line && line.includes(dup.body.verdict_id), `${line}`);
    assert.equal(dup.body.record.grant_tx, null, 'a legacy row hashes grant_tx null');
    assert.equal(idOf(wire(dup.body.record)), dup.body.verdict_id);
    assert.notEqual(dup.body.verdict_id, v.verdict_id, 'and so differs from what the same dispute gets on a fresh store');
  } finally { web.close(); store2.close(); }
});

test('M4 (c) a third party recomputes verdict_id from a response alone: fresh, duplicate, /v/:tx and every replaced entry', async () => {
  const { svc } = service(chain(), { store: openStore() });
  const web = await serve(svc);
  try {
    const r = rcpt(P3, { resource: BAD });
    const first = (await web.post(bundle(P3, r))).body;
    assert.equal(idOf(first.record), first.verdict_id);
    assert.equal(first.record.receipt_sha256, receiptHash(r), 'the receipt hash recipe: sha256 hex of the JCS of the whole receipt, signature included');
    assert.equal(first.record.grant_tx, G); assert.equal(first.record.tx_sig, P3);
    // a duplicate filed by someone with other evidence: the record is the STORED one, not rebuilt from what the second filer sent
    for (const b of [bundle(P3, null), { ...bundle(P3, r), grant_tx: null }]) {
      const d = (await web.post(b)).body;
      assert.equal(d.reason, 'duplicate_dispute'); assert.equal(d.verdict_id, first.verdict_id);
      assert.deepEqual(d.record, first.record); assert.equal(idOf(d.record), d.verdict_id);
    }
    const page = await web.page(P3);
    const rec = page.split('\n').find((l) => l.startsWith('Record:'));
    assert.ok(rec, page); assert.equal(idOf(JSON.parse(rec.slice('Record:'.length).trim())), first.verdict_id);
    // a replaced verdict: provisional, then final, then equivocation; every kept id recomputes from its entry
    await web.post(bundle(P1, null));
    const fin = (await web.post(bundle(P1, rcpt(P1, { resource: BAD })))).body;
    const e = fin.replaced[0];
    assert.equal(e.grant_tx, G); assert.equal(e.provisional, true);
    const old = { tx_sig: P1, mandate_id: e.verdict.mandate_id ?? null, grant_tx: e.grant_tx, receipt_sha256: e.receipt_sha ?? null, verdict: e.verdict.verdict, reason: e.verdict.reason, liable: e.verdict.liable, delta: e.verdict.delta ?? [], unjudged: e.verdict.unjudged ?? [], provisional: e.provisional };
    assert.equal(idOf(old), e.verdict_id);
    await web.post(bundle(P2, rcpt(P2, { settled_at: T0 + 1201 })));
    const eq = (await web.post(bundle(P2, rcpt(P2, { resource: BAD })))).body;
    assert.equal(eq.reason, 'receipt_equivocation'); assert.equal(idOf(eq.record), eq.verdict_id);
    const e2 = eq.replaced.at(-1);
    assert.equal(idOf({ tx_sig: P2, mandate_id: e2.verdict.mandate_id ?? null, grant_tx: e2.grant_tx, receipt_sha256: e2.receipt_sha ?? null, verdict: e2.verdict.verdict, reason: e2.verdict.reason, liable: e2.verdict.liable, delta: e2.verdict.delta ?? [], unjudged: e2.verdict.unjudged ?? [], provisional: e2.provisional }), e2.verdict_id);
  } finally { web.close(); }
});

test('M4 (d) two services on one store: a replaced[] entry pairs a verdict with its own id, and an id a response returned is kept in the record (l2-two-instances)', async () => {
  const store = openStore();
  let release; const gate = new Promise((r) => (release = r));
  const mk = (sellerKey) => createResolver({ rpc: chain(), network: A.net, sellerKey, store, now: () => T0 + 9999 });
  const fast = mk(async () => SELLER_KEY.publicKey);
  let n = 0; const slow = mk(async () => { if (n++ === 0) await gate; return SELLER_KEY.publicKey; }); // pauses inside equivocatesWith, after it read the row
  const x = await fast.dispute(bundle(P2, rcpt(P2, { settled_at: T0 + 1201 })));
  const pa = slow.dispute(bundle(P2, rcpt(P2, { resource: BAD })));
  await new Promise((r) => setTimeout(r, 50));
  const b = await fast.dispute(bundle(P2, rcpt(P2, { resource: 'https://not-allowed.example/y' })));
  release(); const a = await pa;
  const row = store.get(P2);
  const kept = [row.verdict_id, ...row.replaced.map((e) => e.verdict_id)];
  assert.equal(b.reason, 'receipt_equivocation');
  for (const [name, resp] of [['X', x], ['B', b]]) assert.ok(kept.includes(resp.verdict_id), `${name}'s id ${resp.verdict_id.slice(0, 8)} is kept in the record`);
  for (const e of row.replaced) assert.equal(idOf({ tx_sig: P2, mandate_id: e.verdict.mandate_id ?? null, grant_tx: e.grant_tx ?? null, receipt_sha256: e.receipt_sha ?? null, verdict: e.verdict.verdict, reason: e.verdict.reason, liable: e.verdict.liable, delta: e.verdict.delta ?? [], unjudged: e.verdict.unjudged ?? [], provisional: e.provisional ?? false }), e.verdict_id, 'each replaced entry pairs its verdict with its own id');
  assert.equal(a.reason, 'duplicate_dispute', 'the loser of the race goes to the duplicate path and returns the stored id');
  assert.equal(a.verdict_id, row.verdict_id);
});
