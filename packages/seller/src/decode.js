// Read the payer, amount and accounts out of the x402 "exact" SVM payment transaction the agent sent (the transaction inside
// PAYMENT-SIGNATURE). The seller checks THIS, not a number the client claims: the payer is the transfer's authority (the agent, as the
// SPL delegate) and the amount is the one that will move.
import { getTransactionDecoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
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
export function readPaymentHeader(req) {
  const h = req.get('payment-signature') ?? req.get('x-payment');
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, 'base64').toString('utf8')); } catch { return null; }
}
