// The seller gate (Addendum B). Mount it AHEAD of x402's paymentMiddleware: the onBeforeVerify abort path of paymentMiddleware answers 402
// (express/dist/cjs/index.js:236-247), and the refusal here has to be a 403 that tells the agent what is out of scope, before anything settles.
//   IUSSUM_MODE=off      : do nothing (no check, no receipt)
//   IUSSUM_MODE=observe  : run every check, never refuse, sign a receipt that records what was presented
//   IUSSUM_MODE=enforce  : run every check; a violation answers 403 {error:"iussum_out_of_scope", reason, delta} and nothing settles
// After settlement the receipt (seller-signed, carrying mandate_id and grant_tx) goes back in the X-IUSSUM-RECEIPT header.
import { createGrantChecker, scopeViolations, validateMandate, mandateId, signReceipt, receiptKey, offerHash, encodeReceipt, R, fails, registerCheck, isMutated } from '@iussum/core';
import { decodePayment, readPaymentHeader } from './decode.js';
import { openReceiptStore } from './receipt-store.js';

export const SELLER_CHECKS = ['seller.enforce', 'seller.observe_passes', 'seller.off_skips', 'seller.require_mandate', 'seller.receipt_issued', 'seller.receipt_binds_mandate', 'seller.mandate_invalid', 'seller.payment_unreadable', 'seller.payment_source', 'seller.origin_required', 'seller.resource_from_origin', 'seller.one_receipt_per_tx', 'seller.store_receipts', 'seller.no_receipt_on_failed_write', 'seller.grant_budget', 'seller.grant_budget_observe', 'seller.pending_scope'].map(registerCheck);
export const MODES = ['off', 'observe', 'enforce'];

