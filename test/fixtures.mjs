// Shared fixtures for the golden-vector generator and the seller/agent/resolver tests: fixed addresses, fixed keys and fixed times,
// builders for jsonParsed-shaped getTransaction results (grant and payment) and for signed receipts.
import { mandateId, summaryLine, signReceipt, receiptKey, offerHash, COMPUTE_BUDGET, MEMO_V2 } from '@iussum/core';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export const A = { principal: 'BSC8EyZJr19cqzYw3e7UnoDjsNJS4RGiE8rdoo4pJgiU', agent: '4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi', sellerA: '5hQASoTWuCSjSz3GfUmrVDfUKEvRMDLpqUK1wuUi5Gk7', sellerB: '2uh7t2wh3omQNzzRypGj1rVJhtmJ6HtR4qFy9f2aNbg9', sellerC: 'BpunsCzN5vTo9ZpaunCEwCzzWAHEMYTcd9LY5VZqhWji', asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', otherMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', thief: 'B2bWqgDYnJ3g5Vyc7useHitYRCMpUNykEtzfuaYSYj1T', net: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' };
export const T0 = 1_800_000_000, DAY = 86400;
export const ata = async (owner, mint = A.asset) => (await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
export const SRC = await ata(A.principal);
export const DEST = { [A.sellerA]: await ata(A.sellerA), [A.sellerB]: await ata(A.sellerB), [A.sellerC]: await ata(A.sellerC) };
export const RES = 'https://api.example.test/v1/';
export const SELLER_KEY = receiptKey(Buffer.alloc(32, 1)), WRONG_KEY = receiptKey(Buffer.alloc(32, 2));
export const mandate = (o = {}) => ({ v: 'iussum/0.2', principal: A.principal, agent: A.agent, network: A.net, asset: A.asset, total_cap: '1000000', per_payment_max: '50000', period_budget: '100000', period_seconds: DAY, allow: { pay_to: [A.sellerA, A.sellerB], resource_prefix: [RES] }, not_before: T0, expires_at: T0 + 7 * DAY, nonce: '00112233445566778899aabbccddeeff', ...o });
export const M = mandate(), MID = mandateId(M);

export const key = (pubkey, signer = false, writable = false) => ({ pubkey, signer, writable, source: 'transaction' });
export function grantTx(m, o = {}) {
  const principal = o.feePayer ?? m.principal;
  const info = { delegate: o.delegate ?? m.agent, mint: o.mint ?? m.asset, owner: o.owner ?? m.principal, source: o.source ?? SRC, tokenAmount: { amount: o.amount ?? m.total_cap, decimals: 6, uiAmount: 0, uiAmountString: '0' } };
  const approve = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'approveChecked', info } };
  const memo = { programId: MEMO_V2, program: 'spl-memo', parsed: o.memo ?? summaryLine(m) };
  const cb = (d) => ({ programId: COMPUTE_BUDGET, accounts: [], data: d });
  let ixs = o.ixs ?? [approve, memo, ...(o.seedVault === false ? [] : [cb('HMypLP'), cb('3gJqkocMWaMm')])];
  if (o.extra) ixs = [...ixs, o.extra];
  if (o.drop) ixs = ixs.filter((_, i) => !o.drop.includes(i));
  const keys = [key(principal, true, true), key(SRC, false, true), key(info.delegate), key(info.mint), ...(o.signers ?? []).map((p) => key(p, true, false))];
  return { slot: 1000, blockTime: T0 + 10, meta: { err: o.err ?? null }, transaction: { message: { accountKeys: keys, instructions: ixs, ...(o.lookup ? { addressTableLookups: [{ accountKey: A.thief, readonlyIndexes: [], writableIndexes: [] }] } : {}) } } };
}
export function payTx(o = {}) {
  const payTo = o.payTo ?? A.sellerA, mint = o.mint ?? A.asset, authority = o.authority ?? A.agent;
  const dest = o.dest ?? DEST[payTo];
  const keys = [key('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4', true, true), key(authority, true), key(o.source ?? SRC, false, true), key(dest, false, true), key(mint)];
  const tc = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transferChecked', info: { authority, destination: dest, mint, source: o.source ?? SRC, tokenAmount: { amount: o.amount ?? '10000', decimals: 6, uiAmount: 0, uiAmountString: '0' } } } };
  return { slot: o.slot ?? 2000, blockTime: o.blockTime === undefined ? T0 + 100 : o.blockTime, meta: { err: o.err ?? null, postTokenBalances: [{ accountIndex: 3, mint, owner: payTo }] }, transaction: { message: { accountKeys: keys, instructions: [{ programId: COMPUTE_BUDGET, accounts: [], data: 'x' }, { programId: COMPUTE_BUDGET, accounts: [], data: 'y' }, ...(o.noTransfer ? [] : [tc]), ...(o.twoTransfers ? [tc] : [])] } } };
}
export const SIG = (c) => c.repeat(88);
export function receipt(o = {}) {
  const body = { v: 'iussum/0.2', mandate_id: o.mandate_id === undefined ? MID : o.mandate_id, grant_tx: o.grant_tx === undefined ? SIG('G') : o.grant_tx, offer_hash: offerHash({ scheme: 'exact', network: A.net }), resource: o.resource ?? `${RES}quote`, pay_to: o.pay_to ?? A.sellerA, asset: o.asset ?? A.asset, network: A.net, amount: o.amount ?? '10000', payer: o.payer ?? A.agent, tx_sig: o.tx_sig ?? SIG('P'), settled_at: o.settled_at ?? T0 + 100, seller: (o.key ?? SELLER_KEY).publicKey };
  return signReceipt(body, o.key ?? SELLER_KEY);
}
