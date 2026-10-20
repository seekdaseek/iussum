// npm run demo:devnet : fifteen scenarios on devnet, real facilitator, real USDC, throw-away principal (no phone). Exit code 1 if any expectation fails.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAgent, IussumRefusal } from '@iussum/agent';
import { createResolver, createResolverApp, openStore, makeRefundSender } from '@iussum/resolver';
import { createGrantChecker, mandateId, summaryLine, verifyReceipt, principalAta } from '@iussum/core';
import { loadKeys, makeCtx, sendGrant, sendRevoke, sendPlainTransfer, usdc, sleep, startDemoSeller, NETWORK, MINT, FACILITATOR, RPC_URL } from './demo-lib.mjs';

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
  head(7, 'CONTROL: payer-side caps only, no seller check: the chain alone decides, the seller is not liable, the resource is unjudged');
  const g = await newMandate({}, ['A']);
  sellers.C.gate.setMode('off');
  const res = await (await agentFor(g, { localChecks: 'caps' })).fetch(sellers.C.url());
  step('agent enforces the amount cap and the period budget (what Squads-style caps give), checks no seller list, attaches nothing; seller C does not check');
  expect('under-cap payment to a seller NOT on the list succeeds', [res.status, res.receipt], [200, null]);
  const pr = res.headers.get('payment-response');
  const tx = JSON.parse(Buffer.from(pr, 'base64').toString()).transaction;
  step(`payment tx ${tx} (no receipt exists: the seller signed nothing)`);
  const v = await dispute({ tx_sig: tx, mandate: g.m, grant_tx: g.grant_tx, receipt: null }); showVerdict(v);
  expect('the chain alone proves the payer went outside the mandate: agent operator liable (R3), resource unjudged', [v.verdict, v.reason, v.liable, v.unjudged, v.refund_tx ?? null], ['valid', 'pay_to_not_allowed', 'agent_operator', ['resource'], null]);
  step('what the control cannot do: hold the SELLER liable. It signed nothing, so nobody can show it was shown the limits (no refund from it), and what it was asked for (the resource) is not on chain. The on-chain cap (<= 1.00 USDC) bounds the loss; the agent operator pays.');
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

async function s10() {
  head(10, 'a narrower re-grant supersedes the old mandate: the old one is refused, the seller cannot pick it in a dispute');
  const g1 = await newMandate({}, ['A', 'C']);                                   // M1: broad, allows seller C
  const g2 = await newMandate({ total_cap: '500000', per_payment_max: '20000' }, ['A']); // M2: narrower, same agent; this ApproveChecked replaces M1's
  const stale = await (await agentFor(g1, { localChecks: false })).fetch(sellers.A.url());
  const body = await stale.json();
  step(`agent still carrying M1 at seller A (enforce): HTTP ${stale.status} ${body.reason}: ${body.delta?.[0]?.actual}`);
  expect('M1 is no longer current', [stale.status, body.reason, /^superseded by /.test(body.delta?.[0]?.actual ?? '')], [403, 'grant_inactive', true]);
  const ok = await (await agentFor(g2, { localChecks: false })).fetch(sellers.A.url());
  expect('M2 (current) is accepted at seller A', ok.status, 200);
  const paid = await (await agentFor(g2, { localChecks: false })).fetch(sellers.C.url());
  expect('observe-mode seller C settles an out-of-scope payment under M2 (C saw M2)', [paid.status, paid.receipt.mandate_id === mandateId(g2.m)], [200, true]);
  const r = paid.receipt;
  step(`payment tx ${r.tx_sig}`);
  const mine = await dispute({ tx_sig: r.tx_sig, mandate: g1.m, grant_tx: g1.grant_tx, receipt: r }); showVerdict(mine);
  expect('a dispute carrying the OLDER, broader mandate M1 is rejected (the disputer does not choose the mandate)', [mine.reason, mine.liable], ['mandate_mismatch', null]);
  const good = await dispute({ tx_sig: r.tx_sig, mandate: g2.m, grant_tx: g2.grant_tx, receipt: r }); showVerdict(good);
  expect('the principal\'s dispute with M2 is judged, not a duplicate: seller C liable, refunded', [good.verdict, good.reason, good.liable, !!good.refund_tx], ['valid', 'pay_to_not_allowed', 'seller', true]);
}