export function createSellerGate(cfg) {
  const { payTo, asset, network, rpc, key = receiptKey(), requireMandate = false, now = () => Math.floor(Date.now() / 1000), log = () => {} } = cfg;
  // The resource is origin + path with the seller's OWN configured origin, never the Host header an agent can choose (Addendum C, fix 5).
  const origin = cfg.origin;
  if (fails('seller.origin_required', typeof origin !== 'string' || !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) throw new Error('createSellerGate: `origin` is required and must be a canonical scheme://host[:port] (no path, no trailing slash), e.g. https://api.example.com');
  let mode = cfg.mode ?? 'enforce';
  if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
  // The grant check inside a request has a time budget (J1): a cold first read of a long history can take minutes on a public RPC, and anyone can lengthen it with
  // dust credits. Past the budget the gate answers 503 with Retry-After and nothing settles; the check keeps running in the background (concurrent requests join it
  // and its progress is kept), so a retry finds it warm.
  const budgetMs = cfg.grantCheckBudgetMs ?? 10_000, retryAfterSeconds = cfg.retryAfterSeconds ?? 5;
  // setTimeout turns a delay above 2^31-1 ms into 1 ms, which would give every payment a 503: refuse such a configuration at start (Addendum M, M5 d)
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 2 ** 31 - 1) throw new Error('createSellerGate: grantCheckBudgetMs must be an integer from 1 to 2147483647');
  if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86_400) throw new Error('createSellerGate: retryAfterSeconds must be an integer from 0 to 86400');
  let checker;
  // ONE receipt per settled transaction (Addendum G, S1): a facilitator that reports success twice for one tx_sig must not make this seller sign a second
  // receipt (that is receipt_equivocation). The first receipt's bytes are returned again. Bounded: least recently used out at 10,000.
  // With cfg.dataDir the issued receipts are also kept in the gate's own SQLite file (H1): written BEFORE the response that carries the receipt is sent, so
  // a repeated success after a restart returns the stored bytes. cfg.receiptStore replaces it (tests). An unreadable or corrupt store stops the start.
  const store = fails('seller.store_receipts', true) ? (cfg.receiptStore ?? (cfg.dataDir ? openReceiptStore(cfg.dataDir) : null)) : null;
  checker = createGrantChecker(rpc, { grantNullRetries: 0, maxScans: cfg.maxConcurrentScans, maxQueuedScans: cfg.maxQueuedScans, maxWarmScans: cfg.maxWarmScans, notFoundTtlMs: cfg.notFoundTtlMs, scanStore: store?.getScan ? { get: (k) => store.getScan(k), put: (k, v) => store.putScan(k, v) } : null });
  const signed = new Map();
  const remember = (tx, bytes) => { signed.delete(tx); signed.set(tx, bytes); if (signed.size > 10_000) signed.delete(signed.keys().next().value); };
  const resourceUrl = (req) => `${fails('seller.resource_from_origin', true) ? origin : `${req.protocol}://${req.get('host')}`}${req.originalUrl.split('?')[0]}`;

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
    const running = checker.check(info.mandate, info.grant_tx, { active: true });
    running.catch(() => {}); // it may finish (or fail) after the request has been answered
    let timer;
    const late = Symbol('pending');
    let g;
    try { g = fails('seller.grant_budget', true) ? await Promise.race([running, new Promise((r) => { timer = setTimeout(() => r(late), budgetMs); timer.unref?.(); })]) : await running; }
    finally { clearTimeout(timer); } // also when the check rejects: no timer is left behind per request
    // pending: the budget ran out, or the check was queued behind too many scans (busy). The scope checks that need no grant still run, so what an observe-mode seller
    // records is not a clean-looking nothing (Addendum M, M5 e).
    if (g === late || g?.busy || g?.pending) {
      out.pending = true;
      if (fails('seller.pending_scope', true)) out.violations.push(...scopeViolations(info.mandate, { amount: out.payment.amount, pay_to: payTo, resource: resourceUrl(req), asset, network, payer: out.payment.authority, time: now() }));
      return out;
    }
    if (!g.ok) out.violations.push({ code: g.reason, field: 'grant', authorized: 'an active ApproveChecked + Memo bound to the mandate id', actual: g.detail });
    // the payment must come out of the granted account, otherwise it is not a payment under this mandate (Addendum C, fix 6)
    else if (fails('seller.payment_source', out.payment.source !== g.source)) out.violations.push({ code: R.grant_mismatch, field: 'source', authorized: g.source, actual: out.payment.source });
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
      if (ev.pending) {
        log({ mode: eff, grant_check: 'pending', budget_ms: budgetMs });
        if (eff === 'enforce' || !fails('seller.grant_budget_observe', true)) return res.status(503).set('Retry-After', String(retryAfterSeconds)).json({ error: 'iussum_grant_check_pending', reason: 'grant_check_pending', retry_after: retryAfterSeconds });
        // observe mode never blocks and never refuses: the payment goes on and the receipt records what was presented, unchecked
      }
      req.iussum = { mode: eff, mandate_id: ev.mandate ? mandateId(ev.mandate) : null, grant_tx: ev.grant_tx, violations: ev.violations, grant_check: ev.pending ? 'pending' : 'checked' };
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
              let bytes = fails('seller.one_receipt_per_tx', true) ? (signed.get(settle.transaction) ?? store?.get(settle.transaction)) : undefined;
              if (!bytes) {
                bytes = encodeReceipt(signReceipt(body, key));
                if (store) { // on disk before the response goes out; if that fails, no receipt is better than one that can conflict later
                  try { bytes = store.put(settle.transaction, bytes); }
                  catch (e) { log({ receipt_error: `receipt store write failed: ${e.message}`, tx_sig: settle.transaction }); if (fails('seller.no_receipt_on_failed_write', true)) bytes = null; }
                }
              }
              if (bytes) {
                remember(settle.transaction, bytes);
                res.setHeader('X-IUSSUM-RECEIPT', bytes);
                req.iussum.receipt_tx = settle.transaction;
              }
            }
          }
        } catch (e) { log({ receipt_error: e.message }); }
        return realWriteHead(status, ...rest);
      };
      return next();
    } catch (e) { return next(e); }
  };

  const wellKnown = (_req, res) => res.json({ v: 'iussum/0.2', seller: key.publicKey, receipt_alg: 'ed25519', pay_to: payTo, asset, network, mode });
  return { middleware, wellKnown, setMode(m) { if (!MODES.includes(m)) throw new Error('bad mode'); mode = m; }, get mode() { return mode; }, publicKey: key.publicKey, key, close() { store?.close?.(); } };
}
