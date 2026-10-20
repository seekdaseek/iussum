// The resolver as a pure function (v3 section 4, Addendum B). Every input is data that was already fetched; no clock, no network.
//   verdict "valid"   : the dispute is upheld, the payment was outside the mandate and the artifacts verify. liable is seller or agent_operator.
//   verdict "invalid" : the dispute fails. liable "principal" when the payment was in scope (R1); liable null when the artifacts do not verify (R4).
//   R1 in scope: principal bears it. R2 out of scope and the receipt shows the mandate was presented: the seller. R3 out of scope and it was not
//   presented: the agent operator. period_over_budget is always the agent operator's: a seller cannot see other sellers' payments.
//   A payment is judged at its own position in the chain (slot, then index in the block): a later revoke does not make an in-scope payment
//   out of scope.
//   Phase 1.2 (Addendum E): the debits of the granted account that the agent signed are read by ONE parser (transfer, transferChecked, burn,
//   burnChecked, top level or CPI). A payment with none is not under this mandate (tx_mismatch, liable null). One top-level TransferChecked is
//   an x402 payment and is judged as before. Anything else cannot have gone through x402 or a seller gate: debit_not_x402, agent operator.
import { fails, isMutated, registerCheck } from './guard.js';
import { canonicalize, sha256Hex } from './jcs.js';
import { R, SELLER_VISIBLE } from './codes.js';
import { validateMandate, mandateId, scopeViolations, periodSpendAt } from './mandate.js';
import { verifyReceipt } from './receipt.js';
import { reconcileAccount, comparePositions, PositionUnknown, allowanceCheck } from './chain.js';

export const RESOLVER_CHECKS = ['resolver.receipt_tx', 'resolver.chain_amount', 'resolver.chain_pay_to', 'resolver.chain_payer', 'resolver.chain_asset', 'resolver.agent_debit', 'resolver.after_grant', 'resolver.reconcile', 'resolver.debit_not_x402', 'resolver.allowance', 'resolver.mandate_presented', 'resolver.seller_visible', 'resolver.period_since_grant', 'resolver.mandate_mismatch', 'resolver.superseded', 'resolver.history_complete', 'resolver.history_found', 'resolver.no_receipt_judged'].map(registerCheck);
const out = (verdict, reason, liable, extra = {}) => ({ verdict, tier: 1, reason, delta: [], liable, time_source: null, ...extra });
const nul = (reason, extra) => out('invalid', reason, null, extra);

