// Read the payer, amount and accounts out of the x402 "exact" SVM payment transaction the agent sent (the transaction inside
// PAYMENT-SIGNATURE). The seller checks THIS, not a number the client claims: the payer is the transfer's authority (the agent, as the
// SPL delegate) and the amount is the one that will move.
import { getTransactionDecoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { fails, registerCheck } from '@iussum/core';
export const DECODE_CHECKS = ['seller.header_x402_decoder', 'seller.header_only_signature', 'seller.header_undecodable_refused'].map(registerCheck);
const txDec = getTransactionDecoder(), msgDec = getCompiledTransactionMessageDecoder();

export function decodePayment(base64Tx) {
  const bytes = Uint8Array.from(Buffer.from(base64Tx, 'base64'));
  const { messageBytes } = txDec.decode(bytes);
  const msg = msgDec.decode(messageBytes);
  if (msg.addressTableLookups?.length) throw new Error('address lookup tables are not supported');
  const accounts = msg.staticAccounts.map(String);
  const transfers = [];
  for (const ix of msg.instructions) {
    if (accounts[ix.programAddressIndex] !== TOKEN_PROGRAM_ADDRESS) continue;
    const d = ix.data;
    if (!d || d[0] !== 12 || d.length < 10) continue; // TransferChecked
    const idx = ix.accountIndices;
    transfers.push({ source: accounts[idx[0]], mint: accounts[idx[1]], destination: accounts[idx[2]], authority: accounts[idx[3]], amount: new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(1, true).toString(), decimals: d[9] });
  }
  if (transfers.length !== 1) throw new Error(`expected exactly one TransferChecked, found ${transfers.length}`);
  return transfers[0];
}
// The gate must see exactly the payment x402 will settle (Addendum P, P4). x402 2.28 reads the `payment-signature` header only and decodes it with atob + TextDecoder (which drops a
// leading UTF-8 BOM) after a base64 pattern check: the gate decodes with x402's own function, so a spelling x402 accepts is a spelling the gate judges. A header that is present
// and cannot be decoded is not "no payment": it throws, and the middleware refuses it.
export class PaymentHeaderError extends Error { constructor(message) { super(message); this.name = 'PaymentHeaderError'; } }
export function readPaymentHeader(req) {
  const h = fails('seller.header_only_signature', true) ? req.get('payment-signature') : (req.get('payment-signature') ?? req.get('x-payment'));
  if (!h) return null; // x402 treats an empty header as absent too
  let v;
  try { v = fails('seller.header_x402_decoder', true) ? decodePaymentSignatureHeader(h) : JSON.parse(Buffer.from(h, 'base64').toString('utf8')); }
  catch (e) { if (fails('seller.header_undecodable_refused', true)) throw new PaymentHeaderError(`payment-signature header cannot be decoded: ${e.message}`); return null; }
  if (fails('seller.header_undecodable_refused', v === null || typeof v !== 'object' || Array.isArray(v))) throw new PaymentHeaderError('payment-signature header is not a JSON object');
  return v;
}
