// The resolver as a pure function (v3 section 4, Addendum B). Every input is data that was already fetched; no clock, no network.
//   verdict "valid"   : the dispute is upheld, the payment was outside the mandate and the artifacts verify. liable is seller or agent_operator.
//   verdict "invalid" : the dispute fails. liable "principal" when the payment was in scope (R1); liable null when the artifacts do not verify (R4).
//   R1 in scope: principal bears it. R2 out of scope and the receipt shows the mandate was presented: the seller. R3 out of scope and it was not
//   presented: the agent operator. period_over_budget is always the agent operator's: a seller cannot see other sellers' payments.
//   A payment is judged at its own slot: a later revoke does not make an in-scope payment out of scope.
import { fails, registerCheck } from './guard.js';
import { R, SELLER_VISIBLE } from './codes.js';
import { validateMandate, mandateId, scopeViolations, periodSpendAt } from './mandate.js';
import { verifyReceipt } from './receipt.js';

export const RESOLVER_CHECKS = ['resolver.receipt_tx', 'resolver.chain_amount', 'resolver.chain_pay_to', 'resolver.chain_payer', 'resolver.chain_asset', 'resolver.source', 'resolver.mandate_presented', 'resolver.seller_visible', 'resolver.single_transfer', 'resolver.period_since_grant'].map(registerCheck);
const out = (verdict, reason, liable, extra = {}) => ({ verdict, tier: 1, reason, delta: [], liable, time_source: null, ...extra });
const nul = (reason, extra) => out('invalid', reason, null, extra);

export function resolve(e) {
  const { tx_sig, network, mandate, grant_tx, grant, receipt, seller_pubkey, payment, history } = e;
  // chain
  if (!payment?.found || payment.err) return nul(R.tx_not_found, { delta: [{ field: 'tx_sig', authorized: 'a successful transaction', actual: payment?.found ? `failed: ${JSON.stringify(payment.err)}` : 'not found' }] });
  // evidence present?
  const missing = [];
  if (!receipt) missing.push('seller receipt (what the seller saw)');
  if (!mandate) missing.push('mandate (what the person authorised)');
  if (missing.length) return nul(!receipt ? R.receipt_missing : R.mandate_missing, { missing, delta: missing.map((m) => ({ field: 'evidence', authorized: 'present', actual: `missing: ${m}` })) });
  const me = validateMandate(mandate);
  if (me.length) return nul(R.mandate_invalid, { delta: me.map((m) => ({ field: 'mandate', authorized: 'valid', actual: m })) });
  const mid = mandateId(mandate);
  // receipt must verify against a trusted seller key
  const rv = verifyReceipt(receipt, seller_pubkey);
  if (!rv.ok) return nul(R.signature_invalid, { mandate_id: mid, delta: [{ field: 'receipt', authorized: 'signed by the seller key', actual: rv.why }] });
  // receipt vs chain
  const mismatch = [];
  if (fails('resolver.receipt_tx', receipt.tx_sig !== tx_sig)) mismatch.push({ field: 'tx_sig', authorized: tx_sig, actual: receipt.tx_sig });
  const t = payment.transfers;
  if (fails('resolver.single_transfer', t.length !== 1)) return nul(R.tx_mismatch, { mandate_id: mid, delta: [{ field: 'transfers', authorized: '1 TransferChecked', actual: String(t.length) }] });
  const x = t[0];
  if (fails('resolver.chain_amount', x.amount !== receipt.amount)) mismatch.push({ field: 'amount', authorized: x.amount, actual: receipt.amount });
  if (fails('resolver.chain_pay_to', x.dest_owner !== receipt.pay_to)) mismatch.push({ field: 'pay_to', authorized: String(x.dest_owner), actual: receipt.pay_to });
  if (fails('resolver.chain_payer', x.authority !== receipt.payer)) mismatch.push({ field: 'payer', authorized: x.authority, actual: receipt.payer });
  if (fails('resolver.chain_asset', x.mint !== receipt.asset)) mismatch.push({ field: 'asset', authorized: x.mint, actual: receipt.asset });
  if (mismatch.length) return nul(R.tx_mismatch, { mandate_id: mid, delta: mismatch });
  // the mandate must be backed by its grant, and the payment must come out of the granted account
  if (!grant || !grant.ok) return nul(grant?.reason ?? R.grant_not_found, { mandate_id: mid, delta: [{ field: 'grant', authorized: 'ApproveChecked + Memo bound to the mandate id', actual: grant?.detail ?? 'no grant check' }] });
  if (fails('resolver.source', x.source !== grant.source)) return nul(R.tx_mismatch, { mandate_id: mid, delta: [{ field: 'source', authorized: grant.source, actual: x.source }] });
  // tier 1 scope, at the payment's own time (block time wins over the seller-claimed settled_at)
  const time = payment.block_time ?? receipt.settled_at;
  const time_source = payment.block_time != null ? 'block' : 'receipt';
  const delta = scopeViolations(mandate, { amount: x.amount, pay_to: x.dest_owner, resource: receipt.resource, asset: x.mint, network, payer: x.authority, time });
  // period budget from chain history
  if (history) {
    // spend made before the grant belongs to an earlier grant: only payments after the grant transaction count
    const since = history.filter((h) => !fails('resolver.period_since_grant', h.slot <= grant.grant_slot));
    const p = periodSpendAt(mandate, since, tx_sig);
    if (p.over) delta.push({ code: R.period_over_budget, field: 'period_budget', authorized: mandate.period_budget, actual: `${p.spent} spent in period ${p.period}` });
  }
  if (delta.length === 0) return out('invalid', R.in_scope, 'principal', { mandate_id: mid, time_source });
  const presented = !fails('resolver.mandate_presented', !(receipt.mandate_id === mid && receipt.grant_tx !== null && receipt.grant_tx === grant_tx));
  const visible = delta.some((d) => SELLER_VISIBLE.has(d.code));
  const liable = fails('resolver.seller_visible', !visible) ? 'agent_operator' : presented ? 'seller' : 'agent_operator';
  const order = [...SELLER_VISIBLE, R.period_over_budget];
  const first = [...delta].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))[0].code;
  return { verdict: 'valid', tier: 1, reason: first, delta, liable, time_source, mandate_id: mid };
}