// e = { tx_sig, network, mandate, grant_tx, grant, receipt|null, seller_pubkey, payment, history, superseded, blockIdx, allowance }
//   history     : { entries, complete } from agentSpendHistory (entries in execution order), or null when it could not be read
//   superseded  : { sig, slot } of the earliest later instruction that changed the source account's delegation, or null
//   blockIdx    : { tx_sig: index in its block } for transactions that share a slot with another relevant one (S7)
//   allowance   : { slot, account } the source account as read BEFORE the history, with the slot it was read at (C1)
export function resolve(e) {
  const { tx_sig, network, mandate, grant_tx, grant, receipt, seller_pubkey, payment, history, superseded, blockIdx = {}, allowance } = e;
  // chain
  if (!payment?.found || payment.err) return nul(R.tx_not_found, { delta: [{ field: 'tx_sig', authorized: 'a successful transaction', actual: payment?.found ? `failed: ${JSON.stringify(payment.err)}` : 'not found' }] });
  // the mandate is always needed: it is what the person authorised
  if (!mandate) return nul(R.mandate_missing, { missing: ['mandate (what the person authorised)'], delta: [{ field: 'evidence', authorized: 'present', actual: 'missing: mandate (what the person authorised)' }] });
  const me = validateMandate(mandate);
  if (me.length) return nul(R.mandate_invalid, { delta: me.map((m) => ({ field: 'mandate', authorized: 'valid', actual: m })) });
  const mid = mandateId(mandate);
  const unknownPos = (err) => nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'position', authorized: 'a known order of the transactions that are compared', actual: err.message }] });
  // the receipt is optional: without one the chain alone is still judged (R3: no mandate was presented to the seller)
  if (receipt) {
    const rv = verifyReceipt(receipt, seller_pubkey);
    if (!rv.ok) return nul(R.signature_invalid, { mandate_id: mid, delta: [{ field: 'receipt', authorized: 'signed by the seller key', actual: rv.why }] });
    // the receipt fixes WHICH mandate the seller saw: the disputing party cannot pick another one (Addendum C, fix 4)
    if (fails('resolver.mandate_mismatch', receipt.mandate_id !== null && receipt.mandate_id !== mid)) return nul(R.mandate_mismatch, { mandate_id: mid, delta: [{ field: 'mandate_id', authorized: receipt.mandate_id, actual: mid }] });
  }
  // the mandate must be backed by its grant
  if (!grant || !grant.ok) return nul(grant?.reason ?? R.grant_not_found, { mandate_id: mid, delta: [{ field: 'grant', authorized: 'ApproveChecked + Memo bound to the mandate id', actual: grant?.detail ?? 'no grant check' }] });
  const here = { slot: payment.slot, tx_sig };
  try {
    // a mandate superseded before the payment was not the current one when the payment was made (Addendum C, fix 1); the disputing party
    // can resubmit with the mandate that was current. Compared by position in the chain (Addendum E, S7).
    if (fails('resolver.superseded', superseded && comparePositions(here, { slot: superseded.slot, tx_sig: superseded.sig }, blockIdx) > 0)) return nul(R.mandate_superseded, { mandate_id: mid, delta: [{ field: 'grant', authorized: 'the current grant when the payment was made', actual: `superseded by ${superseded.sig} at slot ${superseded.slot}, payment at slot ${payment.slot}` }] });
    // every movement out of the granted account must be explained by the parsed instructions (Addendum E, B1b)
    const rec = reconcileAccount(payment, grant.source);
    if (fails('resolver.reconcile', !rec.ok)) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'balance', authorized: 'the parsed instructions explain the balance change of the granted account', actual: `${tx_sig}: instructions move ${rec.moved}, the balance changed by ${rec.dropped}` }] });
    // the payment must be a debit of the granted account signed by the agent, made after the grant (Addendum E, B3)
    const mine = payment.debits.filter((d) => d.source === grant.source && d.authority === mandate.agent);
    if (fails('resolver.agent_debit', mine.length === 0)) return nul(R.tx_mismatch, { mandate_id: mid, delta: [{ field: 'source', authorized: `${grant.source} debited by ${mandate.agent}`, actual: payment.debits.length ? payment.debits.map((d) => `${d.source} by ${d.authority}`).join('; ') : 'no debit' }] });
    if (fails('resolver.after_grant', comparePositions(here, { slot: grant.grant_slot, tx_sig: grant_tx }, blockIdx) <= 0)) return nul(R.tx_mismatch, { mandate_id: mid, delta: [{ field: 'time', authorized: 'a payment after the grant transaction', actual: `payment at slot ${payment.slot} is not after the grant at slot ${grant.grant_slot}` }] });
    // The x402 path needs the WHOLE transaction to be the x402 shape: exactly one token debit in it, top level or by CPI, and it is the agent's
    // TransferChecked out of the granted account. Anything else that carries an agent debit of the source cannot have gone through x402 or a seller
    // gate: the agent operator's (Addendum E B1e, Addendum F N2). A facilitator cannot add instructions without breaking the agent's signature.
    const x402Shape = payment.debits.length === 1 && mine.length === 1 && mine[0].top && mine[0].kind === 'transferChecked';
    if (fails('resolver.debit_not_x402', !x402Shape)) {
      return { verdict: 'valid', tier: 1, reason: R.debit_not_x402, liable: 'agent_operator', mandate_id: mid, time_source: payment.block_time != null ? 'block' : null, delta: payment.debits.map((d) => ({ code: R.debit_not_x402, field: 'debit', authorized: 'one top-level TransferChecked made through x402, and nothing else in the transaction', actual: `${d.kind} ${d.amount} from ${d.source === grant.source ? 'the granted account' : d.source} ${d.destination ? `to ${d.dest_owner ?? d.destination}` : '(burn)'}${d.top ? '' : ' by CPI'}` })) };
    }
    return judgeX402(e, mid, mine[0]);
  } catch (err) { if (err instanceof PositionUnknown) return unknownPos(err); throw err; }
}

