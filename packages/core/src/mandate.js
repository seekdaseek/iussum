// Mandate v0.2 (Addendum B). JCS bytes, id = sha256 of them, summary line rebuilt deterministically.
// AP2 Intent Mandate equivalents (for orientation only, the VC format is not adopted): total_cap + per_payment_max + period_*
// ~ spending limits, allow.pay_to ~ merchants, not_before/expires_at ~ intent expiry. x402 #3500 vocabulary: the "authorisation
// scope" artifact is this mandate; the "action" is the seller receipt; the "delta" is the violation list below.
import { isAddress } from '@solana/kit';
import { canonicalize, sha256Hex } from './jcs.js';
import { fails, registerCheck } from './guard.js';
import { R } from './codes.js';
import { prefixErrors, resourceAllowed } from './resource.js';

export const MANDATE_VERSION = 'iussum/0.2';
const DEC = /^(0|[1-9][0-9]*)$/;
const TOP = ['v', 'principal', 'agent', 'network', 'asset', 'total_cap', 'per_payment_max', 'period_budget', 'period_seconds', 'allow', 'not_before', 'expires_at', 'nonce'];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isDec = (x) => typeof x === 'string' && DEC.test(x);
const isPos = (x) => isDec(x) && BigInt(x) > 0n;
const isUnix = (x) => Number.isSafeInteger(x) && x >= 0;

export const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
export const MANDATE_CHECKS = ['mandate.native_mint'].map(registerCheck);

export function validateMandate(m) {
  const e = [];
  if (!isObj(m)) return ['mandate: not an object'];
  for (const k of Object.keys(m)) if (!TOP.includes(k)) e.push(`unknown key ${k}`);
  for (const k of TOP) if (!(k in m)) e.push(`missing ${k}`);
  if (e.length) return e;
  if (m.v !== MANDATE_VERSION) e.push(`v must be ${MANDATE_VERSION}`);
  for (const k of ['principal', 'agent', 'asset']) if (typeof m[k] !== 'string' || !isAddress(m[k])) e.push(`${k} is not a base58 address`);
  // wrapped SOL: an ordinary unwrap closes the account with a balance and SyncNative changes the balance without a token instruction, so no history of
  // such an account can be reconciled (Addendum G, S2). SPL Token, non-native mints only.
  if (fails('mandate.native_mint', m.asset === NATIVE_MINT)) e.push('asset is the native mint (wrapped SOL): SPL Token, non-native mints only');
  if (typeof m.network !== 'string' || !/^solana:[A-Za-z0-9]{8,44}$/.test(m.network)) e.push('network must be solana:<genesis hash>');
  for (const k of ['total_cap', 'per_payment_max', 'period_budget']) if (!isPos(m[k])) e.push(`${k} must be a positive decimal string`);
  if (!Number.isSafeInteger(m.period_seconds) || m.period_seconds <= 0) e.push('period_seconds must be a positive integer');
  if (!isUnix(m.not_before)) e.push('not_before must be unix seconds');
  if (!isUnix(m.expires_at)) e.push('expires_at must be unix seconds');
  if (isUnix(m.not_before) && isUnix(m.expires_at) && m.expires_at <= m.not_before) e.push('expires_at must be after not_before');
  if (typeof m.nonce !== 'string' || !/^[0-9a-f]{16,64}$/.test(m.nonce)) e.push('nonce must be 16 to 64 lowercase hex characters');
  const a = m.allow;
  if (!isObj(a)) e.push('allow must be an object');
  else {
    for (const k of Object.keys(a)) if (k !== 'pay_to' && k !== 'resource_prefix') e.push(`unknown allow key ${k}`);
    if (!Array.isArray(a.pay_to) || a.pay_to.length === 0 || !a.pay_to.every((x) => typeof x === 'string' && isAddress(x))) e.push('allow.pay_to must be a non-empty array of addresses');
    else if (new Set(a.pay_to).size !== a.pay_to.length) e.push('allow.pay_to has duplicates');
    if (!Array.isArray(a.resource_prefix) || a.resource_prefix.length === 0 || !a.resource_prefix.every((x) => typeof x === 'string' && x.length > 0)) e.push('allow.resource_prefix must be a non-empty array of non-empty strings');
    else for (const x of a.resource_prefix) { const pe = prefixErrors(x); if (pe) e.push(`allow.resource_prefix ${JSON.stringify(x)}: ${pe}`); }
  }
  if (e.length === 0 && BigInt(m.per_payment_max) > BigInt(m.total_cap)) e.push('per_payment_max exceeds total_cap');
  return e;
}
export function assertMandate(m) { const e = validateMandate(m); if (e.length) throw Object.assign(new Error(`invalid mandate: ${e.join('; ')}`), { errors: e }); return m; }
export const mandateJcs = (m) => canonicalize(m);
export const mandateId = (m) => sha256Hex(mandateJcs(m));
const iso = (s) => new Date(s * 1000).toISOString();

