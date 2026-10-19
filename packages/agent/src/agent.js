// The agent wrapper (Addendum B). It carries the mandate and the grant_tx with every x402 payment (extensions.iussum.info) and refuses locally,
// BEFORE signing, when a payment would break the mandate: grant check (incl. still-active), window, per-payment cap, pay_to and resource
// allow-lists, asset, network, and its own running period spend (the period budget is the agent's to keep: a seller cannot see other sellers'
// payments). localChecks:false builds a "naive" agent for the demo's controls.
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { createGrantChecker, scopeViolations, mandateId, periodIndex, decodeReceipt, R, fails, isMutated, registerCheck, principalAta, assertMandate } from '@iussum/core';
import { pipe, createTransactionMessage, setTransactionMessageFeePayer, appendTransactionMessageInstructions, setTransactionMessageLifetimeUsingBlockhash, partiallySignTransactionMessageWithSigners, compileTransaction, getBase64EncodedWireTransaction, getTransactionEncoder } from '@solana/kit';
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { assertOnlyComputeBudgetChanged } from './txguard.js';

export const AGENT_CHECKS = ['agent.grant', 'agent.scope', 'agent.period', 'agent.tx_guard', 'agent.attach_mandate', 'agent.ledger'].map(registerCheck);
const MARK = 'IUSSUM_REFUSAL:';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export class IussumRefusal extends Error {
  constructor(reason, delta) { super(`iussum refuses to pay: ${reason}`); this.name = 'IussumRefusal'; this.reason = reason; this.delta = delta; }
}
const cb = (data) => ({ programAddress: COMPUTE_BUDGET, accounts: [], data: Uint8Array.from(data) });
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

export async function createAgent(cfg) {
  const { mandate, grant_tx, signer, rpc, localChecks = true, attachMandate: wantAttach = true, now = () => Math.floor(Date.now() / 1000) } = cfg;
  if (mandate) assertMandate(mandate);
  // localChecks: true (full), 'caps' (payer-side caps only: per-payment and period amounts, no allow-lists, no grant check, no mandate attached), false (naive)
  const capsOnly = localChecks === 'caps';
  const attachMandate = wantAttach && !capsOnly;
  const checker = createGrantChecker(rpc);
  const source = mandate ? await principalAta(mandate.principal, mandate.asset) : cfg.source;
  const ledger = []; // [{amount, t}] successful payments of this agent
  const getBlockhash = cfg.getBlockhash ?? (async () => { const v = (await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }])).value; return { blockhash: v.blockhash, lastValidBlockHeight: BigInt(v.lastValidBlockHeight) }; });
  const sign = cfg.sign ?? partiallySignTransactionMessageWithSigners;
  let pending = null;

  const spentThisPeriod = (t) => ledger.filter((x) => periodIndex(mandate, x.t) === periodIndex(mandate, t)).reduce((a, x) => a + BigInt(x.amount), 0n);

  const scheme = {
    scheme: 'exact',
    async createPaymentPayload(x402Version, req) {
      const bh = req.extra?.recentBlockhash ? { blockhash: req.extra.recentBlockhash, lastValidBlockHeight: BigInt(req.extra.lastValidBlockHeight ?? 0) } : await getBlockhash();
      const ix = getTransferCheckedInstruction({ source, mint: req.asset, destination: req.destination ?? (await destinationAta(req.payTo, req.asset)), authority: signer, amount: BigInt(req.amount), decimals: 6 }, { programAddress: TOKEN_PROGRAM_ADDRESS });
      const memo = { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: new TextEncoder().encode(Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')) };
      const built = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayer(req.extra.feePayer, m), (m) => appendTransactionMessageInstructions([cb([2, ...u32(20_000)]), cb([3, 1, 0, 0, 0, 0, 0, 0, 0]), ix, memo], m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m));
      const sent = Buffer.from(getTransactionEncoder().encode(compileTransaction(built))).toString('base64');
      const signed = getBase64EncodedWireTransaction(await sign(built));
      // whatever signs this transaction may add ComputeBudget instructions and nothing else (copied x402-wallet guard)
      if (fails('agent.tx_guard', true)) assertOnlyComputeBudgetChanged(sent, signed);
      pending = { amount: req.amount, payTo: req.payTo };
      return { x402Version, payload: { transaction: signed } };
    },
  };
  const destCache = new Map();
  async function destinationAta(owner, mint) {
    const k = `${owner}:${mint}`;
    if (!destCache.has(k)) destCache.set(k, await principalAta(owner, mint));
    return destCache.get(k);
  }

  const client = new x402Client();
  client.setSpendControls(false); // the custom scheme has no default-asset table; the mandate is the spend control here
  client.register(cfg.network ?? mandate.network, scheme);
  if (mandate && attachMandate && !isMutated('agent.attach_mandate')) {
    client.registerExtension({ key: 'iussum', enrichPaymentPayload: async (p) => ({ ...p, extensions: { ...(p.extensions ?? {}), iussum: { info: { mandate, grant_tx } } } }) });
  }
  if (localChecks && mandate) {
    client.onBeforePaymentCreation(async (ctx) => {
      const r = ctx.selectedRequirements, url = ctx.paymentRequired.resource?.url;
      const t = now();
      const g = capsOnly ? { ok: true } : await checker.check(mandate, grant_tx, { active: true });
      let reason = null, delta = [];
      if (fails('agent.grant', !g.ok)) { reason = g.reason; delta = [{ field: 'grant', authorized: 'an active ApproveChecked + Memo bound to the mandate id', actual: g.detail }]; }
      if (!reason) {
        delta = scopeViolations(mandate, { amount: r.amount, pay_to: r.payTo, resource: url, asset: r.asset, network: r.network, payer: signer.address, time: t });
        if (capsOnly) delta = delta.filter((d) => d.code === R.amount_over_cap);
        if (fails('agent.scope', delta.length > 0)) reason = delta[0].code; else delta = [];
      }
      if (!reason) {
        const spent = fails('agent.ledger', true) ? spentThisPeriod(t) : 0n;
        if (fails('agent.period', spent + BigInt(r.amount) > BigInt(mandate.period_budget))) { reason = R.period_over_budget; delta = [{ code: R.period_over_budget, field: 'period_budget', authorized: mandate.period_budget, actual: `${spent} already spent in this period, +${r.amount}` }]; }
      }
      if (reason) return { abort: true, reason: MARK + JSON.stringify({ reason, delta }) };
    });
  }
  const wrapped = wrapFetchWithPayment(fetch, client);
  async function pay(url, init) {
    pending = null;
    let res;
    try { res = await wrapped(url, init); }
    catch (e) {
      const i = String(e.message).indexOf(MARK);
      if (i >= 0) { const j = JSON.parse(e.message.slice(i + MARK.length)); throw new IussumRefusal(j.reason, j.delta); }
      throw e;
    }
    const pr = res.headers.get('payment-response');
    if (pr && pending && res.status < 400 && JSON.parse(Buffer.from(pr, 'base64').toString('utf8')).success) ledger.push({ amount: pending.amount, t: now() });
    const rh = res.headers.get('x-iussum-receipt');
    res.receipt = rh ? decodeReceipt(rh) : null;
    return res;
  }
  return { fetch: pay, client, ledger, source, mandateId: mandate ? mandateId(mandate) : null, address: signer.address };
}
