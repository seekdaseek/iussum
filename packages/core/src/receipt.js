// Seller receipt (Addendum B): carries mandate_id AND grant_tx. Ed25519 over "iussum/0.2 receipt\n" + JCS(body); the seller public key is
// published at /.well-known/iussum.json. A receipt without a mandate has mandate_id and grant_tx null: it proves the seller saw none.
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, randomBytes } from 'node:crypto';
import { getAddressDecoder, getAddressEncoder, isAddress } from '@solana/kit';
import { canonicalize, sha256Hex } from './jcs.js';
import { fails, registerCheck } from './guard.js';

export const RECEIPT_VERSION = 'iussum/0.2';
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
export const RECEIPT_CHECKS = ['receipt.signature', 'receipt.shape'].map(registerCheck);
const FIELDS = ['v', 'mandate_id', 'grant_tx', 'offer_hash', 'resource', 'pay_to', 'asset', 'network', 'amount', 'payer', 'tx_sig', 'settled_at', 'seller'];

export function receiptKey(seed = randomBytes(32)) {
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
  const raw = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  return { privateKey, seed: Buffer.from(seed), publicKey: getAddressDecoder().decode(new Uint8Array(raw)) };
}
export const offerHash = (requirements) => sha256Hex(canonicalize(requirements));
const message = (body) => Buffer.from(`iussum/${RECEIPT_VERSION.split('/')[1]} receipt\n${canonicalize(body)}`, 'utf8');
export function signReceipt(body, key) {
  const { signature: _drop, ...b } = body;
  const sig = edSign(null, message(b), key.privateKey);
  return { ...b, signature: sig.toString('base64') };
}
export function receiptShapeErrors(r) {
  const e = [];
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return ['receipt is not an object'];
  for (const k of [...FIELDS, 'signature']) if (!(k in r)) e.push(`missing ${k}`);
  for (const k of Object.keys(r)) if (![...FIELDS, 'signature'].includes(k)) e.push(`unknown key ${k}`);
  if (e.length) return e;
  if (r.v !== RECEIPT_VERSION) e.push('bad v');
  if ((r.mandate_id === null) !== (r.grant_tx === null)) e.push('mandate_id and grant_tx must both be set or both null');
  if (r.mandate_id !== null && !/^[0-9a-f]{64}$/.test(r.mandate_id)) e.push('mandate_id is not 64 hex');
  if (!/^[0-9a-f]{64}$/.test(r.offer_hash)) e.push('offer_hash is not 64 hex');
  if (!/^(0|[1-9][0-9]*)$/.test(r.amount)) e.push('amount is not a decimal string');
  for (const k of ['pay_to', 'asset', 'payer', 'seller']) if (!isAddress(r[k])) e.push(`${k} is not an address`);
  if (!Number.isSafeInteger(r.settled_at)) e.push('settled_at is not unix seconds');
  if (typeof r.tx_sig !== 'string' || typeof r.resource !== 'string' || typeof r.network !== 'string') e.push('tx_sig, resource, network must be strings');
  return e;
}
// pubkeyB58 comes from a trusted place (the seller's .well-known, pinned), never from the receipt itself.
export function verifyReceipt(r, pubkeyB58) {
  if (fails('receipt.shape', receiptShapeErrors(r).length > 0)) return { ok: false, why: `shape: ${receiptShapeErrors(r).join('; ')}` };
  if (!pubkeyB58) return { ok: false, why: 'seller key unknown' };
  if (r.seller !== pubkeyB58) return { ok: false, why: 'receipt names another seller key' };
  const { signature, ...body } = r;
  const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(getAddressEncoder().encode(pubkeyB58))]), format: 'der', type: 'spki' });
  const ok = edVerify(null, message(body), key, Buffer.from(signature, 'base64'));
  return fails('receipt.signature', !ok) ? { ok: false, why: 'bad signature' } : { ok: true };
}
export const encodeReceipt = (r) => Buffer.from(canonicalize(r), 'utf8').toString('base64url');
export const decodeReceipt = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