// The Memo text of the grant transaction. Deterministic from the mandate; ends in the full 64-hex id.
export function summaryLine(m) {
  assertMandate(m);
  return `iussum v0.2 | agent ${m.agent} | asset ${m.asset} | total ${m.total_cap} | per payment ${m.per_payment_max} | per ${m.period_seconds}s ${m.period_budget} | sellers ${m.allow.pay_to.length} | resources ${m.allow.resource_prefix.length} | from ${iso(m.not_before)} until ${iso(m.expires_at)} | id ${mandateId(m)}`;
}

// Tier 1: pure scope check of one payment against a mandate. p = { amount, pay_to, resource, asset, network, payer, time }.
export const periodStart = (m, t) => m.not_before + Math.floor((t - m.not_before) / m.period_seconds) * m.period_seconds;
export const SCOPE_CHECKS = ['network_mismatch', 'asset_mismatch', 'mandate_not_yet_valid', 'mandate_expired', 'agent_mismatch', 'amount_over_cap', 'pay_to_not_allowed', 'resource_not_allowed', 'scope.amount_decimal'].map(registerCheck);
// An amount is a plain decimal integer string: no sign, no spaces, no leading zeros, no hex, no exponent (Addendum P, P1). BigInt() accepts '-5', '0x10', ' 5' and '007', and a negative
// amount that passes the cap would subtract from a period total. The agent, the gate and the resolver judge amounts the same way, with this.
export const isAmountString = (a) => typeof a === 'string' && /^(0|[1-9][0-9]*)$/.test(a);
// opts.judgeResource=false / judgeTime=false: the evidence for that field is not available (a dispute without a receipt has no resource);
// the caller lists it as unjudged instead of guessing.
export function scopeViolations(m, p, { judgeResource = true, judgeTime = true } = {}) {
  const v = [];
  const add = (code, field, authorized, actual) => v.push({ code, field, authorized, actual });
  if (fails(R.network_mismatch, p.network !== m.network)) add(R.network_mismatch, 'network', m.network, p.network);
  if (fails(R.asset_mismatch, p.asset !== m.asset)) add(R.asset_mismatch, 'asset', m.asset, p.asset);
  if (judgeTime && fails(R.mandate_not_yet_valid, p.time < m.not_before)) add(R.mandate_not_yet_valid, 'time', `>= ${m.not_before}`, String(p.time));
  if (judgeTime && fails(R.mandate_expired, p.time >= m.expires_at)) add(R.mandate_expired, 'time', `< ${m.expires_at}`, String(p.time));
  if (fails(R.agent_mismatch, p.payer !== m.agent)) add(R.agent_mismatch, 'payer', m.agent, p.payer);
  if (fails(R.amount_over_cap, fails('scope.amount_decimal', !isAmountString(p.amount)) || BigInt(p.amount) > BigInt(m.per_payment_max))) add(R.amount_over_cap, 'amount', m.per_payment_max, String(p.amount));
  if (fails(R.pay_to_not_allowed, !m.allow.pay_to.includes(p.pay_to))) add(R.pay_to_not_allowed, 'pay_to', m.allow.pay_to.join(','), p.pay_to);
  if (judgeResource && fails(R.resource_not_allowed, !resourceAllowed(m.allow.resource_prefix, p.resource))) add(R.resource_not_allowed, 'resource', m.allow.resource_prefix.join(','), String(p.resource));
  return v;
}

// Period accounting. Periods are anchored at not_before: index = floor((t - not_before) / period_seconds).
export const periodIndex = (m, t) => Math.floor((t - m.not_before) / m.period_seconds);
export const PERIOD_CHECK = registerCheck(R.period_over_budget);
// entries: [{tx_sig, slot, block_time, amount}] in EXECUTION order (slot, then position in the block: agentSpendHistory returns them that way).
// They are re-sorted by slot only, and the sort is stable, so the order within a slot is the order given; it is never decided by signature
// string (Addendum E, S7). Returns { spent, over } for the payment `tx_sig`, counting only the same period, up to and including that
// transaction (all of its debits).
export function periodSpendAt(m, entries, tx_sig) {
  const sorted = [...entries].sort((a, b) => a.slot - b.slot);
  const at = sorted.findLastIndex((x) => x.tx_sig === tx_sig);
  if (at < 0) return { spent: 0n, over: false, found: false };
  const k = periodIndex(m, sorted[at].block_time);
  let spent = 0n;
  for (let i = 0; i <= at; i++) if (periodIndex(m, sorted[i].block_time) === k) spent += BigInt(sorted[i].amount);
  return { spent, over: fails(R.period_over_budget, spent > BigInt(m.period_budget)), found: true, period: k };
}
