// Chain access and parsing. Everything pure takes jsonParsed getTransaction results, so tests can feed recorded devnet responses.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { fails, registerCheck } from './guard.js';

export const CHAIN_CHECKS = ['history.reconcile', 'allowance.crosscheck', 'chain.self_transfer', 'chain.missing_balance_zero', 'rpc.cache_bound', 'rpc.batch', 'history.min_context'].map(registerCheck);

export function makeRpc(url, { retries = 8, fetchImpl = fetch, stallMs = 90_000, sleep = (ms) => new Promise((res) => setTimeout(res, ms)), now = () => Date.now() } = {}) {
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
  const txCache = new Map(); // LRU, bounded: an outsider must not be able to grow it without limit (Addendum G, T2)
  const CACHE_MAX = 5000;
  const txConfig = (o = {}) => ({ encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed', ...(o.minContextSlot != null ? { minContextSlot: o.minContextSlot } : {}) });
  const keep = (sig, t) => { if (t) { txCache.set(sig, t); if (fails('rpc.cache_bound', txCache.size > CACHE_MAX)) txCache.delete(txCache.keys().next().value); } };
  const rpcObj = {
    url, call,
    async getTransaction(sig, opts = {}) {
      if (txCache.has(sig)) { const v = txCache.get(sig); txCache.delete(sig); txCache.set(sig, v); return v; }
      const cfg = txConfig(opts);
      let t = await call('getTransaction', [sig, cfg]);
      for (let i = 0; i < 6 && !t; i++) { await new Promise((res) => setTimeout(res, 700)); t = await call('getTransaction', [sig, cfg]); }
      keep(sig, t);
      return t;
    },
    // Transactions in JSON-RPC batches (Addendum I, J2): an array of getTransaction requests in ONE POST, `batchSize` per batch (25), at most `concurrency`
    // batches in flight, 429 / 5xx backoff on a batch. Result i belongs to sigs[i]. A null element is retried one by one like getTransaction does (nullRetries 0
    // leaves it null) and stays null if the node still has nothing: the caller treats null as unreadable. An errored element throws: fail closed.
    async getTransactions(sigs, { batchSize = 25, concurrency = 2, minContextSlot = null, nullRetries = 6 } = {}) {
      const out = new Array(sigs.length), todo = [];
      sigs.forEach((sg, i) => { if (txCache.has(sg)) { const v = txCache.get(sg); txCache.delete(sg); txCache.set(sg, v); out[i] = v; } else todo.push(i); });
      const cfg = txConfig({ minContextSlot });
      const chunks = []; for (let i = 0; i < todo.length; i += batchSize) chunks.push(todo.slice(i, i + batchSize));
      // A rate-limited ELEMENT ("Too many requests for a specific RPC call", as the public devnet node answers inside a batch) is retried on its own with backoff while
      // the elements that succeeded are kept; a whole batch that gets HTTP 429 / 5xx is retried; any other errored element throws (fail closed).
      // A read through a rate-limited node can take minutes (the public devnet node answers about 9 elements per 10 s), so patience is measured in TIME without progress,
      // not in rounds: the read gives up (fail closed) only after `maxStall` rounds AND `stallMs` in which no element was answered. All workers of one call share one
      // cooldown, and after a limited round the next request carries only about twice what the last one got answered, so the node is not hammered with what it refuses.
      const maxStall = Math.max(retries, 12), RATE = /rate|limit|too many|429/i;
      let coolUntil = 0;
      async function batch(idx) {
        const results = new Array(idx.length).fill(undefined);
        let pending = idx.map((_, k) => k), stall = 0, limit = pending.length, lastProgress = now();
        while (pending.length) {
          if (coolUntil > now()) await sleep(coolUntil - now());
          const slice = pending.slice(0, limit);
          let answered = 0, retryable = false;
          try {
            const body = slice.map((k) => ({ jsonrpc: '2.0', id: ++id, method: 'getTransaction', params: [sigs[idx[k]], cfg] }));
            const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`rpc http ${r.status}`), { retry: true });
            const j = await r.json();
            if (!Array.isArray(j)) { const m = j?.error?.message ?? 'not an array'; throw Object.assign(new Error(`batch rejected: ${m}`), { retry: RATE.test(m), whole: true }); }
            const byId = new Map(j.map((e) => [e.id, e]));
            const still = [];
            body.forEach((bq, n) => {
              const k = slice[n], e = byId.get(bq.id);
              if (!e) throw new Error(`getTransaction ${sigs[idx[k]]}: no answer in the batch`);
              if (e.error) { if (RATE.test(e.error.message)) still.push(k); else throw new Error(`getTransaction: ${e.error.message}`); }
              else { results[k] = e.result ?? null; answered++; }
            });
            pending = [...still, ...pending.slice(limit)];
            retryable = still.length > 0;
          } catch (e) {
            if (e.whole && !e.retry) { for (const k of pending) results[k] = await rpcObj.getTransaction(sigs[idx[k]], { minContextSlot }); return results; } // a node that refuses batches: one by one
            if (!(e.retry || e.name === 'TypeError')) throw e;
            retryable = true;
          }
          if (!pending.length) break;
          if (answered) { stall = 0; lastProgress = now(); limit = Math.min(pending.length, Math.max(4, answered * 2)); }
          else { stall++; limit = Math.min(limit, 4); if (stall > maxStall && now() - lastProgress >= stallMs) throw new Error('getTransaction: rate limited, no progress'); }
          if (retryable || answered) coolUntil = Math.max(coolUntil, now() + Math.min(5000, 400 * 2 ** Math.min(stall, 4)) * (0.75 + Math.random() / 2));
        }
        return results;
      }
      let next = 0;
      const worker = async () => { while (next < chunks.length) { const ch = chunks[next++]; const res = await batch(ch); ch.forEach((i, k) => { out[i] = res[k]; keep(sigs[i], res[k]); }); } };
      await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
      for (let i = 0; i < sigs.length; i++) if (out[i] === null && nullRetries > 0) out[i] = await rpcObj.getTransaction(sigs[i], { minContextSlot });
      return out;
    },
    async getAccountInfoParsed(addr) { return (await call('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value; },
    // the account together with the slot it was read at (context.slot): the allowance cross-check counts debits up to that slot
    async getAccountContext(addr, opts = {}) { const r = await call('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed', ...(opts.minContextSlot != null ? { minContextSlot: opts.minContextSlot } : {}) }]); return { slot: r.context.slot, value: r.value }; },
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
  return rpcObj;
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
    // SPL Token returns early on a transfer whose source is its destination: nothing moves and the delegated amount is not lowered, so it is
    // neither a debit nor a credit (Addendum F, N3)
    if (!burn && fails('chain.self_transfer', i.source === i.destination)) return;
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
  // a balance entry missing on one side means the account was created (no pre) or closed (no post) in this transaction: it counts as 0 there
  // (Addendum F, N5). CloseAccount needs a zero balance for a token account, and any other mismatch still fails closed.
  const has = (v) => v !== null && v !== undefined;
  const dropped = !b ? 0n : (has(b.pre) && has(b.post)) || fails('chain.missing_balance_zero', true) ? BigInt(b.pre ?? 0) - BigInt(b.post ?? 0) : null;
  return { ok: dropped !== null && dropped === moved, moved, dropped };
}

// Read many transactions: in JSON-RPC batches when the client has them (Addendum I, J2), one by one otherwise. Result i belongs to sigs[i]; a null element is
// returned as null (the callers fail closed on it), an errored one throws. minContextSlot makes every request ask a node that has reached that slot.
export async function readTransactions(rpc, sigs, { minContextSlot = null } = {}) {
  if (!sigs.length) return [];
  if (rpc.getTransactions && fails('rpc.batch', true)) return rpc.getTransactions(sigs, { minContextSlot });
  const out = [];
  for (const sg of sigs) out.push(await rpc.getTransaction(sg, minContextSlot != null ? { minContextSlot } : undefined));
  return out;
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
    if (sigs.size < 2 || [...sigs].every((x) => x in idxOf)) continue;
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
//
// CHECKPOINT (Addendum G, T2). Reading every signature since the grant costs what an outsider wants (dust credits are cheap), so a read is resumable
// and each signature is read once. `checkpoint` is plain JSON the caller keeps per grant:
//   base   = { newest, entries, blockIdx } every signature from the grant up to and including `newest` has been read and reconciled
//   resume = { top, cursor, entries }      a read that stopped early (maxPages, an error): signatures newer than `cursor` down to `top` are done
// The next read continues from `resume.cursor` (older part), promotes it into `base`, then reads only what is newer than `base.newest`. A page counts
// only after it has been read and reconciled completely, the way the supersession scan's `since` advances. Not used with `stopAtTime`.
export async function agentSpendHistory(rpc, { source, agent, mint, until = null, stopAtTime = null, pageSize = 100, maxPages = 1000, checkpoint = null, minContextSlot = null }) {
  const mcs = fails('history.min_context', true) && minContextSlot != null ? { minContextSlot } : {}; // Addendum I, I3: ask a node that has caught up with the expiry proof
  const idxOf = { ...(checkpoint?.base?.blockIdx ?? {}) };
  let base = checkpoint?.base ? { newest: checkpoint.base.newest, entries: [...checkpoint.base.entries] } : null;
  let resume = checkpoint?.resume ? { ...checkpoint.resume, entries: [...checkpoint.resume.entries] } : null;
  let pagesLeft = maxPages, reason = null, complete = false;
  const floor = () => base?.newest ?? until;
  async function walk({ before, floorSig, cut }) {
    const got = []; let first, cursor = before, done = false, err = null;
    try {
      for (;;) {
        if (pagesLeft <= 0) { err = `more than ${maxPages} pages`; break; }
        pagesLeft--;
        const page = await rpc.getSignaturesForAddress(source, { limit: pageSize, ...(floorSig ? { until: floorSig } : {}), ...(cursor ? { before: cursor } : {}), ...mcs });
        const batch = [];
        const listed = page.filter((x) => !x.err);
        const txs = await readTransactions(rpc, listed.map((x) => x.signature), mcs);
        for (const [k, sg] of listed.entries()) {
          const p = parsePayment(txs[k]);
          if (!p.found) throw new Error(`transaction ${sg.signature} could not be read`);
          if (p.err) continue;
          const rec = fails('history.reconcile', true) ? reconcileAccount(p, source) : { ok: true };
          if (!rec.ok) throw new Error(`transaction ${sg.signature}: the parsed instructions move ${rec.moved} out of the account but its balance changed by ${rec.dropped}`);
          for (const d of p.debits) if (d.source === source && d.authority === agent && d.mint === mint) batch.push({ tx_sig: sg.signature, slot: p.slot, block_time: p.block_time, amount: d.amount, kind: d.kind, top: d.top, pos: d.pos, dest_owner: d.dest_owner, signatures: p.signatures });
        }
        got.push(...batch); // the page is done: only now does the cursor move
        if (first === undefined && before === undefined && page.length) first = page[0].signature;
        if (page.length) cursor = page[page.length - 1].signature;
        if (page.length < pageSize) { done = true; break; }
        const oldest = page[page.length - 1];
        if (cut != null && oldest.blockTime != null && oldest.blockTime < cut) { done = true; break; }
      }
    } catch (e) { err = e.message; }
    return { got, first, cursor, done, err };
  }
  if (resume) { // 1. finish the older part a previous read left behind
    const w = await walk({ before: resume.cursor, floorSig: floor() });
    resume = { ...resume, cursor: w.cursor, entries: [...resume.entries, ...w.got] };
    if (w.done) { base = { newest: resume.top, entries: [...(base?.entries ?? []), ...resume.entries] }; resume = null; }
    else reason = w.err;
  }
  let all = base ? [...base.entries] : [];
  if (!resume) { // 2. read what is newer than the base (or everything, when there is none)
    const w = await walk({ before: undefined, floorSig: floor(), cut: checkpoint ? null : stopAtTime });
    if (w.done) { all = [...all, ...w.got]; base = { newest: w.first ?? base?.newest ?? null, entries: all }; complete = true; }
    else { reason = w.err; if (w.cursor !== undefined && w.first !== undefined) resume = { top: w.first, cursor: w.cursor, entries: w.got }; }
  }
  let entries = all;
  if (complete) {
    try { await fillBlockIndices(rpc, all, idxOf); all.sort((a, b) => comparePositions(a, b, idxOf)); entries = all; }
    catch (e) { reason = e.message; complete = false; entries = [...all].sort((a, b) => a.slot - b.slot || a.pos - b.pos); }
  }
  const outBase = base ? { newest: base.newest, entries: base.entries, blockIdx: idxOf } : null;
  return { entries, complete, reason, blockIdx: idxOf, checkpoint: { base: outBase, resume } };
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
