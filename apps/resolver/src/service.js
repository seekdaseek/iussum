// The resolver service: fetches the evidence, calls the pure resolve(), stores the decided verdict, and (demo simplification) pays the refund
// from a refund-float wallet when the seller is liable. In production the seller would refund itself on a signed ruling; here the float
// stands in for the seller's own refund key so the demo shows money actually moving back.
import { resolve, verifyReceipt, parsePayment, agentSpendHistory, createGrantChecker, fillBlockIndices, validateMandate, mandateId, canonicalize, sha256Hex, periodStart, R, fails, registerCheck } from '@iussum/core';
export const RESOLVER_SERVICE_CHECKS = ['resolver.duplicate', 'resolver.refund_seller_only', 'resolver.refund_retry', 'resolver.refund_pending_guard', 'resolver.refund_decimals', 'resolver.provisional', 'resolver.provisional_needs_receipt', 'resolver.replace_binds_mandate', 'resolver.history_to_grant', 'resolver.equivocation', 'resolver.checkpoint'].map(registerCheck);
const sha = (x) => (x ? sha256Hex(canonicalize(x)) : null);
// A rejected dispute (artifacts do not verify, evidence missing or incomplete, mandate mismatch or superseded) is not a decision about the
// payment and may be resubmitted; a decided one is stored.
const decided = (v) => v.liable !== null;
const PENDING_GRACE_S = 150; // a signed refund transaction may still land for about this long

