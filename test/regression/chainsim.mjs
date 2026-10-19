// A tiny in-memory chain for the regression tests: transactions in slot order touching a token account, with the JSON-RPC semantics the
// code under test relies on (getSignaturesForAddress newest first, `before` and `until` exclusive, `limit`). Self-contained so the same
// tests run unchanged against commit 222697b and against the fixed code.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { A, SRC, T0, grantTx, payTx } from '../fixtures.mjs';

export const sig = (label) => String(label).padEnd(88, 'x').slice(0, 88);
export function chainSim() {
  const txs = []; // oldest first
  const accounts = new Map();
  const calls = { getTransaction: 0, getSignaturesForAddress: 0, pages: [], blocks: [] };
  // live() accounts are consistent with the chain: the delegated amount is the cap minus what the agent has taken since the grant
  function account(addr) {
    const a = accounts.get(addr) ?? null;
    if (!a?._auto) return a;
    const info = a.data.parsed.info;
    const g = txs.map((t) => t.tx.transaction.message.instructions).findLastIndex((ixs) => ixs.some((i) => i.parsed?.type === 'approveChecked' && i.parsed.info.delegate === info.delegate));
    let taken = 0n;
    // what the token program took off the allowance: every delegate-signed transfer or burn out of the account, top level or by CPI
    for (const t of txs.slice(g + 1)) for (const i of [...t.tx.transaction.message.instructions, ...(t.tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)]) {
      const f = i.parsed?.info, ty = i.parsed?.type;
      if (!f || f.authority !== info.delegate || !['transfer', 'transferChecked', 'burn', 'burnChecked'].includes(ty) || (f.source ?? f.account) !== addr) continue;
      taken += BigInt(f.tokenAmount?.amount ?? f.amount);
    }
    return { ...a, data: { parsed: { info: { ...info, delegatedAmount: { amount: String(BigInt(a._cap) - taken) } } } } };
  }
  const sim = {
    txs, calls, accounts, failPage: null, contextSlot: null, hiddenBlocks: new Set(), hideFromListing: new Set(),
    add(label, tx, touches = [SRC]) { txs.push({ sig: sig(label), tx, touches }); return sig(label); },
    setAccount(addr, acct) { accounts.set(addr, acct); },
    async getTransaction(s) { calls.getTransaction++; return txs.find((t) => t.sig === s)?.tx ?? null; },
    async getAccountInfoParsed(addr) { return account(addr); },
    // account state with the slot it was read at (the newest slot on the simulated chain unless a test sets sim.contextSlot)
    async getAccountContext(addr) { return { slot: sim.contextSlot ?? Math.max(0, ...txs.map((t) => t.tx.slot)), value: account(addr) }; },
    // signatures of one block in execution order: the simulated chain keeps insertion order within a slot
    async getBlockSignatures(slot) { calls.blocks.push(slot); if (sim.hiddenBlocks.has(slot)) throw new Error(`block ${slot} not available`); return txs.filter((t) => t.tx.slot === slot).map((t) => t.sig); },
    async getSignaturesForAddress(addr, opts = {}) {
      calls.getSignaturesForAddress++; calls.pages.push(opts);
      if (sim.failPage !== null && calls.getSignaturesForAddress === sim.failPage) throw new Error('rpc exploded');
      let list = txs.filter((t) => t.touches.includes(addr) && !sim.hideFromListing.has(t.sig)).map((t) => ({ signature: t.sig, slot: t.tx.slot, blockTime: t.tx.blockTime, err: t.tx.meta?.err ?? null })).reverse();
      if (opts.before) { const i = list.findIndex((x) => x.signature === opts.before); if (i >= 0) list = list.slice(i + 1); }
      if (opts.until) { const i = list.findIndex((x) => x.signature === opts.until); if (i >= 0) list = list.slice(0, i); }
      return list.slice(0, opts.limit ?? 1000);
    },
    async call() { throw new Error('unexpected raw rpc call'); },
  };
  return sim;
}
export const live = (m, o = {}) => ({ ...('delegatedAmount' in o ? {} : { _auto: true, _cap: m.total_cap }), data: { parsed: { info: { owner: m.principal, mint: m.asset, delegate: m.agent, delegatedAmount: { amount: m.total_cap }, ...o } } } });
export function grantAt(m, slot, o = {}) { const t = grantTx(m, o); t.slot = slot; t.blockTime = T0 + slot; return t; }
export function payAt(slot, o = {}) { return payTx({ slot, blockTime: T0 + slot, ...o }); }
// a top-level SPL token instruction on an account, as jsonParsed getTransaction returns it
export function tokenIx(type, info, slot) {
  return { slot, blockTime: T0 + slot, meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: A.principal, signer: true, writable: true }, { pubkey: SRC, signer: false, writable: true }], instructions: [{ programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type, info } }] } } };
}
