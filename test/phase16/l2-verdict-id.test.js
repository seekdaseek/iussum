// L2 (Addendum L): every stored verdict has a verdict_id, the hex sha256 of the RFC 8785 JCS of the stored record. It is returned by /dispute and
// by a duplicate, shown on /v/:tx, and a replaced verdict (provisional or equivocation) gets a new id while the old id stays beside the replaced verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import * as core from '@iussum/core';
import { createResolverApp } from '@iussum/resolver';
import { T0, SRC, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { service } from '../phase12/helpers.mjs';

const { mandateId, canonicalize } = core;
const M = mandate({ nonce: '1d'.repeat(16) });
const G = sig('G'), P = sig('P');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// the record, built here from the stored fields exactly as the brief lists them (not through the code under test)
const recordOf = (v, receiptObj, grant_tx, provisional) => ({ tx_sig: P, mandate_id: v.mandate_id ?? null, grant_tx: grant_tx ?? null, receipt_sha256: receiptObj ? sha(canonicalize(receiptObj)) : null,
  verdict: v.verdict, reason: v.reason, liable: v.liable, delta: v.delta ?? [], unjudged: v.unjudged ?? [], provisional });
function build(amount = '10000') {
  const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P', payAt(1100, { amount })); c.setAccount(SRC, live(M));
  const refunds = [];
  const sendRefund = async (p, { onSigned }) => { const s = 'R'.repeat(88); await onSigned(s); refunds.push(p); return s; };
  return { ...service(c, { sendRefund }), refunds };
}
const rcpt = (ro = {}, amount = '10000') => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: P, amount, settled_at: T0 + 1100, ...ro });
const bundle = (r) => ({ tx_sig: P, mandate: M, grant_tx: G, receipt: r });

test('L2 golden vectors: a fixed record gives a fixed verdict_id (expected values computed outside this code base, sorted-key JSON + sha256)', () => {
  assert.equal(typeof core.verdictId, 'function'); assert.equal(typeof core.verdictRecord, 'function');
  const rec = { tx_sig: '3xTestSigGolden', mandate_id: 'mnd_golden', grant_tx: 'GrantSigGolden', receipt_sha256: 'ab'.repeat(32), verdict: 'valid', reason: 'pay_to_not_allowed', liable: 'seller',
    delta: [{ field: 'pay_to', authorized: 'A', actual: 'B' }], unjudged: ['resource'], provisional: false };
  assert.equal(core.verdictId(rec), '014c6ef269b09f238dffb0849dd0facc44b40ff42cf419a66e9a0359c8b63e17');
  assert.equal(core.verdictId({ ...rec, receipt_sha256: null, provisional: true, unjudged: [], delta: [] }), '3b3408ef8f04edad5e652cbd40175fea7ddded870959d84f7dff3eecd2cedc33');
  assert.notEqual(core.verdictId({ ...rec, liable: 'agent_operator' }), core.verdictId(rec), 'every field is covered');
  assert.notEqual(core.verdictId({ ...rec, provisional: true }), core.verdictId(rec));
});
test('L2 /dispute returns the verdict_id of the stored record, and a duplicate returns the same id', async () => {
  const t = build(), r = rcpt({ resource: 'https://not-allowed.example/x' });
  const first = await t.svc.dispute(bundle(r));
  assert.equal(first.reason, 'resource_not_allowed', JSON.stringify(first));
  const want = sha(canonicalize(recordOf(first, r, G, false)));
  assert.equal(first.verdict_id, want);
  assert.equal(t.store.get(P).verdict_id, want, 'the id is stored with the verdict');
  const dup = await t.svc.dispute(bundle(r));
  assert.equal(dup.reason, 'duplicate_dispute'); assert.equal(dup.verdict_id, want);
});
test('L2 a rejected dispute stores nothing and has no verdict_id', async () => {
  const t = build();
  const bad = await t.svc.dispute(bundle({ ...rcpt(), amount: '1' }));
  assert.equal(bad.liable, null); assert.equal(bad.verdict_id, undefined); assert.equal(t.store.count(), 0);
});
test('L2 /v/:tx shows the verdict_id', async () => {
  const t = build(), r = rcpt({ resource: 'https://not-allowed.example/x' });
  const first = await t.svc.dispute(bundle(r));
  const app = createResolverApp(t.svc), srv = http.createServer(app); await new Promise((ok) => srv.listen(0, ok));
  try {
    const page = await (await fetch(`http://127.0.0.1:${srv.address().port}/v/${P}`)).text();
    assert.ok(page.includes(`Verdict id:`) && page.includes(first.verdict_id), page);
  } finally { srv.close(); }
});
test('L2 a provisional verdict replaced by one with a receipt gets a new id; the record keeps the old id beside the replaced verdict', async () => {
  const t = build(), r = rcpt({ resource: 'https://not-allowed.example/x' });
  const prov = await t.svc.dispute(bundle(null));
  assert.equal(prov.provisional, true, JSON.stringify(prov));
  assert.equal(prov.verdict_id, sha(canonicalize(recordOf(prov, null, G, true))));
  const fin = await t.svc.dispute(bundle(r));
  assert.equal(fin.provisional, false); assert.equal(fin.reason, 'resource_not_allowed');
  assert.notEqual(fin.verdict_id, prov.verdict_id);
  assert.equal(fin.verdict_id, sha(canonicalize(recordOf(fin, r, G, false))));
  assert.equal(fin.replaced[0].verdict_id, prov.verdict_id, 'the old id stays beside the replaced verdict');
  assert.equal((await t.svc.dispute(bundle(r))).verdict_id, fin.verdict_id);
});
test('L2 receipt equivocation replaces the verdict with a new id and keeps the old one beside it', async () => {
  const t = build();
  const genuine = rcpt({ resource: 'https://not-allowed.example/x' }), forged = rcpt({ settled_at: T0 + 1101 });
  const v1 = await t.svc.dispute(bundle(forged));
  const v2 = await t.svc.dispute(bundle(genuine));
  assert.equal(v2.reason, 'receipt_equivocation', JSON.stringify(v2));
  assert.notEqual(v2.verdict_id, v1.verdict_id); assert.ok(v1.verdict_id);
  assert.equal(v2.verdict_id, sha(canonicalize(recordOf(v2, genuine, G, false))));
  assert.equal(v2.replaced.at(-1).verdict_id, v1.verdict_id);
});