async function s11() {
  head(11, 'hidden debit: the agent takes 0.02 USDC with a plain Transfer outside x402; the x402 payment that then crosses the budget is still the agent operator\'s');
  const g = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A']);
  const hidden = await sendPlainTransfer(ctx, keys, { to: sellers.C.address, amount: '20000' });
  step(`plain Transfer 0.02 USDC signed by the agent as delegate, to seller C's token account, no x402: ${hidden}`);
  const naive = await agentFor(g, { localChecks: false });
  const r1 = await naive.fetch(sellers.A.url()); expect('x402 payment 1 (0.01, seller A) settles', r1.status, 200);
  const r2 = await naive.fetch(sellers.A.url()); expect('x402 payment 2 (0.01, seller A) settles', r2.status, 200);
  step(`payment 1 ${r1.receipt.tx_sig}\n    payment 2 ${r2.receipt.tx_sig}`);
  const v1 = await dispute({ tx_sig: r1.receipt.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r1.receipt });
  expect('payment 1: 0.02 hidden + 0.01 = 0.03, exactly the budget, in scope', [v1.reason, v1.liable], ['in_scope', 'principal']);
  const v2 = await dispute({ tx_sig: r2.receipt.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r2.receipt }); showVerdict(v2);
  expect('payment 2 crosses the 0.03 budget only because the hidden debit counts: period_over_budget, agent operator', [v2.verdict, v2.reason, v2.liable], ['valid', 'period_over_budget', 'agent_operator']);
  const vh = await dispute({ tx_sig: hidden, mandate: g.m, grant_tx: g.grant_tx, receipt: null }); showVerdict(vh);
  expect('the plain Transfer itself cannot have gone through x402: debit_not_x402, agent operator', [vh.verdict, vh.reason, vh.liable, vh.refund_tx ?? null], ['valid', 'debit_not_x402', 'agent_operator', null]);
}
async function s12() {
  head(12, 'concurrency: five concurrent fetches against a period budget that fits three');
  const g = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A']);
  const a = await agentFor(g);
  const before = await usdc(ctx, keys.principal.address);
  const rs = await Promise.allSettled([1, 2, 3, 4, 5].map(() => a.fetch(sellers.A.url())));
  const ok = rs.filter((r) => r.status === 'fulfilled' && r.value.status === 200);
  const refused = rs.filter((r) => r.status === 'rejected' && r.reason instanceof IussumRefusal && r.reason.reason === 'period_over_budget');
  step(`outcomes: ${rs.map((r) => (r.status === 'fulfilled' ? r.value.status : r.reason.reason ?? r.reason.message)).join(', ')}`);
  for (const r of rs) { // anything but a settled payment or the expected local refusal is printed in full
    if (r.status === 'rejected' && r.reason.reason !== 'period_over_budget') step(`UNEXPECTED refusal ${r.reason.reason ?? r.reason.message}: ${JSON.stringify(r.reason.delta ?? null)}`);
    if (r.status === 'fulfilled' && r.value.status !== 200) step(`UNEXPECTED HTTP ${r.value.status}: ${(await r.value.clone().text()).slice(0, 400)}`);
  }
  expect('exactly three payments settled and two were refused locally with period_over_budget', [ok.length, refused.length], [3, 2]);
  const sigs = ok.map((r) => r.value.receipt.tx_sig);
  step(`settled transactions: ${sigs.join(' ')}`);
  const st = (await ctx.rpc.call('getSignatureStatuses', [sigs, { searchTransactionHistory: true }])).value;
  expect('all three are confirmed on chain without error', st.map((x) => [x?.confirmationStatus === 'confirmed' || x?.confirmationStatus === 'finalized', x?.err ?? null]), sigs.map(() => [true, null]));
  expect('the principal paid exactly 0.03 USDC (3 x 0.01)', String(before - (await usdc(ctx, keys.principal.address))), '30000');
  // Phase 1.3: dispute each of the three payments. If two of them sit in the same slot, the resolver must read the block to order them.
  const slots = []; for (const sg of sigs) slots.push((await ctx.rpc.getTransaction(sg)).slot);
  step(`slots of the three payments: ${slots.join(', ')}`);
  const reads = []; const orig = ctx.rpc.getBlockSignatures; ctx.rpc.getBlockSignatures = async (sl) => { reads.push(sl); return orig(sl); };
  const verdicts = [];
  for (const r of ok) { const v = await dispute({ tx_sig: r.value.receipt.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r.value.receipt }); showVerdict(v); verdicts.push([v.reason, v.liable]); }
  ctx.rpc.getBlockSignatures = orig;
  expect('a dispute on each of the three settled payments is in_scope, principal', verdicts, [['in_scope', 'principal'], ['in_scope', 'principal'], ['in_scope', 'principal']]);
  const shared = new Set(slots).size < slots.length;
  step(`two payments in the same slot: ${shared ? 'YES' : 'no'}; getBlock read for slot(s): ${[...new Set(reads)].join(', ') || 'none'}`);
  if (shared) expect('payments that share a slot were ordered by reading the block', reads.length > 0, true);
}
async function s13() {
  head(13, 'provisional verdict: the liable seller files first without the receipt; the principal\'s later dispute with the receipt replaces it and gets the refund');
  const g = await newMandate({}, ['A']);
  const before = await usdc(ctx, keys.principal.address);
  const res = await (await agentFor(g, { localChecks: false })).fetch(sellers.C.url());
  expect('observe-mode seller C settles an out-of-scope payment', res.status, 200);
  const r = res.receipt;
  step(`payment tx ${r.tx_sig}`);
  const mid = await usdc(ctx, keys.principal.address);
  const first = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: null }); showVerdict(first);
  expect('seller C files first WITHOUT the receipt: provisional, agent operator, no refund', [first.reason, first.liable, first.provisional, first.refund_tx ?? null], ['pay_to_not_allowed', 'agent_operator', true, null]);
  const second = await dispute({ tx_sig: r.tx_sig, mandate: g.m, grant_tx: g.grant_tx, receipt: r }); showVerdict(second);
  expect('the principal files WITH the receipt: the verdict is replaced, seller C liable, final', [second.reason, second.liable, second.provisional, second.replaced?.length], ['pay_to_not_allowed', 'seller', false, 1]);
  const after = await usdc(ctx, keys.principal.address);
  expect('the refund is on chain: the principal paid 0.01 then got 0.01 back', [String(before - mid), String(after - mid), !!second.refund_tx], ['10000', '10000', true]);
  step(`refund tx ${second.refund_tx}`);
}