// the x402 path: one top-level TransferChecked out of the granted account, signed by the agent
function judgeX402(e, mid, x) {
  const { tx_sig, network, mandate, grant_tx, grant, receipt, payment, history, blockIdx = {}, allowance } = e;
  if (receipt) {
    const mismatch = [];
    if (fails('resolver.receipt_tx', receipt.tx_sig !== tx_sig)) mismatch.push({ field: 'tx_sig', authorized: tx_sig, actual: receipt.tx_sig });
    if (fails('resolver.chain_amount', x.amount !== receipt.amount)) mismatch.push({ field: 'amount', authorized: x.amount, actual: receipt.amount });
    if (fails('resolver.chain_pay_to', x.dest_owner !== receipt.pay_to)) mismatch.push({ field: 'pay_to', authorized: String(x.dest_owner), actual: receipt.pay_to });
    if (fails('resolver.chain_payer', x.authority !== receipt.payer)) mismatch.push({ field: 'payer', authorized: x.authority, actual: receipt.payer });
    if (fails('resolver.chain_asset', x.mint !== receipt.asset)) mismatch.push({ field: 'asset', authorized: x.mint, actual: receipt.asset });
    if (mismatch.length) return nul(R.tx_mismatch, { mandate_id: mid, delta: mismatch });
  }
  // tier 1 scope, at the payment's own time (block time wins over the seller-claimed settled_at)
  const time = payment.block_time ?? receipt?.settled_at ?? null;
  const time_source = payment.block_time != null ? 'block' : receipt ? 'receipt' : null;
  const unjudged = [];
  if (!receipt) unjudged.push('resource'); // no receipt, no resource: what the seller was asked for is not on chain
  if (time === null) unjudged.push('time');
  const delta = scopeViolations(mandate, { amount: x.amount, pay_to: x.dest_owner, resource: receipt?.resource ?? null, asset: x.mint, network, payer: x.authority, time }, { judgeResource: !!receipt || isMutated('resolver.no_receipt_judged'), judgeTime: time !== null });
  // period budget from COMPLETE chain history (Addendum C, fix 2). A partial history never produces in_scope.
  if (fails('resolver.history_complete', !history || !history.complete)) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'history', authorized: 'complete history of the agent\'s payments from the granted account', actual: history?.reason ?? 'not shown to be complete' }] });
  try {
    // spend made before the grant belongs to an earlier grant: only debits after the grant transaction count (by position, Addendum E)
    const grantPos = { slot: grant.grant_slot, tx_sig: grant_tx };
    const since = history.entries.filter((h) => !fails('resolver.period_since_grant', comparePositions(h, grantPos, blockIdx) <= 0));
    // the allowance cross-check (C1): while the grant is current the debits found must add up to total_cap minus the allowance that is left
    if (!e.superseded && fails('resolver.allowance', true)) {
      if (!allowance) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'allowance', authorized: 'the source account read before the history', actual: 'not read' }] });
      const ac = allowanceCheck({ mandate, entries: since, account: allowance.account, slot: allowance.slot });
      if (!ac.ok) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'allowance', authorized: ac.expected !== undefined ? `${ac.expected} (total_cap ${mandate.total_cap} minus ${ac.left} still delegated at slot ${ac.slot})` : 'the allowance explained by the debits', actual: ac.actual !== undefined ? `${ac.actual} found in the history` : ac.why }] });
    }
    const p = periodSpendAt(mandate, since, tx_sig);
    if (fails('resolver.history_found', !p.found)) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'history', authorized: 'the disputed payment among the agent\'s payments from the granted account', actual: 'the payment is not in the history' }] });
    if (p.over) delta.push({ code: R.period_over_budget, field: 'period_budget', authorized: mandate.period_budget, actual: `${p.spent} spent in period ${p.period}` });
  } catch (err) { if (err instanceof PositionUnknown) return nul(R.history_incomplete, { mandate_id: mid, delta: [{ field: 'position', authorized: 'a known order of the transactions that are compared', actual: err.message }] }); throw err; }
  const extra = { mandate_id: mid, time_source, ...(unjudged.length ? { unjudged } : {}) };
  if (delta.length === 0) return out('invalid', R.in_scope, 'principal', extra);
  const presented = !fails('resolver.mandate_presented', !(receipt && receipt.mandate_id === mid && receipt.grant_tx !== null && receipt.grant_tx === grant_tx));
  const visible = delta.some((d) => SELLER_VISIBLE.has(d.code));
  const liable = fails('resolver.seller_visible', !visible) ? 'agent_operator' : presented ? 'seller' : 'agent_operator';
  const order = [...SELLER_VISIBLE, R.period_over_budget];
  const first = [...delta].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))[0].code;
  return { verdict: 'valid', tier: 1, reason: first, delta, liable, ...extra };
}

// Addendum L, L2: the external reference for a decided dispute. The record is exactly what the resolver stores for a verdict; verdict_id is the hex
// sha256 of its RFC 8785 JCS. Missing members are written as null (receipt_sha256, mandate_id, grant_tx) or empty (delta, unjudged), so one stored
// verdict has one id.
export const VERDICT_ID_CHECKS = ['resolver.verdict_id'].map(registerCheck);
export function verdictRecord({ tx_sig, mandate_id = null, grant_tx = null, receipt_sha256 = null, verdict, reason, liable = null, delta = [], unjudged = [], provisional = false }) {
  return { tx_sig, mandate_id: mandate_id ?? null, grant_tx: grant_tx ?? null, receipt_sha256: receipt_sha256 ?? null, verdict, reason, liable: liable ?? null, delta: JSON.parse(JSON.stringify(delta ?? [])), unjudged: JSON.parse(JSON.stringify(unjudged ?? [])), provisional: Boolean(provisional) };
}
export function verdictId(record) {
  const r = verdictRecord(record);
  // a skipped check hashes only the transaction signature, which is what an id that ignores the verdict would look like
  return sha256Hex(canonicalize(fails('resolver.verdict_id', true) ? r : { tx_sig: r.tx_sig }));
}
