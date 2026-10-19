// The seller gate (Addendum B). Mount it AHEAD of x402's paymentMiddleware: the onBeforeVerify abort path of paymentMiddleware answers 402
// (express/dist/cjs/index.js:236-247), and the refusal here has to be a 403 that tells the agent what is out of scope, before anything settles.
//   IUSSUM_MODE=off      : do nothing (no check, no receipt)
//   IUSSUM_MODE=observe  : run every check, never refuse, sign a receipt that records what was presented
//   IUSSUM_MODE=enforce  : run every check; a violation answers 403 {error:"iussum_out_of_scope", reason, delta} and nothing settles
// After settlement the receipt (seller-signed, carrying mandate_id and grant_tx) goes back in the X-IUSSUM-RECEIPT header.
import { createGrantChecker, scopeViolations, validateMandate, mandateId, signReceipt, receiptKey, offerHash, encodeReceipt, R, fails, registerCheck, isMutated } from '@iussum/core';
import { decodePayment, readPaymentHeader } from './decode.js';

export const SELLER_CHECKS = ['seller.enforce', 'seller.observe_passes', 'seller.off_skips', 'seller.require_mandate', 'seller.receipt_issued', 'seller.receipt_binds_mandate', 'seller.mandate_invalid', 'seller.payment_unreadable'].map(registerCheck);
export const MODES = ['off', 'observe', 'enforce'];

export function createSellerGate(cfg) {
  const { payTo, asset, network, rpc, key = receiptKey(), requireMandate = false, now = () => Math.floor(Date.now() / 1000), log = () => {} } = cfg;
  let mode = cfg.mode ?? 'enforce';
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  const checker = createGrantChecker(rpc);
  const resourceUrl = cfg.resourceUrl ?? ((req) => `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`);

  async function evaluate(req, payload) {
    const out = { mandate: null, grant_tx: null, violations: [], payment: null };
    const info = payload.extensions?.iussum?.info;
    try { out.payment = decodePayment(payload.payload?.transaction); } catch (e) { if (fails('seller.payment_unreadable', true)) out.violations.push({ code: R.tx_mismatch, field: 'payment', authorized: 'one readable TransferChecked', actual: e.message }); return out; }
    if (!info?.mandate) {
      if (fails('seller.require_mandate', requireMandate)) out.violations.push({ code: R.mandate_missing, field: 'mandate', authorized: 'a mandate with a grant', actual: 'none presented' });
      return out;
    }
    out.mandate = info.mandate; out.grant_tx = info.grant_tx ?? null;
    const errs = validateMandate(info.mandate);
    if (fails('seller.mandate_invalid', errs.length > 0)) { out.violations.push({ code: R.mandate_invalid, field: 'mandate', authorized: 'valid', actual: errs.join('; ') }); return out; }
    const g = await checker.check(info.mandate, info.grant_tx, { active: true });
    if (!g.ok) out.violations.push({ code: g.reason, field: 'grant', authorized: 'an active ApproveChecked + Memo bound to the mandate id', actual: g.detail });
    out.violations.push(...scopeViolations(info.mandate, { amount: out.payment.amount, pay_to: payTo, resource: resourceUrl(req), asset, network, payer: out.payment.authority, time: now() }));
    return out;
  }

  const middleware = async (req, res, next) => {
    try {
      const eff = mode === 'off' && isMutated('seller.off_skips') ? 'enforce' : mode; // mutation: off behaves like enforce
      if (eff === 'off') return next();
      const payload = readPaymentHeader(req);
      if (!payload) return next(); // no payment yet: x402 issues the 402 challenge
      const ev = await evaluate(req, payload);
      req.iussum = { mode: eff, mandate_id: ev.mandate ? mandateId(ev.mandate) : null, grant_tx: ev.grant_tx, violations: ev.violations };
      const refuse = ev.violations.length > 0 && (eff === 'enforce' ? !isMutated('seller.enforce') : eff === 'observe' && isMutated('seller.observe_passes'));
      if (ev.violations.length) log({ mode: eff, refuse, reason: ev.violations[0].code, resource: resourceUrl(req) });
      if (refuse) return res.status(403).json({ error: 'iussum_out_of_scope', reason: ev.violations[0].code, delta: ev.violations.map(({ field, authorized, actual, code }) => ({ code, field, authorized, actual })) });
      // sign the receipt once x402 has settled: x402 replays the buffered writeHead after it set PAYMENT-RESPONSE
      const realWriteHead = res.writeHead.bind(res);
      res.writeHead = function (status, ...rest) {
        try {
          const pr = res.getHeader('payment-response');
          if (pr && status < 400 && fails('seller.receipt_issued', true)) {
            const settle = JSON.parse(Buffer.from(String(pr), 'base64').toString('utf8'));
            if (settle.success && settle.transaction) {
              const bind = fails('seller.receipt_binds_mandate', true) && ev.mandate && ev.grant_tx;
              const body = { v: 'iussum/0.2', mandate_id: bind ? mandateId(ev.mandate) : null, grant_tx: bind ? ev.grant_tx : null, offer_hash: offerHash(payload.accepted ?? {}), resource: resourceUrl(req), pay_to: payTo, asset, network, amount: ev.payment.amount, payer: ev.payment.authority, tx_sig: settle.transaction, settled_at: now(), seller: key.publicKey };
              res.setHeader('X-IUSSUM-RECEIPT', encodeReceipt(signReceipt(body, key)));
              req.iussum.receipt_tx = settle.transaction;
            }
          }
        } catch (e) { log({ receipt_error: e.message }); }
        return realWriteHead(status, ...rest);
      };
      return next();
    } catch (e) { return next(e); }
  };

  const wellKnown = (_req, res) => res.json({ v: 'iussum/0.2', seller: key.publicKey, receipt_alg: 'ed25519', pay_to: payTo, asset, network, mode });
  return { middleware, wellKnown, setMode(m) { if (!MODES.includes(m)) throw new Error('bad mode'); mode = m; }, get mode() { return mode; }, publicKey: key.publicKey, key };
}
