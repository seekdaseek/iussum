// Runs every golden vector in test/vectors/*.json against the real code. Expectations were written by hand in test/make-vectors.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resourceAllowed, canonicalize, mandateId, summaryLine, validateMandate, scopeViolations, inspectGrantTx, inspectGrantActive, verifyReceipt, resolve, parsePayment } from '@iussum/core';

const DIR = new URL('../../../test/vectors/', import.meta.url);
const load = (n) => JSON.parse(fs.readFileSync(new URL(`${n}.json`, DIR), 'utf8'));
const recorded = JSON.parse(fs.readFileSync(new URL('recorded/payment-5KsYz26T.json', DIR), 'utf8')).result;

async function toEvidence(i) {
  const e = { ...i };
  if (e.payment === 'RECORDED') e.payment = parsePayment(recorded);
  else if (e.payment && e.payment.transaction) e.payment = parsePayment(e.payment);
  e.grant = e.grant_tx_parsed !== undefined && validateMandate(e.mandate ?? {}).length === 0 ? await inspectGrantTx(e.grant_tx_parsed, e.mandate) : null;
  return e;
}
function checkResolve(v, got) {
  const x = v.expect;
  assert.equal(got.verdict, x.verdict, `verdict ${JSON.stringify(got)}`);
  assert.equal(got.reason, x.reason, `reason ${JSON.stringify(got)}`);
  assert.equal(got.liable, x.liable, `liable ${JSON.stringify(got)}`);
  if (x.time_source) assert.equal(got.time_source, x.time_source);
  if (x.deltaCodes) assert.deepEqual(got.delta.map((d) => d.code).sort(), [...x.deltaCodes].sort());
  if (x.deltaFields) assert.deepEqual(got.delta.map((d) => d.field).sort(), [...x.deltaFields].sort());
  if (x.missing) assert.deepEqual(got.missing, x.missing);
  if (x.unjudged) assert.deepEqual(got.unjudged, x.unjudged); else assert.equal(got.unjudged, undefined, 'nothing is unjudged when the receipt and the block time exist');
}

for (const v of load('jcs')) test(`jcs: ${v.name}`, () => assert.equal(canonicalize(v.input), v.expect));
for (const v of load('mandate')) test(`mandate: ${v.name}`, () => {
  if (v.kind === 'mandate-id') { assert.equal(canonicalize(v.input), v.expect.jcs); assert.equal(mandateId(v.input), v.expect.id); }
  else if (v.kind === 'summary') { const s = summaryLine(v.input); assert.equal(s, v.expect); assert.match(s, / id [0-9a-f]{64}$/); assert.ok(s.endsWith(mandateId(v.input))); }
  else assert.deepEqual(validateMandate(v.input), v.expect);
});
for (const v of load('resource')) test(`resource: ${v.name}`, () => assert.equal(resourceAllowed(v.input.prefixes, v.input.resource), v.expect));
for (const v of load('scope')) test(`scope: ${v.name}`, () => assert.deepEqual(scopeViolations(v.input.mandate, v.input.payment).map((d) => d.code), v.expect));
for (const v of load('grant')) test(`grant: ${v.name}`, async () => {
  const r = await inspectGrantTx(v.input.tx, v.input.mandate);
  assert.equal(r.ok, v.expect.ok, JSON.stringify(r));
  if (!v.expect.ok) { assert.equal(r.reason, v.expect.reason); if (v.expect.detailIncludes) assert.ok(r.detail.includes(v.expect.detailIncludes), `detail "${r.detail}" should include "${v.expect.detailIncludes}"`); }
});
for (const v of load('active')) test(`grant active: ${v.name}`, () => { const r = inspectGrantActive(v.input.account, v.input.mandate); assert.equal(r.ok, v.expect.ok); if (!v.expect.ok) assert.equal(r.reason, v.expect.reason); });
for (const v of load('receipt')) test(`receipt: ${v.name}`, () => assert.equal(verifyReceipt(v.input.receipt, v.input.pubkey).ok, v.expect.ok));
for (const v of [...load('resolve'), ...load('period')]) test(`resolve: ${v.name}`, async () => checkResolve(v, resolve(await toEvidence(v.input))));
