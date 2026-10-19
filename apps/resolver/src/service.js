// The resolver service: fetches the evidence, calls the pure resolve(), stores the decided verdict, and (demo simplification) pays the refund
// from a refund-float wallet when the seller is liable. In production the seller would refund itself on a signed ruling; here the float
// stands in for the seller's own refund key so the demo shows money actually moving back.
import { resolve, parsePayment, agentSpendHistory, createGrantChecker, validateMandate, mandateId, canonicalize, sha256Hex, R, fails, registerCheck } from '@iussum/core';
export const RESOLVER_SERVICE_CHECKS = ['resolver.duplicate', 'resolver.refund_seller_only'].map(registerCheck);
const sha = (x) => (x ? sha256Hex(canonicalize(x)) : null);
const decided = (v) => v.liable !== null; // a rejected dispute (artifacts do not verify) is not a decision about the payment and may be resubmitted

export function createResolver({ rpc, network, sellerKey, store, sendRefund = null, now = () => Math.floor(Date.now() / 1000), historyLimit = 50 }) {
  const checker = createGrantChecker(rpc);
  const inflight = new Map();
  async function decide({ tx_sig, mandate, grant_tx, receipt }) {
    const stored = store.get(tx_sig);
    if (fails('resolver.duplicate', stored && decided(stored.verdict))) return { ...stored.verdict, reason: R.duplicate_dispute, original_reason: stored.verdict.reason, refund_tx: stored.refund_tx, duplicate: true };
    const payment = parsePayment(await rpc.getTransaction(tx_sig));
    const mandateOk = mandate && validateMandate(mandate).length === 0;
    const grant = mandateOk && grant_tx ? await checker.check(mandate, grant_tx, { active: false }) : null;
    const seller_pubkey = receipt ? await sellerKey(receipt.pay_to) : null;
    let history = null;
    if (mandateOk && grant?.ok && payment.found && !payment.err) history = await agentSpendHistory(rpc, { source: grant.source, agent: mandate.agent, mint: mandate.asset, limit: historyLimit, until: grant_tx });
    const verdict = resolve({ tx_sig, network, mandate, grant_tx, grant, receipt, seller_pubkey, payment, history });
    // decide, reserve the tx_sig in the store FIRST, and only the request that reserved it may pay a refund
    if (decided(verdict)) {
      const reserved = store.put(tx_sig, { mandate_sha: sha(mandate), receipt_sha: sha(receipt), verdict, refund_tx: null, now: now() });
      if (!reserved) { const s = store.get(tx_sig); return { ...s.verdict, reason: R.duplicate_dispute, original_reason: s.verdict.reason, refund_tx: s.refund_tx, duplicate: true }; }
    }
    let refund_tx = null;
    if (verdict.verdict === 'valid' && fails('resolver.refund_seller_only', verdict.liable === 'seller') && sendRefund) {
      const t = payment.transfers[0];
      refund_tx = await sendRefund({ to: mandate.principal, mint: t.mint, amount: t.amount, reason: `dispute ${tx_sig}` });
      store.setRefund(tx_sig, refund_tx);
    }
    return { ...verdict, refund_tx };
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
