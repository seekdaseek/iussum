// The agent wrapper (Addendum B). It carries the mandate and the grant_tx with every x402 payment (extensions.iussum.info) and refuses locally,
// BEFORE signing, when a payment would break the mandate: grant check (incl. still-active), window, per-payment cap, pay_to and resource
// allow-lists, asset, network, and its own running period spend (the period budget is the agent's to keep: a seller cannot see other sellers'
// payments). localChecks:false builds a "naive" agent for the demo's controls.
// Phase 1.2 (Addendum E): the period budget is RESERVED before signing, in the same synchronous step as the check, so concurrent payments cannot
// all take the last unit. A reservation is held, then consumed (the payment-response reported success, or the chain shows it landed) or released
// (the payment was never created, or its blockhash expired and no transaction carrying the agent's signature is on chain). Until then a held
// reservation counts as spent. The agent pays the associated token account of the payTo it checked, never a destination the 402 names.
// Phase 1.4 (Addendum G): a reservation is released only on a PROVEN expiry: isBlockhashValid false AND the chain height above the payload's own
// lastValidBlockHeight, both asked with minContextSlot = the slot getLatestBlockhash returned (a node that lags answers false for a fresh blockhash).
// A success that arrives for a released reservation is still counted. With cfg.dataDir the held reservations are written to disk (temp file, fsync,
// rename) before the signed payload leaves the agent and loaded at start, so a restart does not forget a payload a seller kept; the verified history
// is kept there as a checkpoint, so a restart reads only what is new.
// Phase 1.5 (Addendum H): ONE agent per data directory (an exclusive lock file with the PID, created with O_EXCL; a stale lock is cleared only when that
// PID is not running); a partial or corrupt reservations file makes the agent refuse to pay, it is never read as empty; a temp file left by a crash
// between write and rename is ignored (the last complete file is loaded) and removed.
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createGrantChecker, scopeViolations, mandateId, periodIndex, periodStart, decodeReceipt, normalizeResource, agentSpendHistory, allowanceCheck, mintDecimals, R, fails, isMutated, registerCheck, principalAta, assertMandate } from '@iussum/core';
import { getTransactionDecoder, getBase58Decoder, pipe, createTransactionMessage, setTransactionMessageFeePayer, appendTransactionMessageInstructions, setTransactionMessageLifetimeUsingBlockhash, partiallySignTransactionMessageWithSigners, compileTransaction, getBase64EncodedWireTransaction, getTransactionEncoder } from '@solana/kit';
import { getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { assertOnlyComputeBudgetChanged } from './txguard.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const AGENT_CHECKS = ['agent.grant', 'agent.scope', 'agent.period', 'agent.tx_guard', 'agent.attach_mandate', 'agent.ledger', 'agent.ledger_rebuild', 'agent.history_complete', 'agent.resource_mismatch', 'agent.requested_url', 'agent.requested_url_present', 'agent.decimals', 'agent.destination_mismatch', 'agent.destination_ata', 'agent.reserve_held', 'agent.reserve_atomic', 'agent.hold_until_proven', 'agent.release_uncreated', 'agent.release_on_expiry', 'agent.landed_consumed', 'agent.rebuild_allowance', 'agent.history_to_grant', 'agent.own_blockhash', 'agent.blockhash_valid', 'agent.release_needs_height', 'agent.min_context_slot', 'agent.consume_released', 'agent.persist_before_send', 'agent.restore_reservations', 'agent.checkpoint', 'agent.datadir_lock', 'agent.stale_lock_pid', 'agent.corrupt_reservations_refuse', 'agent.tmp_cleanup', 'agent.history_min_context', 'agent.keyed_by_grant', 'agent.retry_after'].map(registerCheck);
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
  // the supersession scan's marker lives in the data directory too, so a restart does not read the account's whole history again (Addendum G, T2)
  let scanFile = null;
  const scanStore = { get: (k) => (scanFile ? readScan()?.[k] : undefined), put: (k, v) => { if (scanFile) { const all = readScan() ?? {}; all[k] = v; writeAtomic(scanFile, all); } } };
  const readScan = () => { try { return JSON.parse(fs.readFileSync(scanFile, 'utf8')); } catch { return null; } };
  const checker = createGrantChecker(rpc, { scanStore });
  const source = mandate ? await principalAta(mandate.principal, mandate.asset) : cfg.source;
  const ledger = []; // [{amount, t, sig}] payments of this agent that are SPENT: rebuilt from chain at start, then consumed reservations
  const reservations = []; // {id, amount, t, state: held|consumed|released, created, agentSig, blockhash, sig}: each moves exactly once, out of held
  let nextReservation = 0;
  let ledgerComplete = true, ledgerReason = null;
  const requested = new AsyncLocalStorage(); // { url, ids }: the URL this fetch actually asked for (never what the seller says it is) and its reservations
  const decimalsCache = new Map();
  const getBlockhash = cfg.getBlockhash ?? (async () => { const r = await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]); return { blockhash: r.value.blockhash, lastValidBlockHeight: BigInt(r.value.lastValidBlockHeight), contextSlot: r.context?.slot }; });
  const sign = cfg.sign ?? partiallySignTransactionMessageWithSigners;

  // ---- persistence (R1, T2): one reservations file and one checkpoint file per mandate and agent under cfg.dataDir. Every write is temp file, fsync,
  // rename, so a crash leaves the old file or the new one, never half of one.
  const dataDir = cfg.dataDir ?? null;
  // keyed like the resolver's checkpoint: grant_tx, source, agent and asset (Addendum I, I4). A re-grant of the same mandate is a different grant: it never
  // loads the files of the earlier one, and those files are neither read nor deleted.
  const keyOf = () => (fails('agent.keyed_by_grant', true) ? `${grant_tx}|${source}|${signer.address}|${mandate.asset}` : `${mandateId(mandate)}|${signer.address}`);
  const stem = dataDir && mandate ? createHash('sha256').update(keyOf()).digest('hex').slice(0, 32) : null;
  const fileOf = (kind) => path.join(dataDir, `${stem}.${kind}.json`);
  function writeAtomic(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(obj)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  }
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const persistReservations = () => {
    if (!dataDir) return;
    writeAtomic(fileOf('reservations'), { v: 1, reservations: reservations.filter((r) => r.state === 'held' && r.created).map((r) => ({ amount: String(r.amount), t: r.t, blockhash: r.blockhash, lastValidBlockHeight: r.lastValid === null || r.lastValid === undefined ? null : String(r.lastValid), contextSlot: r.contextSlot ?? null, agentSig: r.agentSig })) });
  };
  // ---- one agent per data directory (H2)
  const lockPath = dataDir && stem ? path.join(dataDir, `${stem}.lock`) : null;
  let lockHeld = false;
  const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  function acquireLock() {
    fs.mkdirSync(dataDir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(lockPath, 'wx', 0o600); // O_CREAT | O_EXCL: exactly one creator wins
        try { fs.writeSync(fd, `${process.pid}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        lockHeld = true; return;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
        if (fails('agent.stale_lock_pid', Number.isInteger(pid) && pid > 0 && pidAlive(pid))) throw new Error(`another agent (pid ${pid}) holds the data directory ${dataDir}: one agent per data directory`);
        try { fs.renameSync(lockPath, `${lockPath}.stale-${process.pid}`); fs.rmSync(`${lockPath}.stale-${process.pid}`, { force: true }); } catch { /* another starter cleared it first */ }
      }
    }
    throw new Error(`could not take the lock on the data directory ${dataDir}`);
  }
  const releaseLock = () => { if (lockHeld) { lockHeld = false; try { if (Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10) === process.pid) fs.rmSync(lockPath, { force: true }); } catch { /* already gone */ } } };
  if (dataDir && mandate && fails('agent.datadir_lock', true)) { acquireLock(); process.once('exit', releaseLock); }
  // temp files a crash left between write and rename are never read (the rename is atomic: the last complete file is the truth); remove them now that the lock is ours
  if (dataDir && mandate && lockHeld && fails('agent.tmp_cleanup', true)) for (const f of fs.readdirSync(dataDir)) if (f.startsWith(stem) && f.endsWith('.tmp')) fs.rmSync(path.join(dataDir, f), { force: true });
  // the reservations file is read STRICTLY: a missing file is empty, a file that does not parse is not (H2)
  let reservationsCorrupt = null;
  const strictReservations = () => {
    if (!dataDir || !mandate) return [];
    const file = fileOf('reservations');
    if (!fs.existsSync(file)) return [];
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j?.v !== 1 || !Array.isArray(j.reservations)) throw new Error('unexpected shape');
      for (const x of j.reservations) if (typeof x.amount !== 'string' || !/^\d+$/.test(x.amount) || typeof x.t !== 'number' || typeof x.blockhash !== 'string' || typeof x.agentSig !== 'string') throw new Error('a reservation is incomplete');
      return j.reservations;
    } catch (e) { reservationsCorrupt = `the reservations file ${file} is corrupt or partial (${e.message})`; return []; }
  };
  const savedReservations = strictReservations();
  if (dataDir && mandate) scanFile = fileOf('scan');
  let cp = dataDir && !isMutated('agent.checkpoint') ? readJson(fileOf('checkpoint')) : null; // the verified history so far (core agentSpendHistory checkpoint)
  const saveCheckpoint = (c) => { cp = c; if (dataDir && c) writeAtomic(fileOf('checkpoint'), c); };

  // fix 7: the period ledger survives a restart. Rebuild it from chain history (paginated); if completeness cannot be shown, refuse to pay.
  // Addendum E, C1: while the grant is current the debits found must add up to total_cap minus the allowance that is left on the account.
  // Reservations that a previous run persisted: a payload may still be out there. They are held again; if the rebuilt history shows the agent's signature
  // from that payload, it landed and is already in the ledger (consumed). They are resolved later by the same proven-expiry rule as any other.
  function restoreReservations(entries) {
    const saved = dataDir && mandate && fails('agent.restore_reservations', true) ? savedReservations : [];
    for (const x of saved) {
      const landed = entries?.find((e) => x.agentSig && e.signatures.includes(x.agentSig));
      reservations.push({ id: nextReservation++, amount: BigInt(x.amount), t: x.t, state: landed ? 'consumed' : 'held', created: true, agentSig: x.agentSig, blockhash: x.blockhash, lastValid: x.lastValidBlockHeight == null ? null : BigInt(x.lastValidBlockHeight), contextSlot: x.contextSlot, sig: landed?.tx_sig ?? null, restored: true });
    }
    if (saved.length) persistReservations();
  }
  if (mandate && !isMutated('agent.ledger_rebuild')) {
    let ctx = null, superseded = null, scanFailed = null;
    try { ctx = await rpc.getAccountContext(source); } catch (e) { scanFailed = `the source account could not be read: ${e.message}`; }
    // is the grant current? That decides how far back the history must reach: while it is, the cross-check compares ALL debits since the grant, so no
    // cut at the start of the period (Addendum F, N1)
    try { superseded = await checker.supersededBy(source, grant_tx); } catch (e) { scanFailed = scanFailed ?? `could not verify the grant is current: ${e.message}`; }
    const full = fails('agent.history_to_grant', true); // the history is read back to the grant, once (checkpoint), whether or not the grant is still current
    const h = await agentSpendHistory(rpc, { source, agent: signer.address, mint: mandate.asset, until: grant_tx, stopAtTime: full ? null : periodStart(mandate, now()), checkpoint: full ? cp : null });
    if (full && h.checkpoint) saveCheckpoint(h.checkpoint);
    ledgerComplete = h.complete; ledgerReason = h.reason;
    for (const e of h.entries) ledger.push({ amount: e.amount, t: e.block_time ?? now(), sig: e.tx_sig });
    restoreReservations(ledgerComplete ? h.entries : null);
    if (reservationsCorrupt && fails('agent.corrupt_reservations_refuse', true)) { ledgerComplete = false; ledgerReason = reservationsCorrupt; }
    if (ledgerComplete && fails('agent.rebuild_allowance', true)) {
      if (scanFailed) { ledgerComplete = false; ledgerReason = scanFailed; }
      else if (!superseded) {
        const ac = allowanceCheck({ mandate, entries: h.entries, account: ctx.value, slot: ctx.slot });
        if (!ac.ok) { ledgerComplete = false; ledgerReason = ac.expected !== undefined ? `the debits found (${ac.actual}) do not add up to the allowance that is gone (${ac.expected}): total_cap ${mandate.total_cap} minus ${ac.left} still delegated at slot ${ac.slot}` : ac.why; }
      }
    }
  }
  const periodAt = (t) => periodIndex(mandate, t);
  const heldInPeriod = (t) => reservations.filter((r) => r.state === 'held' && periodAt(r.t) === periodAt(t)).reduce((a, r) => a + r.amount, 0n);
  const spentThisPeriod = (t) => ledger.filter((x) => periodAt(x.t) === periodAt(t)).reduce((a, x) => a + BigInt(x.amount), 0n);

  const scheme = {
    scheme: 'exact',
    async createPaymentPayload(x402Version, req) {
      // the blockhash is the agent's OWN, never one named in the 402: a seller that names one can claim an early expiry and keep the payload (Addendum F, N12)
      const bh = !fails('agent.own_blockhash', true) && req.extra?.recentBlockhash ? { blockhash: req.extra.recentBlockhash, lastValidBlockHeight: BigInt(req.extra.lastValidBlockHeight ?? 0) } : await getBlockhash();
      const decimals = fails('agent.decimals', true) ? await assetDecimals(req) : 6;
      const destination = fails('agent.destination_ata', true) ? await destinationAta(req.payTo, req.asset) : (req.destination ?? (await destinationAta(req.payTo, req.asset)));
      const ix = getTransferCheckedInstruction({ source, mint: req.asset, destination, authority: signer, amount: BigInt(req.amount), decimals }, { programAddress: TOKEN_PROGRAM_ADDRESS });
      const memo = { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: new TextEncoder().encode(Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')) };
      const built = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayer(req.extra.feePayer, m), (m) => appendTransactionMessageInstructions([cb([2, ...u32(20_000)]), cb([3, 1, 0, 0, 0, 0, 0, 0, 0]), ix, memo], m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m));
      const sent = Buffer.from(getTransactionEncoder().encode(compileTransaction(built))).toString('base64');
      const signed = getBase64EncodedWireTransaction(await sign(built));
      // whatever signs this transaction may add ComputeBudget instructions and nothing else (copied x402-wallet guard)
      if (fails('agent.tx_guard', true)) assertOnlyComputeBudgetChanged(sent, signed);
      // the reservation of this payment learns that a payload exists, which agent signature it carries and until which block it can land
      const mine = requested.getStore()?.ids.map((id) => reservations[id]).findLast((r) => r.state === 'held' && !r.created);
      if (mine) { mine.created = true; mine.blockhash = bh.blockhash; mine.lastValid = bh.lastValidBlockHeight === undefined ? null : BigInt(bh.lastValidBlockHeight); mine.contextSlot = bh.contextSlot ?? null; mine.agentSig = agentSignature(signed); if (fails('agent.persist_before_send', true)) { try { persistReservations(); } catch (e) { mine.created = false; throw e; } } } // on disk before the payload leaves (if it cannot be written the payload is not returned and the reservation is released)
      return { x402Version, payload: { transaction: signed } };
    },
  };
  async function assetDecimals(req) {
    if (Number.isInteger(req.extra?.decimals)) return req.extra.decimals;
    if (!decimalsCache.has(req.asset)) decimalsCache.set(req.asset, await mintDecimals(rpc, req.asset));
    return decimalsCache.get(req.asset);
  }
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
  // The agent's own signature on a payload, as base58: how a payment is recognised on chain later (the fee payer's signature is the id).
  function agentSignature(signedBase64) {
    const sigs = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(signedBase64, 'base64'))).signatures;
    const bytes = sigs[signer.address];
    return bytes ? getBase58Decoder().decode(bytes) : null;
  }
  // Resolve held reservations from the chain. A held payment may still land until its blockhash expires, so it counts as spent until the chain PROVES
  // otherwise: (1) isBlockhashValid is false for that payload's blockhash AND (2) the chain height is above the payload's own lastValidBlockHeight, both
  // asked with minContextSlot = the slot getLatestBlockhash returned for it (a node behind the one that served the blockhash answers false for a fresh
  // one), AND (3) no transaction carrying the agent's signature from that payload is on chain. Anything that cannot be read leaves it held.
  async function settleHeld() {
    const open = reservations.filter((r) => r.state === 'held' && r.created && r.blockhash && r.contextSlot !== null && r.contextSlot !== undefined && r.lastValid !== null && r.lastValid !== undefined);
    if (!open.length) return;
    const expired = [];
    let proofSlot = 0; // the newest slot any expiry answer came from: the history read below must ask a node that has reached it (Addendum I, I3)
    for (const r of open) {
      try {
        const opts = fails('agent.min_context_slot', true) ? { commitment: 'confirmed', minContextSlot: r.contextSlot } : { commitment: 'confirmed' };
        const v = await rpc.call('isBlockhashValid', [r.blockhash, opts]);
        const invalid = (v?.value ?? v) === false;
        const height = await rpc.call('getBlockHeight', [opts]);
        const past = BigInt(height) > r.lastValid;
        if (!fails('agent.blockhash_valid', !invalid) && !fails('agent.release_needs_height', !past)) { expired.push(r); proofSlot = Math.max(proofSlot, r.contextSlot ?? 0, v?.context?.slot ?? 0); } // otherwise the payload can still land
      } catch { /* cannot tell: stays held */ }
    }
    if (!expired.length) return;
    // "did it land?": every call of this read takes minContextSlot >= the proof slot; "minimum context slot not reached" or any other error makes it incomplete and the
    // reservation stays held
    const h = await agentSpendHistory(rpc, { source, agent: signer.address, mint: mandate.asset, until: grant_tx, checkpoint: cp, minContextSlot: fails('agent.history_min_context', true) ? proofSlot : null });
    if (h.checkpoint) saveCheckpoint(h.checkpoint);
    if (!h.complete) return;
    for (const r of expired) {
      if (r.state !== 'held') continue; // another call resolved it while this one was reading the chain
      const landed = h.entries.find((e) => r.agentSig && e.signatures.includes(r.agentSig));
      if (landed && fails('agent.landed_consumed', true)) { r.state = 'consumed'; r.sig = landed.tx_sig; if (!ledger.some((x) => x.sig === landed.tx_sig)) ledger.push({ amount: landed.amount, t: landed.block_time ?? r.t, sig: landed.tx_sig }); }
      else if (!landed && fails('agent.release_on_expiry', true)) r.state = 'released';
    }
    persistReservations();
  }
  if (localChecks && mandate) {
    client.onBeforePaymentCreation(async (ctx) => {
      const r = ctx.selectedRequirements;
      const store = requested.getStore();
      const asked = store?.url ?? null; // fix 8: judge the URL actually requested
      const declared = ctx.paymentRequired.resource?.url ?? null;
      const url = isMutated('agent.requested_url') ? declared : asked; // judge the URL we asked for, never the one the seller declares
      const g = capsOnly ? { ok: true } : await checker.check(mandate, grant_tx, { active: true });
      const expectedDestination = await destinationAta(r.payTo, r.asset);
      await settleHeld();
      // ---- from here to the reservation there is NO await: the check and the reservation are one synchronous step (Addendum E, B5)
      const t = now();
      let reason = null, delta = [];
      if (fails('agent.history_complete', !ledgerComplete)) { reason = R.history_incomplete; delta = [{ field: 'history', authorized: 'a complete record of this agent\'s payments in the period', actual: `could not be rebuilt from chain${ledgerReason ? `: ${ledgerReason}` : ''}` }]; }
      else if (fails('agent.requested_url_present', asked === null)) { reason = R.resource_mismatch; delta = [{ field: 'resource', authorized: 'the URL this agent requested', actual: 'unknown: the payment was not created through agent.fetch' }]; }
      else if (fails('agent.resource_mismatch', asked !== null && declared !== null && normalizeResource(declared) !== normalizeResource(asked))) { reason = R.resource_mismatch; delta = [{ field: 'resource', authorized: normalizeResource(asked), actual: normalizeResource(declared) }]; }
      else if (fails('agent.grant', !g.ok)) { reason = g.reason; delta = [{ field: 'grant', authorized: 'an active ApproveChecked + Memo bound to the mandate id', actual: g.detail }]; }
      else if (fails('agent.destination_mismatch', r.destination != null && r.destination !== expectedDestination)) { reason = R.destination_mismatch; delta = [{ code: R.destination_mismatch, field: 'destination', authorized: `${expectedDestination} (the associated token account of ${r.payTo})`, actual: String(r.destination) }]; }
      if (!reason) {
        delta = scopeViolations(mandate, { amount: r.amount, pay_to: r.payTo, resource: normalizeResource(url) ?? url, asset: r.asset, network: r.network, payer: signer.address, time: t });
        if (capsOnly) delta = delta.filter((d) => d.code === R.amount_over_cap);
        if (fails('agent.scope', delta.length > 0)) reason = delta[0].code; else delta = [];
      }
      if (!reason) {
        const spent = fails('agent.ledger', true) ? spentThisPeriod(t) : 0n;
        const held = fails('agent.reserve_held', true) ? heldInPeriod(t) : 0n;
        if (fails('agent.period', spent + held + BigInt(r.amount) > BigInt(mandate.period_budget))) { reason = R.period_over_budget; delta = [{ code: R.period_over_budget, field: 'period_budget', authorized: mandate.period_budget, actual: `${spent} already spent and ${held} reserved in this period, +${r.amount}` }]; }
      }
      if (reason) return { abort: true, reason: MARK + JSON.stringify({ reason, delta }) };
      if (isMutated('agent.reserve_atomic')) await new Promise((r) => setTimeout(r, 50)); // mutation: let other payments run their check between this one's check and its reservation
      const res = { id: nextReservation++, amount: BigInt(r.amount), t, state: 'held', created: false, agentSig: null, blockhash: null, sig: null };
      reservations.push(res);
      store?.ids.push(res.id);
    });
  }
  // A seller that answers 503 with Retry-After (its grant check is still running, Addendum I, J1) has not touched the payload: re-send the SAME paid request after
  // the wait, a bounded number of times. The reservation is the one of the first attempt (held until proven expired or landed, as for any 502).
  const baseFetch = fetch;
  const retryMax = cfg.retry?.max ?? 3, retryCapMs = cfg.retry?.maxWaitMs ?? 30_000;
  const paid = (input, init) => Boolean((input instanceof Request ? input.headers : new Headers(init?.headers ?? {})).get('payment-signature'));
  const retryingFetch = async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const copy = input instanceof Request ? input.clone() : input;
      const res = await baseFetch(copy, init);
      if (res.status !== 503 || !paid(input, init) || attempt >= retryMax || !fails('agent.retry_after', true)) return res;
      const wait = Number(res.headers.get('retry-after'));
      if (!Number.isFinite(wait) || wait < 0) return res;
      await new Promise((r) => setTimeout(r, Math.min(wait * 1000, retryCapMs)));
    }
  };
  const wrapped = wrapFetchWithPayment(retryingFetch, client);
  async function pay(url, init) {
    const st = { url: normalizeResource(String(url)), ids: [] };
    let res;
    try { res = await requested.run(st, () => wrapped(url, init)); }
    catch (e) {
      const i = String(e.message).indexOf(MARK);
      if (i >= 0) { const j = JSON.parse(e.message.slice(i + MARK.length)); throw new IussumRefusal(j.reason, j.delta); }
      // the payload may have reached the seller and settled even though no response came back: it stays held (and counts) until proven otherwise
      if (!fails('agent.hold_until_proven', true)) for (const id of st.ids) if (reservations[id].state === 'held') reservations[id].state = 'released';
      throw e;
    } finally {
      // a reservation whose payload was never created cannot have landed: release it
      if (fails('agent.release_uncreated', true)) for (const id of st.ids) { const r = reservations[id]; if (r.state === 'held' && !r.created) r.state = 'released'; }
    }
    const pr = res.headers.get('payment-response');
    if (pr && res.status < 400) {
      const settle = JSON.parse(Buffer.from(pr, 'base64').toString('utf8'));
      // a success is counted even if the reservation was released meanwhile (a release must be proven, but the money moved): consume it, dedupe by signature
      const mine = st.ids.map((id) => reservations[id]).findLast((r) => r.created && (r.state === 'held' || (r.state === 'released' && fails('agent.consume_released', true))));
      if (settle.success && mine) { mine.state = 'consumed'; mine.sig = settle.transaction ?? null; if (!mine.sig || !ledger.some((x) => x.sig === mine.sig)) ledger.push({ amount: String(mine.amount), t: now(), sig: mine.sig }); persistReservations(); }
    }
    const rh = res.headers.get('x-iussum-receipt');
    res.receipt = rh ? decodeReceipt(rh) : null;
    return res;
  }
  return { fetch: pay, client, ledger, reservations, async close() { releaseLock(); }, source, mandateId: mandate ? mandateId(mandate) : null, address: signer.address };
}
