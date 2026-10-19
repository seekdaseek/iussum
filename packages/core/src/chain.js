// Chain access and parsing. Everything pure takes jsonParsed getTransaction results, so tests can feed recorded devnet responses.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { fails, registerCheck } from './guard.js';

export const CHAIN_CHECKS = ['history.reconcile', 'allowance.crosscheck'].map(registerCheck);

export function makeRpc(url, { retries = 8, fetchImpl = fetch } = {}) {
  let id = 0;
  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`rpc http ${r.status}`), { retry: true });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message}`), { retry: /rate|limit|too many|429/i.test(j.error.message) });
        return j.result;
      } catch (e) {
        if (attempt >= retries || !(e.retry || e.name === 'TypeError')) throw e;
        await new Promise((res) => setTimeout(res, Math.min(5000, 400 * 2 ** attempt) * (0.75 + Math.random() / 2)));
      }
    }
  }
  const txCache = new Map();
  return {
    url, call,
    async getTransaction(sig) {
      if (txCache.has(sig)) return txCache.get(sig);
      let t = await call('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      for (let i = 0; i < 6 && !t; i++) { await new Promise((res) => setTimeout(res, 700)); t = await call('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); }
      if (t) txCache.set(sig, t);
      return t;
    },
    async getAccountInfoParsed(addr) { return (await call('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value; },
    // the account together with the slot it was read at (context.slot): the allowance cross-check counts debits up to that slot
    async getAccountContext(addr) { const r = await call('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }]); return { slot: r.context.slot, value: r.value }; },
    // the signatures of one block in execution order (the transaction's index in the block orders payments within a slot)
    async getBlockSignatures(slot) {
      const b = await call('getBlock', [slot, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      if (!b || !Array.isArray(b.signatures)) throw new Error(`block ${slot} could not be read`);
      return b.signatures;
    },
    // `until`/`before` name a signature; a freshly confirmed one may not be in this node's signature index yet ("Transaction ... not found"),
    // so that one error is retried for a few seconds. Any other error, or the same error after the retries, propagates (callers fail closed).
    async getSignaturesForAddress(addr, opts = {}) {
      for (let attempt = 0; ; attempt++) {
        try { return await call('getSignaturesForAddress', [addr, { commitment: 'confirmed', ...opts }]); }
        catch (e) { if (attempt >= 8 || !/Transaction .* not found/i.test(e.message)) throw e; await new Promise((res) => setTimeout(res, 800)); }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Debits (Addendum E, B1). A token account can lose funds through four SPL Token instructions: transfer, transferChecked, burn, burnChecked,
// at the top level or by CPI (meta.innerInstructions). Any of them signed by the delegate lowers the allowance. ONE parser reads them all,
// in execution order (a top-level instruction, then the instructions it made by CPI), so nothing that reduces the account can be missed.
const DEBIT_TYPES = new Set(['transfer', 'transferChecked', 'burn', 'burnChecked']);
const POS_STEP = 10000; // position = top-level index * POS_STEP + (0 for the instruction itself, 1 + j for its j-th inner instruction)
export function parseDebits(tx) {
  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => k.pubkey);
  const bal = (list) => { const m = new Map(); for (const b of list ?? []) m.set(keys[b.accountIndex], b); return m; };
  const post = bal(tx.meta?.postTokenBalances), pre = bal(tx.meta?.preTokenBalances);
  const mintOf = (acct) => post.get(acct)?.mint ?? pre.get(acct)?.mint ?? null;
  const ownerOf = (acct) => post.get(acct)?.owner ?? pre.get(acct)?.owner ?? null;
  const out = [];
  const read = (ix, top, pos) => {
    if (ix.programId !== TOKEN_PROGRAM_ADDRESS || !DEBIT_TYPES.has(ix.parsed?.type)) return;
    const i = ix.parsed.info ?? {}, kind = ix.parsed.type;
    const burn = kind === 'burn' || kind === 'burnChecked';
    const source = burn ? i.account : i.source;
    const amount = i.tokenAmount?.amount ?? i.amount;
    out.push({ kind, source, destination: burn ? null : i.destination, mint: i.mint ?? mintOf(source), amount: String(amount), decimals: i.tokenAmount?.decimals ?? null, authority: i.authority ?? i.multisigAuthority ?? null, top, pos, dest_owner: burn ? null : ownerOf(i.destination), source_owner: ownerOf(source) });
  };
  const inner = new Map((tx.meta?.innerInstructions ?? []).map((g) => [g.index, g.instructions ?? []]));
  (tx.transaction?.message?.instructions ?? []).forEach((ix, n) => {
    read(ix, true, n * POS_STEP);
    (inner.get(n) ?? []).forEach((c, j) => read(c, false, n * POS_STEP + 1 + j));
  });
  return out;
}
// Balance of every token account the transaction touched: { account: { pre, post } } (atomic units, strings).
function balancesOf(tx) {
  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => k.pubkey);
  const out = {};
  for (const [when, list] of [['pre', tx.meta?.preTokenBalances], ['post', tx.meta?.postTokenBalances]]) for (const b of list ?? []) (out[keys[b.accountIndex]] ??= {})[when] = b.uiTokenAmount?.amount ?? null;
  return out;
}
// Reconcile one transaction against the balance of `account` (Addendum E, B1b): what the parsed instructions say left the account must equal
// the account's balance drop between preTokenBalances and postTokenBalances. A mismatch means the parser did not see everything that moved.
export function reconcileAccount(payment, account) {
  const moved = payment.debits.filter((d) => d.source === account).reduce((a, d) => a + BigInt(d.amount), 0n)
    - payment.credits.filter((c) => c.destination === account).reduce((a, c) => a + BigInt(c.amount), 0n);
  const b = payment.balances[account];
  const dropped = b ? (b.pre !== null && b.pre !== undefined && b.post !== null && b.post !== undefined ? BigInt(b.pre) - BigInt(b.post) : null) : 0n;
  return { ok: dropped !== null && dropped === moved, moved, dropped };
}

// Parse the token movements of one transaction. destination owner comes from postTokenBalances (accountIndex -> owner).
//   transfers : the top-level TransferChecked instructions (what an x402 payment is)
//   debits    : EVERY transfer/transferChecked/burn/burnChecked, top level and CPI, in execution order
//   credits   : the transfers INTO an account (so a reconcile of an account that also received funds in the same transaction adds up)
//   balances  : { account: { pre, post } }
export function parsePayment(tx) {
  if (!tx || !tx.transaction) return { found: false };
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const owners = new Map();
  for (const b of tx.meta?.postTokenBalances ?? []) owners.set(keys[b.accountIndex], b.owner);
  const transfers = [];
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId !== TOKEN_PROGRAM_ADDRESS || ix.parsed?.type !== 'transferChecked') continue;
    const i = ix.parsed.info;
    transfers.push({ source: i.source, destination: i.destination, mint: i.mint, authority: i.authority ?? i.multisigAuthority, amount: i.tokenAmount.amount, decimals: i.tokenAmount.decimals, dest_owner: owners.get(i.destination) ?? null, source_owner: owners.get(i.source) ?? null });
  }
  const debits = parseDebits(tx);
  const credits = debits.filter((d) => d.destination);
  return { found: true, err: tx.meta?.err ?? null, slot: tx.slot, block_time: tx.blockTime ?? null, signatures: tx.transaction.signatures ?? [], transfers, debits, credits, balances: balancesOf(tx) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Position in the chain (Addendum E, S7). Two transactions in one slot are ordered by their index in the block, then by instruction position;
// never by signature string, which the agent controls. A comparison that cannot be decided (same slot, block order unknown) throws, and callers
// fail closed.
export class PositionUnknown extends Error { constructor(m) { super(m); this.name = 'PositionUnknown'; } }
// items: [{ slot, tx_sig, pos?, idx? }]. Reads the block of every slot that holds more than one distinct transaction and sets idx.
// `idxOf` is an object sig -> idx that is filled in (shared by everything compared later).
const blockCache = new WeakMap();
export async function fillBlockIndices(rpc, items, idxOf = {}) {
  const bySlot = new Map();
  for (const it of items) { if (!bySlot.has(it.slot)) bySlot.set(it.slot, new Set()); bySlot.get(it.slot).add(it.tx_sig); }
  for (const [slot, sigs] of bySlot) {
    if (sigs.size < 2) continue;
    if (!rpc.getBlockSignatures) throw new PositionUnknown(`block ${slot} holds ${sigs.size} relevant transactions and this rpc cannot read blocks`);
    let cache = blockCache.get(rpc); if (!cache) blockCache.set(rpc, (cache = new Map()));
    if (!cache.has(slot)) cache.set(slot, rpc.getBlockSignatures(slot));
    let list;
    try { list = await cache.get(slot); } catch (e) { cache.delete(slot); throw new PositionUnknown(`block ${slot} could not be read: ${e.message}`); }
    for (const s of sigs) {
      const n = list.indexOf(s);
      if (n < 0) throw new PositionUnknown(`${s} is not in block ${slot}`);
      idxOf[s] = n;
    }
  }
  return idxOf;
}
// a, b = { slot, tx_sig, pos? }. Negative: a executed before b.
export function comparePositions(a, b, idxOf = {}) {
  if (a.slot !== b.slot) return a.slot - b.slot;
  if (a.tx_sig === b.tx_sig) return (a.pos ?? 0) - (b.pos ?? 0);
  const [x, y] = [idxOf[a.tx_sig], idxOf[b.tx_sig]];
  if (x === undefined || y === undefined) throw new PositionUnknown(`${a.tx_sig} and ${b.tx_sig} are in slot ${a.slot} and their order is not known`);
  return x - y;
}
export const isAfter = (a, b, idxOf) => comparePositions(a, b, idxOf) > 0;

// ---------------------------------------------------------------------------------------------------------------------------------------
// Agent spend history from chain: every debit out of `source` signed by `agent`, successful transactions only, in execution order.
// PAGINATED (Addendum C, fix 2): getSignaturesForAddress is newest first, so page with `before` until the history reaches the grant
// (`until`) or the start of the period of interest (`stopAtTime`: the oldest signature on the page is older than it). `complete` says
// whether that was shown. NOTHING is skipped silently (Addendum E, B1): a listed signature whose transaction cannot be read, a transaction
// whose parsed movements do not add up to the balance change of `source`, a page that cannot be read, too many pages, or a block that
// cannot be read all give complete:false with the reason. Never treat an incomplete history as complete.
export async function agentSpendHistory(rpc, { source, agent, mint, until = null, stopAtTime = null, pageSize = 100, maxPages = 1000 }) {
  const out = [], idxOf = {};
  let before, complete = false, reason = null;
  try {
    for (let pages = 0; ; pages++) {
      if (pages >= maxPages) { reason = `more than ${maxPages} pages`; break; }
      const page = await rpc.getSignaturesForAddress(source, { limit: pageSize, ...(until ? { until } : {}), ...(before ? { before } : {}) });
      for (const s of page) {
        if (s.err) continue;
        const tx = await rpc.getTransaction(s.signature);
        const p = parsePayment(tx);
        if (!p.found) throw new Error(`transaction ${s.signature} could not be read`);
        if (p.err) continue;
        const rec = fails('history.reconcile', true) ? reconcileAccount(p, source) : { ok: true };
        if (!rec.ok) throw new Error(`transaction ${s.signature}: the parsed instructions move ${rec.moved} out of the account but its balance changed by ${rec.dropped}`);
        for (const d of p.debits) if (d.source === source && d.authority === agent && d.mint === mint) out.push({ tx_sig: s.signature, slot: p.slot, block_time: p.block_time, amount: d.amount, kind: d.kind, top: d.top, pos: d.pos, dest_owner: d.dest_owner, signatures: p.signatures });
      }
      if (page.length < pageSize) { complete = true; break; }
      const oldest = page[page.length - 1];
      if (stopAtTime !== null && oldest.blockTime != null && oldest.blockTime < stopAtTime) { complete = true; break; }
      before = oldest.signature;
    }
    if (complete) {
      await fillBlockIndices(rpc, out, idxOf);
      out.sort((a, b) => comparePositions(a, b, idxOf));
    }
  } catch (e) { reason = e.message; complete = false; }
  return { entries: complete ? out : out.sort((a, b) => a.slot - b.slot || a.pos - b.pos), complete, reason, blockIdx: idxOf };
}

// The allowance cross-check (Addendum E, C1). The token program lowers the delegated amount in the same instruction that moves the funds, so
// while the grant is current the agent's debits since the grant must add up to total_cap minus what the source account still has delegated.
//   entries : the agent's debits since the grant (execution order); only those at or before `slot` are counted (the slot the account was read at)
//   account : the source account as getAccountInfo(jsonParsed) returns it
// A delegate that is gone (the allowance ran out) means 0 left. A different delegate is not explained by the debits: not ok.
export function allowanceCheck({ mandate, entries, account, slot }) {
  const info = account?.data?.parsed?.info;
  if (!info) return { ok: false, why: 'the source account could not be read' };
  let left;
  if (info.delegate === mandate.agent) left = BigInt(info.delegatedAmount?.amount ?? 0);
  else if (info.delegate == null) left = 0n;
  else return { ok: false, why: `the account's delegate is ${info.delegate}, not the agent, yet no superseding instruction was found` };
  const expected = BigInt(mandate.total_cap) - left;
  const actual = entries.filter((e) => e.slot <= slot).reduce((a, e) => a + BigInt(e.amount), 0n);
  return { ok: fails('allowance.crosscheck', expected !== actual) === false, expected, actual, left, slot };
}

// Decimals come from the mint account, not from a constant (Addendum C, fix 11).
export async function mintDecimals(rpc, mint) {
  const acct = await rpc.getAccountInfoParsed(mint);
  const d = acct?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(d) || d < 0 || d > 255) throw new Error(`cannot read the decimals of mint ${mint}`);
  return d;
}
