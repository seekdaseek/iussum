// Grant check (Addendum B). One function, used by agent, seller and resolver.
//   inspectGrantTx: pure on a jsonParsed getTransaction result. err null, the principal is the only signer and the fee payer,
//     exactly one ApproveChecked (owner, delegate, mint, amount, source = principal's ATA) that equals the mandate, exactly one
//     Memo equal byte for byte to summaryLine(mandate), every other instruction is ComputeBudget. Seed Vault appends ComputeBudget
//     instructions (observed on devnet in T1, 5gUy9rev...), so those are allowed and nothing else is.
//   inspectGrantActive: pure on the source account NOW: delegate is still the agent and the delegated amount is above 0.
// Pattern copied in spirit from x402-wallet src/svm/verify.js (assertOnlyComputeBudgetChanged: everything except ComputeBudget must
// be identical) and nuntius core/tx-check.ts (allow-listed programs only, values must equal what the person saw). The originals are untouched.
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { fails, registerCheck } from './guard.js';
import { R } from './codes.js';
import { summaryLine, mandateId } from './mandate.js';
import { fillBlockIndices, comparePositions, readTransactions } from './chain.js';

export const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export const MEMO_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const GRANT_CHECKS = ['grant.tx_err', 'grant.scan_resume_top', 'grant.scan_wellformed', 'grant.scan_state_tolerant', 'grant.scan_cap', 'grant.scan_first', 'grant.cache_bound', 'grant.mismatch_uncached', 'grant.not_found_cached', 'grant.fee_payer', 'grant.only_signer', 'grant.no_lookup_tables', 'grant.extra_instruction', 'grant.approve_count', 'grant.approve_owner', 'grant.approve_delegate', 'grant.approve_mint', 'grant.approve_amount', 'grant.approve_source', 'grant.memo_count', 'grant.memo_text', 'grant.active_delegate', 'grant.active_amount', 'grant.active_owner_mint', 'grant.superseded', 'grant.superseded_inner', 'grant.scan_failed', 'grant.scan_unreadable', 'grant.superseded_position', 'grant.coalesce_scans', 'grant.scan_store'].map(registerCheck);

