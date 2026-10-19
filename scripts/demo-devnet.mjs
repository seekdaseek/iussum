// npm run demo:devnet : nine scenarios on devnet, real facilitator, real USDC, throw-away principal (no phone). Exit code 1 if any expectation fails.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createAgent, IussumRefusal } from '@iussum/agent';
import { createResolver, createResolverApp, openStore, makeRefundSender } from '@iussum/resolver';
import { createGrantChecker, mandateId, summaryLine, verifyReceipt, principalAta } from '@iussum/core';
import { loadKeys, makeCtx, sendGrant, sendRevoke, usdc, startDemoSeller, NETWORK, MINT, FACILITATOR, RPC_URL } from './demo-lib.mjs';

const ctx = makeCtx(), keys = await loadKeys();
const results = []; let current = '';
const say = (s = '') => console.log(s);
const step = (s) => say(`  - ${s}`);
function expect(label, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  results.push({ scenario: current, label, ok, actual, wanted });
  say(`    ${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : `  (expected ${JSON.stringify(wanted)})`}`);
  return ok;
}
const head = (n, t) => { current = `${n}. ${t}`; say(`\n=== Scenario ${current}`); };
const short = (s) => (s ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

say(`iussum demo, devnet. facilitator ${FACILITATOR}, rpc ${RPC_URL}`);
say(`principal ${keys.principal.address} (throw-away key, no phone)  agent ${keys.agent.address}`);
const now = () => Math.floor(Date.now() / 1000);
const sellers = {
  A: await startDemoSeller(ctx, { name: 'A', signer: keys.sellerA, mode: 'enforce' }),
  B: await startDemoSeller(ctx, { name: 'B', signer: keys.sellerB, mode: 'enforce' }),
  C: await startDemoSeller(ctx, { name: 'C', signer: keys.sellerC, mode: 'observe' }),
};
const sellerKeys = new Map();
for (const s of Object.values(sellers)) sellerKeys.set(s.address, (await (await fetch(`${s.origin}/.well-known/iussum.json`)).json()).seller);
const store = openStore(':memory:');
const refund = makeRefundSender({ rpc: ctx.rpc, float: keys.float });
let refundCount = 0;
const service = createResolver({ rpc: ctx.rpc, network: NETWORK, sellerKey: async (payTo) => sellerKeys.get(payTo) ?? null, store, sendRefund: async (r) => { refundCount++; return refund(r); }, now });
const rsrv = http.createServer(createResolverApp(service));
await new Promise((r) => rsrv.listen(0, '127.0.0.1', r));
const RESOLVER = `http://127.0.0.1:${rsrv.address().port}`;
say(`sellers: A ${sellers.A.address} (enforce)  B ${sellers.B.address} (enforce)  C ${sellers.C.address} (observe)   resolver ${RESOLVER}`);

async function newMandate(over = {}, allowSellers = ['A']) {
  const t = now();
  const m = { v: 'iussum/0.2', principal: keys.principal.address, agent: keys.agent.address, network: NETWORK, asset: MINT, total_cap: '1000000', per_payment_max: '50000', period_budget: '200000', period_seconds: 86400, allow: { pay_to: allowSellers.map((k) => sellers[k].address), resource_prefix: Object.values(sellers).map((s) => `${s.origin}/v1/`) }, not_before: t - 3600, expires_at: t + 86400, nonce: randomBytes(16).toString('hex'), ...over };
  const grant_tx = await sendGrant(ctx, keys, m);
  step(`grant (ApproveChecked ${m.total_cap} + Memo, principal only signer): ${grant_tx}`);
  step(`mandate id ${mandateId(m)}`);
  const g = await createGrantChecker(ctx.rpc).check(m, grant_tx, { active: true });
  expect('grant check on the real chain', g.ok, true);
  return { m, grant_tx };
}
const agentFor = ({ m, grant_tx }, o = {}) => createAgent({ mandate: m, grant_tx, signer: keys.agent, rpc: ctx.rpc, ...o });
async function dispute(bundle) {
  const r = await fetch(`${RESOLVER}/dispute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bundle) });
  return r.json();
}
const showVerdict = (v) => { if (v.error) step(`RESOLVER ERROR ${v.error}: ${v.message}`); step(`verdict: ${v.verdict} | reason ${v.reason} | liable ${v.liable} | time_source ${v.time_source}${v.refund_tx ? ` | refund_tx ${v.refund_tx}` : ''}`); for (const d of v.delta ?? []) step(`  delta ${d.code ?? d.field}: authorised ${d.authorized}, actual ${d.actual}`); if (v.missing) step(`  MISSING EVIDENCE: ${v.missing.join('; ')}`); };

async function s1() {
  head(1, 'in scope: 200 + receipt, dispute is invalid, the principal bears it (R1)');
  const g = await newMandate();
  const res = await (await agentFor(g)).fetch(sellers.A.url());
  expect('http status', res.status, 200);
  const r = res.receipt;
  expect('receipt verifies against seller A key', verifyReceipt(r, sellers.A.gate.publicKey).ok, true);
  expect('receipt binds mandate_id and grant_tx', [r.mandate_id === mandateId(g.m), r.grant_tx === g.grant_tx], [true, true]);
  step(`payment tx ${r.tx_sig}`);
  const v = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r }); showVerdict(v);
  expect('verdict', [v.verdict, v.reason, v.liable], ['invalid', 'in_scope', 'principal']);
  step(`human page: ${RESOLVER}/v/${r.tx_sig}`);
}
async function s2() {
  head(2, 'over the per-payment cap: the seller answers 403 and no money moves');
  const g = await newMandate();
  const a = await agentFor(g);
  try { await a.fetch(sellers.A.url('big')); expect('diligent agent refuses locally', 'paid', 'refused'); } catch (e) { expect('diligent agent refuses before signing', [e instanceof IussumRefusal, e.reason], [true, 'amount_over_cap']); }
  const before = [await usdc(ctx, keys.principal.address), await usdc(ctx, keys.sellerA.address)];
  const naive = await agentFor(g, { localChecks: false });
  const res = await naive.fetch(sellers.A.url('big'));
  const body = await res.json();
  step(`naive agent sends the 0.06 USDC payment anyway: HTTP ${res.status} ${JSON.stringify({ error: body.error, reason: body.reason })}`);
  expect('seller answer', [res.status, body.error, body.reason], [403, 'iussum_out_of_scope', 'amount_over_cap']);
  const after = [await usdc(ctx, keys.principal.address), await usdc(ctx, keys.sellerA.address)];
  expect('principal and seller balances unchanged on chain', after.map(String), before.map(String));
}
let s3Tx = null;
async function s3() {
  head(3, 'observe-mode seller settles an out-of-scope payment: dispute valid, SELLER liable, refund paid (R2)');
  const g = await newMandate({}, ['A']);
  const before = await usdc(ctx, keys.principal.address);
  const res = await (await agentFor(g, { localChecks: false })).fetch(sellers.C.url());
  expect('seller C (observe) settles although C is not on the list', res.status, 200);
  const r = res.receipt; s3Tx = { tx: r.tx_sig, g, r };
  expect('receipt shows the mandate was presented', r.mandate_id === mandateId(g.m), true);
  step(`payment tx ${r.tx_sig}`);
  const mid = await usdc(ctx, keys.principal.address);
  const v = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r }); showVerdict(v);
  expect('verdict', [v.verdict, v.reason, v.liable], ['valid', 'pay_to_not_allowed', 'seller']);
  step(`refund tx printed: ${v.refund_tx}`);
  const after = await usdc(ctx, keys.principal.address);
  expect('principal paid 0.01 then got 0.01 back (on chain)', [String(before - mid), String(after - mid)], ['10000', '10000']);
}
async function s4() {
  head(4, 'payment without a mandate: dispute valid, AGENT OPERATOR liable (R3)');
  const g = await newMandate({}, ['A']);
  const res = await (await agentFor(g, { localChecks: false, attachMandate: false })).fetch(sellers.C.url());
  expect('seller C (observe) settles', res.status, 200);
  const r = res.receipt;
  expect('receipt says no mandate was presented', [r.mandate_id, r.grant_tx], [null, null]);
  step(`payment tx ${r.tx_sig}`);
  const v = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r }); showVerdict(v);
  expect('verdict', [v.verdict, v.reason, v.liable], ['valid', 'pay_to_not_allowed', 'agent_operator']);
  expect('no refund from the seller', v.refund_tx ?? null, null);
}
async function s5() {
  head(5, 'tampered receipt: rejected, liable null (R4)');
  const g = await newMandate();
  const res = await (await agentFor(g)).fetch(sellers.A.url());
  expect('payment settles', res.status, 200);
  const r = { ...res.receipt, amount: '1' };
  step(`receipt amount edited after signing: ${res.receipt.amount} -> 1`);
  const v = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r }); showVerdict(v);
  expect('verdict', [v.verdict, v.reason, v.liable], ['invalid', 'signature_invalid', null]);
}
async function s6() {
  head(6, 'revoked grant: seller answers 403 grant_inactive; without the seller check the facilitator fails the payment');
  const g = await newMandate();
  const revoke = await sendRevoke(ctx, keys);
  step(`Revoke (principal): ${revoke}`);
  const naive = await agentFor(g, { localChecks: false });
  const res = await naive.fetch(sellers.A.url());
  const body = await res.json();
  step(`enforce seller A: HTTP ${res.status} ${JSON.stringify({ reason: body.reason })}`);
  expect('seller A (enforce) answer', [res.status, body.reason], [403, 'grant_inactive']);
  sellers.A.gate.setMode('off');
  const res2 = await naive.fetch(sellers.A.url());
  const pr = res2.headers.get('payment-required');
  const why = pr ? JSON.parse(Buffer.from(pr, 'base64').toString()).error : `HTTP ${res2.status}`;
  step(`seller A with iussum off, same payment: HTTP ${res2.status}, facilitator says: ${why}`);
  expect('without the seller check the payment fails at the facilitator', [res2.status, /simulation_failed|insufficient|owner|delegate/i.test(why)], [402, true]);
  sellers.A.gate.setMode('enforce');
  try { await (await agentFor(g)).fetch(sellers.A.url()); expect('diligent agent refuses', 'paid', 'refused'); } catch (e) { expect('a diligent agent refuses locally too', [e instanceof IussumRefusal, e.reason], [true, 'grant_inactive']); }
}
async function s7() {
  head(7, 'CONTROL: payer-side caps only, no seller check. Same wallet, same on-chain cap.');
  const g = await newMandate({}, ['A']);
  sellers.C.gate.setMode('off');
  const res = await (await agentFor(g, { localChecks: 'caps' })).fetch(sellers.C.url());
  step('agent enforces the amount cap and the period budget (what Squads-style caps give), checks no seller list, attaches nothing; seller C does not check');
  expect('under-cap payment to a seller NOT on the list succeeds', [res.status, res.receipt], [200, null]);
  const pr = res.headers.get('payment-response');
  const tx = JSON.parse(Buffer.from(pr, 'base64').toString()).transaction;
  step(`payment tx ${tx} (no receipt exists: the seller signed nothing)`);
  const v = await dispute({ tx_sig: tx, mandate: g.m, grant_tx: g.grant_tx, receipt: null }); showVerdict(v);
  expect('the resolver cannot assign liability', [v.verdict, v.reason, v.liable], ['invalid', 'receipt_missing', null]);
  step('what is missing, exactly: the seller receipt, i.e. any signed proof of what the seller was shown. The on-chain cap bounds the loss (<= 1.00 USDC) but nobody can show whether the seller saw the limits, so no one can be held liable.');
  sellers.C.gate.setMode('observe');
}
async function s8() {
  head(8, 'repeat dispute of the scenario 3 payment: stored verdict, duplicate_dispute, no second refund');
  const before = [refundCount, await usdc(ctx, keys.float.address)];
  const v = await dispute({ tx_sig: s3Tx.tx, mandate: s3Tx.g.m, grant_tx: s3Tx.g.grant_tx, receipt: s3Tx.r }); showVerdict(v);
  expect('verdict', [v.reason, v.original_reason, v.liable, v.duplicate], ['duplicate_dispute', 'pay_to_not_allowed', 'seller', true]);
  expect('no second refund transaction', [refundCount, String(await usdc(ctx, keys.float.address))], [before[0], String(before[1])]);
}
async function s9() {
  head(9, 'period overrun split across two sellers: the crossing payment is the AGENT OPERATOR\'s (period_over_budget)');
  const g = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A', 'B']);
  const naive = await agentFor(g, { localChecks: false });
  const r1 = await naive.fetch(sellers.A.url('mid')); expect('payment 1 (seller A, 0.02) settles', r1.status, 200);
  const r2 = await naive.fetch(sellers.B.url('mid')); expect('payment 2 (seller B, 0.02) settles: B cannot see A\'s payment', r2.status, 200);
  step(`payment 1 ${r1.receipt.tx_sig}\n    payment 2 ${r2.receipt.tx_sig}`);
  const v1 = await dispute({ tx_sig: r1.receipt.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r1.receipt });
  expect('payment 1 is inside the budget', [v1.reason, v1.liable], ['in_scope', 'principal']);
  const v2 = await dispute({ tx_sig: r2.receipt.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r2.receipt }); showVerdict(v2);
  expect('payment 2 crossed the 0.03 budget', [v2.verdict, v2.reason, v2.liable], ['valid', 'period_over_budget', 'agent_operator']);
  // 9b: the same two sellers, but a diligent agent that keeps its own period ledger
  const g2 = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A', 'B']);
  const diligent = await agentFor(g2);
  const d1 = await diligent.fetch(sellers.A.url('mid')); expect('9b: diligent agent pays 0.02 to seller A', d1.status, 200);
  try { await diligent.fetch(sellers.B.url('mid')); expect('9b: diligent agent refuses the second payment', 'paid', 'refused'); }
  catch (e) { expect('9b: the agent refuses the payment that would cross the budget, before signing', [e instanceof IussumRefusal, e.reason], [true, 'period_over_budget']); }
}

const scenarios = [s1, s2, s3, s4, s5, s6, s7, s8, s9];
for (const f of scenarios) { try { await f(); } catch (e) { results.push({ scenario: current, label: 'scenario threw', ok: false, actual: String(e.stack ?? e) }); say(`    FAIL scenario threw: ${e.stack ?? e}`); } }
say('\n=== Summary');
for (const sc of [...new Set(results.map((r) => r.scenario))]) { const rs = results.filter((r) => r.scenario === sc); say(`${rs.every((r) => r.ok) ? 'PASS' : 'FAIL'}  ${sc}  (${rs.filter((r) => r.ok).length}/${rs.length} checks)`); }
const failed = results.filter((r) => !r.ok).length;
say(`${results.length - failed}/${results.length} checks passed`);
for (const s of Object.values(sellers)) s.close();
rsrv.close(); store.close();
process.exit(failed ? 1 : 0);