export function createResolver({ rpc, network, sellerKey, store, sendRefund = null, now = () => Math.floor(Date.now() / 1000), historyPageSize = 100, historyMaxPages = 1000 }) {
  const checker = createGrantChecker(rpc, { scanStore: { get: (k) => store.getCheckpoint(`scan|${k}`), put: (k, v) => store.putCheckpoint(`scan|${k}`, v, now()) } });
  const inflight = new Map();
  const dup = (s, extra = {}) => ({ ...s.verdict, reason: R.duplicate_dispute, original_reason: s.verdict.reason, refund_tx: s.refund_tx, duplicate: true, provisional: s.provisional, ...extra });

  // Pay the refund for a stored seller-liable verdict exactly once. Safe to call again after a failure: a signed-but-unconfirmed attempt is
  // looked up on chain first, and only resent once it can no longer land.
  async function payRefund(tx_sig, payment) {
    const s = store.get(tx_sig);
    if (s.refund_tx) return { refund_tx: s.refund_tx };
    if (s.refund_pending) {
      const st = (await rpc.call('getSignatureStatuses', [[s.refund_pending], { searchTransactionHistory: true }])).value[0];
      if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) { store.setRefund(tx_sig, s.refund_pending); return { refund_tx: s.refund_pending }; }
      if (fails('resolver.refund_pending_guard', now() - (s.refund_pending_at ?? 0) < PENDING_GRACE_S)) return { refund_tx: null, refund_state: 'pending', refund_pending: s.refund_pending };
    }
    const t = payment.transfers[0];
    if (!t) throw new Error('the payment has no TransferChecked to refund');
    const sig = await sendRefund({ to: t.source_owner, mint: t.mint, amount: t.amount, decimals: fails('resolver.refund_decimals', true) ? t.decimals : 6, reason: `dispute ${tx_sig}` }, { onSigned: (p) => store.setPending(tx_sig, p, now()) });
    store.setRefund(tx_sig, sig);
    return { refund_tx: sig };
  }
  const owesRefund = (s) => s.verdict.verdict === 'valid' && s.verdict.liable === 'seller' && !s.refund_tx;

  // Gather the evidence for one dispute. Returns { e } for resolve(), or { early } when the supersession scan itself failed.
  async function gather({ tx_sig, mandate, grant_tx, receipt }) {
    const payment = parsePayment(await rpc.getTransaction(tx_sig));
    const mandateOk = mandate && validateMandate(mandate).length === 0;
    const grant = mandateOk && grant_tx ? await checker.check(mandate, grant_tx, { active: false }) : null;
    const seller_pubkey = receipt ? await sellerKey(receipt.pay_to) : null;
    let history = null, superseded = null, allowance = null, blockIdx = {};
    if (mandateOk && grant?.ok && payment.found && !payment.err) {
      // the source account FIRST, with the slot it was read at: the allowance cross-check counts debits up to that slot (Addendum E, C1)
      try { const ctx = await rpc.getAccountContext(grant.source); allowance = { slot: ctx.slot, account: ctx.value }; } catch { allowance = null; }
      // Is the grant still current? (first: it decides how far back the history must reach)
      try { superseded = await checker.supersededBy(grant.source, grant_tx); }
      catch (e) { return { early: { verdict: 'invalid', tier: 1, reason: R.history_incomplete, delta: [{ field: 'supersession scan', authorized: 'complete', actual: e.message }], liable: null, time_source: null } }; }
      // While the grant is current the allowance cross-check (C1) compares ALL debits since the grant with the allowance that is left, so the
      // history must reach the grant: no cut at the start of the period (Addendum F, N1). A superseded grant skips C1, and the period is enough.
      // A superseded grant skips C1 and only needs the period (no checkpoint). A current one reads back to the grant, ONCE: the verified history is kept as a
      // checkpoint per grant, so a later dispute reads only what is new, and a read that stops at maxPages keeps its progress (Addendum G, T2).
      const startsAt = superseded && payment.block_time != null ? periodStart(mandate, payment.block_time) : null;
      const cpKey = `${grant_tx}|${grant.source}|${mandate.agent}|${mandate.asset}`;
      const useCp = !superseded && fails('resolver.checkpoint', true);
      history = await agentSpendHistory(rpc, { source: grant.source, agent: mandate.agent, mint: mandate.asset, until: grant_tx, stopAtTime: fails('resolver.history_to_grant', true) ? startsAt : (payment.block_time != null ? periodStart(mandate, payment.block_time) : null), pageSize: historyPageSize, maxPages: historyMaxPages, checkpoint: useCp ? store.getCheckpoint(cpKey) : null });
      if (useCp && history.checkpoint) store.putCheckpoint(cpKey, history.checkpoint, now());
      Object.assign(blockIdx, history.blockIdx);
      // order the transactions that are compared (S7): the block is read only where two relevant transactions share a slot
      try { await fillBlockIndices(rpc, [{ slot: grant.grant_slot, tx_sig: grant_tx }, { slot: payment.slot, tx_sig }, ...(superseded ? [{ slot: superseded.slot, tx_sig: superseded.sig }] : []), ...history.entries], blockIdx); }
      catch { /* an unknown order is detected where it matters and gives history_incomplete */ }
    }
    return { e: { tx_sig, network, mandate, grant_tx, grant, receipt, seller_pubkey, payment, history, superseded, blockIdx, allowance }, payment };
  }

  // Receipt equivocation (Addendum F, N4): the seller holds its own receipt key, so it could sign a second receipt and file it first. Two receipts for
  // one payment that verify against the same seller key and differ in any signed field are the seller's doing: an honest gate signs exactly one per
  // settlement. Returns the stored receipt when `receipt` equivocates against it.
  const bodyHash = (r) => { const { signature: _s, ...b } = r; return sha256Hex(canonicalize(b)); };
  async function equivocatesWith(stored, receipt, tx_sig) {
    if (!stored?.receipt_json || !receipt || receipt.tx_sig !== tx_sig || stored.verdict.reason === R.receipt_equivocation) return null;
    const prev = JSON.parse(stored.receipt_json);
    if (prev.tx_sig !== tx_sig || bodyHash(prev) === bodyHash(receipt)) return null;
    if (receipt.seller !== prev.seller || !verifyReceipt(receipt, await sellerKey(receipt.pay_to)).ok) return null;
    return prev;
  }

  async function decide(bundle) {
    const { tx_sig, mandate, receipt } = bundle;
    const stored = store.get(tx_sig);
    // A verdict decided WITHOUT a receipt is provisional (Addendum E, B4): whoever files first must not pick the evidence. A later dispute that
    // carries a receipt may re-judge it. A verdict decided with a verifying receipt is final.
    const prevReceipt = fails('resolver.equivocation', true) ? await equivocatesWith(stored, receipt, tx_sig) : null;
    if (prevReceipt) {
      const payment = parsePayment(await rpc.getTransaction(tx_sig));
      if (!payment.found || payment.err) return { verdict: 'invalid', tier: 1, reason: R.tx_not_found, delta: [{ field: 'tx_sig', authorized: 'a successful transaction', actual: 'not found' }], liable: null, time_source: null };
      const verdict = { verdict: 'valid', tier: 1, reason: R.receipt_equivocation, liable: 'seller', time_source: null, mandate_id: stored.verdict.mandate_id ?? null, delta: [{ code: R.receipt_equivocation, field: 'receipt', authorized: 'one receipt per settlement', actual: `two different receipts signed by ${receipt.seller} for ${tx_sig}: ${bodyHash(prevReceipt).slice(0, 16)}… and ${bodyHash(receipt).slice(0, 16)}…` }] };
      if (!store.replaceAny(tx_sig, { mandate_sha: sha(bundle.mandate), receipt_sha: sha(receipt), verdict, now: now(), receipt })) return dup(store.get(tx_sig));
      const flags = { provisional: false, replaced: store.get(tx_sig).replaced };
      if (sendRefund) { try { return { ...verdict, ...flags, ...(await payRefund(tx_sig, payment)) }; } catch (e) { return { ...verdict, ...flags, refund_tx: null, refund_error: e.message }; } }
      return { ...verdict, ...flags, refund_tx: null };
    }
    const replacing = Boolean(stored && decided(stored.verdict) && fails('resolver.provisional', stored.provisional) && fails('resolver.provisional_needs_receipt', receipt));
    if (fails('resolver.duplicate', stored && decided(stored.verdict) && !replacing)) {
      // a refund that failed after the verdict was reserved is retried here, idempotently
      if (fails('resolver.refund_retry', sendRefund && owesRefund(stored))) {
        try {
          const payment = parsePayment(await rpc.getTransaction(tx_sig));
          const r = await payRefund(tx_sig, payment);
          return dup(store.get(tx_sig), r);
        } catch (e) { return dup(stored, { refund_error: e.message }); }
      }
      return dup(stored);
    }
    const g = await gather(bundle);
    if (g.early) return g.early;
    const { payment } = g;
    const verdict = resolve(g.e);
    // decide, reserve the tx_sig in the store FIRST, and only the request that reserved it may pay a refund
    if (decided(verdict)) {
      const entry = { mandate_sha: sha(mandate), receipt_sha: sha(receipt), verdict, refund_tx: null, now: now(), provisional: !receipt, receipt };
      if (replacing) {
        // only a verdict decided with a receipt that verifies and binds THIS mandate replaces the provisional one
        if (fails('resolver.replace_binds_mandate', !receipt || receipt.mandate_id !== verdict.mandate_id)) return dup(stored);
        if (!store.replaceProvisional(tx_sig, entry)) return dup(store.get(tx_sig));
      } else if (!store.put(tx_sig, entry)) return dup(store.get(tx_sig));
    } else if (replacing) return dup(stored, { rejected_evidence: { reason: verdict.reason, delta: verdict.delta } }); // the new evidence does not verify: the stored verdict stays
    const kept = replacing ? store.get(tx_sig) : null;
    const flags = decided(verdict) ? { provisional: !receipt, ...(kept ? { replaced: kept.replaced } : {}) } : {};
    if (verdict.verdict === 'valid' && fails('resolver.refund_seller_only', verdict.liable === 'seller') && sendRefund) {
      try { return { ...verdict, ...flags, ...(await payRefund(tx_sig, payment)) }; }
      catch (e) { return { ...verdict, ...flags, refund_tx: null, refund_error: e.message }; }
    }
    return { ...verdict, ...flags, refund_tx: null };
  }
  return {
    // concurrent disputes for the same tx_sig are serialised, so two requests cannot both pay a refund
    dispute(bundle) {
      const k = bundle.tx_sig;
      const prev = inflight.get(k) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(() => decide(bundle));
      inflight.set(k, next);
      next.finally(() => { if (inflight.get(k) === next) inflight.delete(k); }).catch(() => {});
      return next;
    },
    stored: (tx) => store.get(tx),
  };
}