export async function principalAta(principal, asset) {
  const [ata] = await findAssociatedTokenPda({ mint: asset, owner: principal, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}
const bad = (reason, detail) => ({ ok: false, reason, detail });

export async function inspectGrantTx(tx, mandate) {
  if (!tx || !tx.transaction) return bad(R.grant_not_found, 'transaction not found');
  if (fails('grant.tx_err', tx.meta?.err !== null && tx.meta?.err !== undefined)) return bad(R.grant_mismatch, `transaction failed: ${JSON.stringify(tx.meta.err)}`);
  const msg = tx.transaction.message;
  const keys = msg.accountKeys ?? [];
  if (fails('grant.fee_payer', keys[0]?.pubkey !== mandate.principal)) return bad(R.grant_mismatch, `fee payer is ${keys[0]?.pubkey}, not the principal`);
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey);
  if (fails('grant.only_signer', !(signers.length === 1 && signers[0] === mandate.principal))) return bad(R.grant_mismatch, `signers: ${signers.join(',')}`);
  if (fails('grant.no_lookup_tables', Array.isArray(msg.addressTableLookups) && msg.addressTableLookups.length > 0)) return bad(R.grant_mismatch, 'address lookup tables are refused');
  const approves = [], memos = [];
  for (const ix of msg.instructions ?? []) {
    if (ix.programId === COMPUTE_BUDGET) continue;
    if (ix.programId === TOKEN_PROGRAM_ADDRESS && ix.parsed?.type === 'approveChecked') { approves.push(ix.parsed.info); continue; }
    if (ix.programId === MEMO_V2 && typeof ix.parsed === 'string') { memos.push(ix.parsed); continue; }
    if (fails('grant.extra_instruction', true)) return bad(R.grant_mismatch, `unexpected instruction from ${ix.programId}${ix.parsed?.type ? ` (${ix.parsed.type})` : ''}`);
  }
  if (fails('grant.approve_count', approves.length !== 1)) return bad(R.grant_mismatch, `${approves.length} ApproveChecked instructions`);
  if (fails('grant.memo_count', memos.length !== 1)) return bad(R.grant_mismatch, `${memos.length} Memo instructions`);
  const a = approves[0] ?? {}, memo = memos[0];
  if (fails('grant.approve_owner', a.owner !== mandate.principal)) return bad(R.grant_mismatch, `ApproveChecked owner ${a.owner}`);
  if (fails('grant.approve_delegate', a.delegate !== mandate.agent)) return bad(R.grant_mismatch, `ApproveChecked delegate ${a.delegate}`);
  if (fails('grant.approve_mint', a.mint !== mandate.asset)) return bad(R.grant_mismatch, `ApproveChecked mint ${a.mint}`);
  if (fails('grant.approve_amount', a.tokenAmount?.amount !== mandate.total_cap)) return bad(R.grant_mismatch, `ApproveChecked amount ${a.tokenAmount?.amount}, total_cap ${mandate.total_cap}`);
  const ata = await principalAta(mandate.principal, mandate.asset);
  if (fails('grant.approve_source', a.source !== ata)) return bad(R.grant_mismatch, `ApproveChecked source ${a.source}, principal ATA ${ata}`);
  if (fails('grant.memo_text', memo !== summaryLine(mandate))) return bad(R.grant_mismatch, `memo is not the summary line of mandate ${mandateId(mandate)}`);
  return { ok: true, grant_slot: tx.slot, grant_time: tx.blockTime ?? null, source: ata };
}

// account = result.value of getAccountInfo(source, jsonParsed), or null.
export function inspectGrantActive(account, mandate) {
  const info = account?.data?.parsed?.info;
  if (!info) return bad(R.grant_inactive, 'source token account not found');
  if (fails('grant.active_owner_mint', info.owner !== mandate.principal || info.mint !== mandate.asset)) return bad(R.grant_inactive, 'source account is not the principal account for the asset');
  if (fails('grant.active_delegate', info.delegate !== mandate.agent)) return bad(R.grant_inactive, `current delegate is ${info.delegate ?? 'none'}`);
  if (fails('grant.active_amount', !info.delegatedAmount || BigInt(info.delegatedAmount.amount) === 0n)) return bad(R.grant_inactive, 'delegated amount is 0');
  return { ok: true, delegated: info.delegatedAmount.amount };
}

// A grant is current only if nothing after it changed the delegation of its source account (Addendum C, fix 1). Instructions that change the
// delegate or the account: Approve, ApproveChecked, Revoke, SetAuthority, CloseAccount. The agent's own TransferChecked payments do not count.
export const SUPERSEDING = new Set(['approve', 'approveChecked', 'revoke', 'setAuthority', 'closeAccount']);
export function supersedes(tx, source) {
  if (!tx || tx.meta?.err) return false;
  // top-level instructions AND instructions made by CPI from another program (meta.innerInstructions, jsonParsed): a wallet program or a
  // protocol can change the delegate of a token account it controls without a top-level token instruction
  const inner = fails('grant.superseded_inner', true) ? (tx.meta?.innerInstructions ?? []).flatMap((g) => g.instructions ?? []) : [];
  for (const ix of [...(tx.transaction?.message?.instructions ?? []), ...inner]) {
    if (ix.programId !== TOKEN_PROGRAM_ADDRESS || !SUPERSEDING.has(ix.parsed?.type)) continue;
    const i = ix.parsed.info ?? {};
    if (i.source === source || i.account === source) return true;
  }
  return false;
}
// Scan the signatures of `source` that are newer than `since` (exclusive), paginating with `before` until the page is not full. Returns the
// newest signature seen and the EARLIEST superseding transaction by position in the chain (slot, then index in the block; never signature
// order). Throws if a page cannot be read OR a listed transaction cannot be read (Addendum E, B2): an unreadable transaction must not count
// as "does not supersede", and the caller fails closed and does not advance past it.
export async function scanSupersede(rpc, source, since, { pageSize = 100, maxPages = 1000, resume = null, onProgress = null, stopAtFirst = false } = {}) {
  // resumable (Addendum I, J1): `resume` = { cursor, newest, found } is the state after the last page that was read completely; onProgress(state) is called after each
  // such page, so a scan that was cut short (a request that ran out of time budget, an RPC error) continues where it stopped instead of starting over
  let before = resume?.cursor, newest = resume?.newest ?? null;
  const found = [...(resume?.found ?? [])];
  for (let pages = 0; ; pages++) {
    if (pages >= maxPages) throw new Error('too many pages to scan');
    const page = await rpc.getSignaturesForAddress(source, { until: since, ...(before ? { before } : {}), limit: pageSize });
    if (newest === null && pages === 0 && !resume && page.length) newest = page[0].signature;
    const listed = page.filter((e) => !e.err);
    const txs = await readTransactions(rpc, listed.map((e) => e.signature));
    listed.forEach((e, k) => {
      if (fails('grant.scan_unreadable', !txs[k])) throw new Error(`transaction ${e.signature} could not be read`);
      // the bar parsePayment uses: a jsonParsed transaction (an instruction array) with meta; anything else (an empty object, a base64 transaction) is unreadable
      if (fails('grant.scan_wellformed', !Array.isArray(txs[k].transaction?.message?.instructions) || !txs[k].meta)) throw new Error(`transaction ${e.signature} is not a jsonParsed transaction`);
      if (supersedes(txs[k], source)) found.push({ sig: e.signature, tx_sig: e.signature, slot: txs[k].slot });
    });
    if (page.length) before = page[page.length - 1].signature;
    if (page.length < pageSize) break;
    // an ACTIVE question (is this grant still current?) is answered by the first superseding signature there is; the resolver asks for the earliest and reads on
    if (stopAtFirst && found.length) break;
    onProgress?.({ cursor: before, newest, found: [...found] });
  }
  let earliest = null;
  if (found.length) {
    const minSlot = Math.min(...found.map((f) => f.slot));
    const atMin = found.filter((f) => f.slot === minSlot);
    const idxOf = {};
    if (atMin.length > 1) await fillBlockIndices(rpc, atMin, idxOf);
    earliest = fails('grant.superseded_position', true) ? [...atMin].sort((a, b) => comparePositions(a, b, idxOf))[0] : [...atMin].sort((a, b) => (a.sig < b.sig ? -1 : 1))[0];
  }
  return { newest, superseded: earliest };
}

// rpc = { getTransaction(sig), getAccountInfoParsed(addr) }. The immutable part is cached by (grant_tx, mandate id).
export function createGrantChecker(rpc, { scanStore = null, maxScans = 4, maxQueuedScans = 64, grantNullRetries = undefined, cacheMax = 1000, notFoundTtlMs = 5000 } = {}) {
  // inspected grants that are OK, bounded (least recently used out): a grant_mismatch is not cached per mandate id, because the ids are the caller's to choose and
  // an unbounded map of them is a memory leak anyone can feed (Addendum M, M5 b)
  const cache = new Map();
  const cacheSet = (k, v) => { cache.delete(k); cache.set(k, v); if (fails('grant.cache_bound', cache.size > cacheMax)) cache.delete(cache.keys().next().value); };
  const notFound = new Map(); // grant_tx -> until (ms): an unknown grant_tx is read once, not on every request
  const scans = new Map(); // `${source}:${grantTx}` -> { since, superseded }: later calls only scan what is newer than the last scan
  const SCANS_MAX = 10_000;
  // at most `maxScans` supersession scans run at once; up to `maxQueuedScans` wait for a slot; beyond that the check answers busy (the gate answers 503). Anyone can add
  // grants on an account of their own, each of which would otherwise start a full scan (Addendum M, M5 a).
  let running = 0; const waiting = [];
  async function withSlot(fn) {
    if (fails('grant.scan_cap', running >= maxScans)) {
      if (waiting.length >= maxQueuedScans) throw Object.assign(new Error('too many supersession scans are running'), { busy: true });
      await new Promise((res) => waiting.push(res));
    } else running++;
    try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else running--; }
  }
  // A stored marker that does not parse or has the wrong shape is treated as absent: the scan restarts from the grant (it reads more, never less) (Addendum M, M1 b)
  const stored = (k) => {
    if (!fails('grant.scan_state_tolerant', true)) return scanStore?.get(k);
    try {
      const v = scanStore?.get(k);
      const okPartial = (p) => p === undefined || p === null || (typeof p.cursor === 'string' && (p.newest === null || typeof p.newest === 'string') && Array.isArray(p.found));
      return v && typeof v === 'object' && typeof v.since === 'string' && (v.superseded === null || (v.superseded && typeof v.superseded.sig === 'string')) && okPartial(v.partial) ? v : undefined;
    } catch { return undefined; }
  };
  async function supersededBy(source, grantTx, { first = false } = {}) {
    const stop = first && fails('grant.scan_first', true);
    const k = `${source}:${grantTx}${stop ? ':first' : ''}`;
    // scanStore (optional, { get(key), put(key, state) }) keeps the marker across restarts: each signature of the account is read once (Addendum G, T2)
    let st = scans.get(k) ?? (fails('grant.scan_store', true) ? stored(k) : null) ?? { since: grantTx, superseded: null };
    for (;;) {
      if (st.superseded) return st.superseded;
      const resumed = Boolean(st.partial), since = st.since;
      const r = await withSlot(() => scanSupersede(rpc, source, since, { resume: st.partial ?? null, stopAtFirst: stop, onProgress: (partial) => { const cur = { since, superseded: null, partial }; scans.set(k, cur); scanStore?.put(k, cur); } }));
      st = { since: r.newest ?? since, superseded: r.superseded };
      scans.delete(k); scans.set(k, st); if (scans.size > SCANS_MAX) scans.delete(scans.keys().next().value); scanStore?.put(k, st);
      // a resumed scan read the history only down from the top of the scan it resumed, never above it: read what landed after that top before answering (Addendum M, M1)
      if (!fails('grant.scan_resume_top', resumed) || st.superseded) return st.superseded;
    }
  }
  // Concurrent payments ask the same question at the same moment (is this grant still current?). One scan answers all of them; a call that
  // arrives after it finished starts a new one, so nothing is cached beyond the incremental `since` marker.
  const inflight = new Map();
  const supersededOnce = (source, grantTx, o = {}) => {
    if (!fails('grant.coalesce_scans', true)) return supersededBy(source, grantTx, o);
    const k = `${source}:${grantTx}${o.first ? ':first' : ''}`;
    if (!inflight.has(k)) inflight.set(k, supersededBy(source, grantTx, o).finally(() => inflight.delete(k)));
    return inflight.get(k);
  };
  return {
    supersededBy: supersededOnce,
    stats: () => ({ grants: cache.size, notFound: notFound.size, scans: scans.size, runningScans: running, queuedScans: waiting.length }),
    async check(mandate, grantTx, { active = true } = {}) {
      if (typeof grantTx !== 'string' || grantTx.length < 80) return bad(R.grant_not_found, 'no grant_tx');
      const key = `${grantTx}:${mandateId(mandate)}`;
      let s = cache.get(key);
      if (s) { cache.delete(key); cache.set(key, s); }
      if (!s) {
        if (fails('grant.not_found_cached', (notFound.get(grantTx) ?? 0) > Date.now())) return bad(R.grant_not_found, 'the grant transaction was not found (asked a moment ago)');
        const tx = await rpc.getTransaction(grantTx, grantNullRetries !== undefined ? { nullRetries: grantNullRetries } : undefined);
        s = await inspectGrantTx(tx, mandate);
        if (s.ok || (s.reason === R.grant_mismatch && !fails('grant.mismatch_uncached', true))) cacheSet(key, s);
        if (!tx) { notFound.delete(grantTx); notFound.set(grantTx, Date.now() + notFoundTtlMs); if (notFound.size > cacheMax) notFound.delete(notFound.keys().next().value); }
      }
      if (!s.ok || !active) return s;
      const live = inspectGrantActive(await rpc.getAccountInfoParsed(s.source), mandate);
      if (!live.ok) return live;
      let sup;
      try { sup = await supersededOnce(s.source, grantTx, { first: true }); }
      catch (e) { if (e.busy) return { ...bad(R.grant_inactive, `could not verify the grant is current: ${e.message}`), busy: true }; return fails('grant.scan_failed', true) ? bad(R.grant_inactive, `could not verify the grant is current: ${e.message}`) : { ...s, ...live }; }
      if (fails('grant.superseded', sup)) return bad(R.grant_inactive, `superseded by ${sup.sig}`);
      return { ...s, ...live };
    },
  };
}
