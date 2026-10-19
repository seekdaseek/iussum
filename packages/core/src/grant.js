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
import { fillBlockIndices, comparePositions } from './chain.js';

export const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export const MEMO_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const GRANT_CHECKS = ['grant.tx_err', 'grant.fee_payer', 'grant.only_signer', 'grant.no_lookup_tables', 'grant.extra_instruction', 'grant.approve_count', 'grant.approve_owner', 'grant.approve_delegate', 'grant.approve_mint', 'grant.approve_amount', 'grant.approve_source', 'grant.memo_count', 'grant.memo_text', 'grant.active_delegate', 'grant.active_amount', 'grant.active_owner_mint', 'grant.superseded', 'grant.superseded_inner', 'grant.scan_failed', 'grant.scan_unreadable', 'grant.superseded_position', 'grant.coalesce_scans'].map(registerCheck);

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
export async function scanSupersede(rpc, source, since, { pageSize = 100, maxPages = 1000 } = {}) {
  let before, newest = null;
  const found = [];
  for (let pages = 0; ; pages++) {
    if (pages >= maxPages) throw new Error('too many pages to scan');
    const page = await rpc.getSignaturesForAddress(source, { until: since, ...(before ? { before } : {}), limit: pageSize });
    if (pages === 0 && page.length) newest = page[0].signature;
    for (const e of page) {
      if (e.err) continue;
      const tx = await rpc.getTransaction(e.signature);
      if (fails('grant.scan_unreadable', !tx)) throw new Error(`transaction ${e.signature} could not be read`);
      if (supersedes(tx, source)) found.push({ sig: e.signature, tx_sig: e.signature, slot: tx.slot });
    }
    if (page.length < pageSize) break;
    before = page[page.length - 1].signature;
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
export function createGrantChecker(rpc) {
  const cache = new Map();
  const scans = new Map(); // `${source}:${grantTx}` -> { since, superseded }: later calls only scan what is newer than the last scan
  async function supersededBy(source, grantTx) {
    const k = `${source}:${grantTx}`;
    const st = scans.get(k) ?? { since: grantTx, superseded: null };
    if (st.superseded) return st.superseded;
    const r = await scanSupersede(rpc, source, st.since);
    scans.set(k, { since: r.newest ?? st.since, superseded: r.superseded });
    return r.superseded;
  }
  // Concurrent payments ask the same question at the same moment (is this grant still current?). One scan answers all of them; a call that
  // arrives after it finished starts a new one, so nothing is cached beyond the incremental `since` marker.
  const inflight = new Map();
  const supersededOnce = (source, grantTx) => {
    if (!fails('grant.coalesce_scans', true)) return supersededBy(source, grantTx);
    const k = `${source}:${grantTx}`;
    if (!inflight.has(k)) inflight.set(k, supersededBy(source, grantTx).finally(() => inflight.delete(k)));
    return inflight.get(k);
  };
  return {
    supersededBy: supersededOnce,
    async check(mandate, grantTx, { active = true } = {}) {
      if (typeof grantTx !== 'string' || grantTx.length < 80) return bad(R.grant_not_found, 'no grant_tx');
      const key = `${grantTx}:${mandateId(mandate)}`;
      let s = cache.get(key);
      if (!s) { s = await inspectGrantTx(await rpc.getTransaction(grantTx), mandate); if (s.ok || s.reason === R.grant_mismatch) cache.set(key, s); }
      if (!s.ok || !active) return s;
      const live = inspectGrantActive(await rpc.getAccountInfoParsed(s.source), mandate);
      if (!live.ok) return live;
      let sup;
      try { sup = await supersededOnce(s.source, grantTx); }
      catch (e) { return fails('grant.scan_failed', true) ? bad(R.grant_inactive, `could not verify the grant is current: ${e.message}`) : { ...s, ...live }; }
      if (fails('grant.superseded', sup)) return bad(R.grant_inactive, `superseded by ${sup.sig}`);
      return { ...s, ...live };
    },
  };
}
