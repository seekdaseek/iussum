import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, parsePayment, receiptKey, signReceipt, verifyReceipt, createGrantChecker, mandateId, summaryLine, periodIndex, periodSpendAt, encodeReceipt, decodeReceipt, R } from '@iussum/core';
import fs from 'node:fs';

const dir = new URL('../../../test/vectors/', import.meta.url);
const recorded = (n) => JSON.parse(fs.readFileSync(new URL(`recorded/${n}.json`, dir), 'utf8')).result;

test('jcs refuses undefined, NaN, bigint', () => {
  assert.throws(() => canonicalize({ a: undefined }));
  assert.throws(() => canonicalize({ a: NaN }));
  assert.throws(() => canonicalize({ a: 1n }));
});
test('parsePayment reads the real recorded devnet settlement (5KsYz26T)', () => {
  const p = parsePayment(recorded('payment-5KsYz26T'));
  assert.equal(p.found, true); assert.equal(p.err, null);
  assert.equal(p.transfers.length, 1);
  assert.deepEqual({ ...p.transfers[0] }, { source: '6yhmERramYBiynohezgqDbGMHAf9peDDSDoykiu1wzLe', destination: 'GvDNmYMmCvnzhgZVZ1XGxWznCgL3BvpEJBPfTvjL1yps', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', authority: '4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi', amount: '10000', dest_owner: '5hQASoTWuCSjSz3GfUmrVDfUKEvRMDLpqUK1wuUi5Gk7' });
});
test('parsePayment of null is not found', () => assert.deepEqual(parsePayment(null), { found: false }));
test('real T1 grant (natX, v0.1 memo) parses: ApproveChecked + Memo + two ComputeBudget, natX sole signer', () => {
  const t = recorded('grant-T1-5gUy9rev');
  assert.equal(t.meta.err, null);
  assert.deepEqual(t.transaction.message.accountKeys.filter((k) => k.signer).map((k) => k.pubkey), ['ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX']);
  const progs = t.transaction.message.instructions.map((i) => i.programId.slice(0, 6));
  assert.deepEqual(progs, ['Tokenk', 'MemoSq', 'Comput', 'Comput']);
});
test('receipt keys are deterministic from a seed and signatures are deterministic', () => {
  const a = receiptKey(Buffer.alloc(32, 7)), b = receiptKey(Buffer.alloc(32, 7));
  assert.equal(a.publicKey, b.publicKey);
  const body = { v: 'iussum/0.2', x: 1 };
  assert.equal(signReceipt(body, a).signature, signReceipt(body, b).signature);
});
test('receipt header encoding round-trips', () => {
  const r = { a: 1, b: 'ö' };
  assert.deepEqual(decodeReceipt(encodeReceipt(r)), r);
});
test('grant checker caches the immutable part and always re-reads the live account', async () => {
  const fixtures = JSON.parse(fs.readFileSync(new URL('grant.json', dir), 'utf8'));
  const ok = fixtures.find((f) => f.name.startsWith('minimal grant'));
  let txCalls = 0, accCalls = 0;
  const rpc = { getTransaction: async () => { txCalls++; return ok.input.tx; }, getAccountInfoParsed: async () => { accCalls++; return { data: { parsed: { info: { owner: ok.input.mandate.principal, mint: ok.input.mandate.asset, delegate: ok.input.mandate.agent, delegatedAmount: { amount: '5' } } } } }; } };
  const c = createGrantChecker(rpc);
  const sig = 'x'.repeat(88);
  assert.equal((await c.check(ok.input.mandate, sig)).ok, true);
  assert.equal((await c.check(ok.input.mandate, sig)).ok, true);
  assert.equal(txCalls, 1); assert.equal(accCalls, 2);
  assert.equal((await c.check(ok.input.mandate, 'short')).reason, R.grant_not_found);
});
test('periodIndex anchors at not_before', () => {
  const m = { not_before: 1000, period_seconds: 100 };
  assert.equal(periodIndex(m, 1000), 0); assert.equal(periodIndex(m, 1099), 0); assert.equal(periodIndex(m, 1100), 1);
});
test('periodSpendAt on an unknown tx is not found', () => assert.equal(periodSpendAt({ not_before: 0, period_seconds: 10, period_budget: '1' }, [], 'z').found, false));