// ---- scenarios 14 and 15 (Phase 1.5): a seller KEEPS the agent's signed payload and answers 502. Kept payloads are replayed to the seller later, as a seller would.
// The wrapper below is installed while the agent is created (the agent captures the global fetch then); it keeps the first paid request's header.
async function agentKeeping(g, dataDir, state) {
  const real = globalThis.fetch;
  globalThis.fetch = async (req, init) => {
    const h = req?.headers?.get?.('payment-signature');
    if (h && state.keep > 0) { state.keep--; state.kept.push(h); return new Response('{}', { status: 502 }); }
    return real(req, init);
  };
  try { return await agentFor(g, { dataDir }); } finally { globalThis.fetch = real; }
}
const replayKept = (header, url) => fetch(url, { headers: { 'PAYMENT-SIGNATURE': header } }); // the seller lands (or tries to land) the payload it kept
const errOf = (res) => { const pr = res.headers.get('payment-required'); try { return pr ? JSON.parse(Buffer.from(pr, 'base64').toString()).error ?? '' : ''; } catch { return ''; } };
async function s14() {
  head(14, 'EXPIRY on a real node: a kept payload keeps the budget occupied until the agent can PROVE its blockhash expired (isBlockhashValid false and block height above lastValidBlockHeight, both at the payload\'s context slot)');
  const g = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-demo-agent-'));
  const state = { keep: 1, kept: [] };
  const agent = await agentKeeping(g, dataDir, state);
  try {
    const first = await agent.fetch(sellers.A.url('mid')).then((r) => r.status, (e) => e.reason ?? e.message);
    expect('the seller kept the payload and answered 502', [first, state.kept.length], [502, 1]);
    const res = agent.reservations[0];
    step(`payload: blockhash ${res.blockhash}, context slot ${res.contextSlot}, lastValidBlockHeight ${res.lastValid}, agent signature ${res.agentSig}`);
    const opts = { commitment: 'confirmed', minContextSlot: res.contextSlot };
    const probe = async () => { const v = await ctx.rpc.call('isBlockhashValid', [res.blockhash, opts]); const h = await ctx.rpc.call('getBlockHeight', [opts]); return { valid: v.value, slot: v.context.slot, height: h }; };
    const p0 = await probe();
    step(`at once: isBlockhashValid ${p0.valid} (node slot ${p0.slot}), block height ${p0.height}, last valid ${res.lastValid}`);
    const early = await agent.fetch(sellers.A.url('mid')).then((r) => 'paid', (e) => e.reason ?? e.message);
    expect('1. before the blockhash expires the next payment (it would cross the 0.03 budget) is refused', early, 'period_over_budget');
    const t0 = Date.now(); let settled = null, last = p0, polls = 0;
    while (Date.now() - t0 < 180_000) {
      await sleep(5000);
      last = await probe().catch(() => last); polls++;
      try { settled = await agent.fetch(sellers.A.url('mid')); break; } catch (e) { if (e.reason !== 'period_over_budget') throw e; }
    }
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    const after = await probe().catch(() => last);
    step(`2. the release rule fired after ${wall} s and ${polls} polls. Last poll before it (up to 5 s older than the agent's own check): isBlockhashValid ${last.valid} (node slot ${last.slot}), block height ${last.height}. Probe right after the release: isBlockhashValid ${after.valid} (node slot ${after.slot}), block height ${after.height}, last valid ${res.lastValid}`);
    expect('2. right after the release the node says the blockhash is invalid and the height is past lastValidBlockHeight', [after.valid, after.height > Number(res.lastValid)], [false, true]);
    expect('2. the agent\'s own release rule fired within 3 minutes', settled !== null, true);
    expect('3. the next payment then settles', settled?.status, 200);
    step(`next payment ${settled?.receipt?.tx_sig}; reservation states ${agent.reservations.map((r) => r.state).join(',')}`);
    const before = await usdc(ctx, keys.principal.address);
    const replay = await replayKept(state.kept[0], sellers.A.url('mid'));
    const why = errOf(replay) || (await replay.text()).slice(0, 200);
    step(`4. the seller submits the kept payload: HTTP ${replay.status}, ${why}`);
    expect('4. the kept payload no longer lands (HTTP is not 200, no money moved)', [replay.status !== 200, String(await usdc(ctx, keys.principal.address))], [true, String(before)]);
    // the facilitator words it as a failed simulation; ask the node itself what is wrong with the kept transaction
    const txB64 = JSON.parse(Buffer.from(state.kept[0], 'base64').toString()).payload.transaction;
    const sim = await ctx.rpc.call('simulateTransaction', [txB64, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
    step(`the node simulating the kept transaction: err ${JSON.stringify(sim.value.err)}`);
    expect('4. the refusal is a blockhash error (the node says BlockhashNotFound)', sim.value.err, 'BlockhashNotFound');
  } finally { await agent.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
}
async function s15() {
  head(15, 'RESTART with a data directory: a restarted agent still counts the payload a seller kept, and counts it once after the seller lands it');
  const g = await newMandate({ per_payment_max: '20000', period_budget: '30000' }, ['A']);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-demo-agent-'));
  const state = { keep: 1, kept: [] };
  let agent = await agentKeeping(g, dataDir, state);
  try {
    const first = await agent.fetch(sellers.A.url('mid')).then((r) => r.status, (e) => e.reason ?? e.message);
    expect('1. the agent signs a payload, the seller keeps it (502)', [first, state.kept.length], [502, 1]);
    const agentSig = agent.reservations[0].agentSig;
    step(`the reservation is on disk: ${fs.readdirSync(dataDir).filter((f) => f.includes('.reservations.')).join(', ')} (agent signature ${agentSig})`);
    await agent.close(); // the process dies; a new createAgent on the same dataDir is the restart
    agent = await agentFor(g, { dataDir });
    expect('the restarted agent loaded the held reservation', agent.reservations.map((r) => [r.state, r.agentSig === agentSig]), [['held', true]]);
    const refused = await agent.fetch(sellers.A.url('mid')).then(() => 'paid', (e) => e.reason ?? e.message);
    expect('2. the restarted agent refuses a payment that would cross the budget while the kept payload can still land', refused, 'period_over_budget');
    const landed = await replayKept(state.kept[0], sellers.A.url('mid'));
    const settle = JSON.parse(Buffer.from(landed.headers.get('payment-response') ?? 'e30=', 'base64').toString());
    expect('3. the seller lands the kept payload', [landed.status, !!settle.transaction], [200, true]);
    step(`landed: ${settle.transaction}`);
    await agent.close(); // restart again: the history now shows the payment
    agent = await agentFor(g, { dataDir });
    const sigs = agent.ledger.map((e) => e.sig);
    expect('4. the landed payment is in the rebuilt ledger exactly once', sigs.filter((x) => x === settle.transaction).length, 1);
    expect('4. and the restored reservation is consumed, not held a second time', agent.reservations.map((r) => r.state), ['consumed']);
    const ok = await agent.fetch(sellers.A.url('quote')).then((r) => r.status, (e) => e.reason ?? e.message);
    const over = await agent.fetch(sellers.A.url('quote')).then((r) => r.status, (e) => e.reason ?? e.message);
    expect('4. counted once: 0.02 + 0.01 fits the 0.03 budget, a further 0.01 does not', [ok, over], [200, 'period_over_budget']);
  } finally { await agent.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
}

const scenarios = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15];
for (const f of scenarios) { try { await f(); } catch (e) { results.push({ scenario: current, label: 'scenario threw', ok: false, actual: String(e.stack ?? e) }); say(`    FAIL scenario threw: ${e.stack ?? e}`); } }
say('\n=== Summary');
for (const sc of [...new Set(results.map((r) => r.scenario))]) { const rs = results.filter((r) => r.scenario === sc); say(`${rs.every((r) => r.ok) ? 'PASS' : 'FAIL'}  ${sc}  (${rs.filter((r) => r.ok).length}/${rs.length} checks)`); }
const failed = results.filter((r) => !r.ok).length;
say(`${results.length - failed}/${results.length} checks passed`);
for (const s of Object.values(sellers)) s.close();
rsrv.close(); store.close();
process.exit(failed ? 1 : 0);
