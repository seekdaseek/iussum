// A tiny in-memory chain for the regression tests: transactions in slot order touching a token account, with the JSON-RPC semantics the
// code under test relies on (getSignaturesForAddress newest first, `before` and `until` exclusive, `limit`). Self-contained so the same
// tests run unchanged against commit 222697b and against the fixed code.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { A, SRC, T0, grantTx, payTx } from '../fixtures.mjs';

export const sig = (label) => String(label).padEnd(88, 'x').slice(0, 88);
export function chainSim() {
  const txs = []; // oldest first
  const accounts = new Map();
  const calls = { getTransaction: 0, getSignaturesForAddress: 0, pages: [] };
  const sim = {
    txs, calls, accounts, failPage: null,
    add(label, tx, touches = [SRC]) { txs.push({ sig: sig(label), tx, touches }); return sig(label); },
    setAccount(addr, acct) { accounts.set(addr, acct); },
    async getTransaction(s) { calls.getTransaction++; return txs.find((t) => t.sig === s)?.tx ?? null; },
    async getAccountInfoParsed(addr) { return accounts.get(addr) ?? null; },
    async getSignaturesForAddress(addr, opts = {}) {
      calls.getSignaturesForAddress++; calls.pages.push(opts);
      if (sim.failPage !== null && calls.getSignaturesForAddress === sim.failPage) throw new Error('rpc exploded');
      let list = txs.filter((t) => t.touches.includes(addr)).map((t) => ({ signature: t.sig, slot: t.tx.slot, blockTime: t.tx.blockTime, err: t.tx.meta?.err ?? null })).reverse();
      if (opts.before) { const i = list.findIndex((x) => x.signature === opts.before); if (i >= 0) list = list.slice(i + 1); }
      if (opts.until) { const i = list.findIndex((x) => x.signature === opts.until); if (i >= 0) list = list.slice(0, i); }
      return list.slice(0, opts.limit ?? 1000);
    },
    async call() { throw new Error('unexpected raw rpc call'); },
  };
  return sim;
}
export const live = (m, o = {}) => ({ data: { parsed: { info: { owner: m.principal, mint: m.asset, delegate: m.agent, delegatedAmount: { amount: m.total_cap }, ...o } } } });
export function grantAt(m, slot, o = {}) { const t = grantTx(m, o); t.slot = slot; t.blockTime = T0 + slot; return t; }
export function payAt(slot, o = {}) { return payTx({ slot, blockTime: T0 + slot, ...o }); }
// a top-level SPL token instruction on an account, as jsonParsed getTransaction returns it
export function tokenIx(type, info, slot) {
  return { slot, blockTime: T0 + slot, meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: A.principal, signer: true, writable: true }, { pubkey: SRC, signer: false, writable: true }], instructions: [{ programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type, info } }] } } };
}
