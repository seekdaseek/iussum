// Devnet plumbing for the demo: keys, token accounts, the grant and revoke transactions, demo sellers on the REAL x402 stack, balances.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createKeyPairSignerFromBytes, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/kit';
import { getApproveCheckedInstruction, getRevokeInstruction, getTransferInstruction, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { registerExactSvmScheme } from '@x402/svm/exact/server';
import { makeRpc, principalAta, summaryLine, mandateId, receiptKey } from '@iussum/core';
import { createSellerGate } from '@iussum/seller';

export const NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const RPC_URL = process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com';
export const FACILITATOR = process.env.FACILITATOR ?? 'https://facilitator.payai.network';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadKeys() {
  const load = async (n) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(new URL(`../.secrets/${n}.json`, import.meta.url), 'utf8'))));
  return { principal: await load('principal'), agent: await load('agent'), sellerA: await load('seller'), sellerB: await load('seller2'), sellerC: await load('seller3'), float: await load('refund-float') };
}
export const makeCtx = () => ({ rpc: makeRpc(RPC_URL) });

export async function sendTx(rpc, feePayer, ixs) {
  const v = (await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(feePayer, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: v.blockhash, lastValidBlockHeight: BigInt(v.lastValidBlockHeight) }, m), (m) => appendTransactionMessageInstructions(ixs, m));
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  await rpc.call('sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  for (let i = 0; i < 45; i++) {
    const s = (await rpc.call('getSignatureStatuses', [[sig]])).value[0];
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { if (s.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`); return sig; }
    await sleep(1000);
  }
  throw new Error(`transaction ${sig} not confirmed in time`);
}

// The grant: ONE transaction, principal is fee payer and only signer: ApproveChecked(total_cap) + the Memo summary line.
export async function sendGrant(ctx, keys, mandate) {
  const src = await principalAta(mandate.principal, mandate.asset);
  return sendTx(ctx.rpc, keys.principal, [
    getApproveCheckedInstruction({ source: src, mint: mandate.asset, delegate: mandate.agent, owner: keys.principal, amount: BigInt(mandate.total_cap), decimals: 6 }, { programAddress: TOKEN_PROGRAM_ADDRESS }),
    { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: new TextEncoder().encode(summaryLine(mandate)) },
  ]);
}
export async function sendRevoke(ctx, keys) {
  const src = await principalAta(keys.principal.address, MINT);
  return sendTx(ctx.rpc, keys.principal, [getRevokeInstruction({ source: src, owner: keys.principal }, { programAddress: TOKEN_PROGRAM_ADDRESS })]);
}
// A plain SPL Transfer signed by the AGENT as delegate, out of the principal's account, outside x402 (no seller, no gate, no receipt).
// The refund-float key only pays the fee. Used by scenario 11 to show that such a debit cannot hide from the period count.
export async function sendPlainTransfer(ctx, keys, { to, amount }) {
  const src = await principalAta(keys.principal.address, MINT), dst = await principalAta(to, MINT);
  return sendTx(ctx.rpc, keys.float, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: keys.float, mint: MINT, owner: to }),
    getTransferInstruction({ source: src, destination: dst, authority: keys.agent, amount: BigInt(amount) }, { programAddress: TOKEN_PROGRAM_ADDRESS }),
  ]);
}
export async function usdc(ctx, owner) {
  const ata = await principalAta(owner, MINT);
  const r = await ctx.rpc.call('getTokenAccountBalance', [ata, { commitment: 'confirmed' }]).catch(() => null);
  return BigInt(r?.value?.amount ?? 0);
}

// What the token program still lets the delegate move: the principal's account delegate and delegated amount, read from the chain (Addendum L, scenario 16).
export async function delegation(ctx, owner) {
  const ata = await principalAta(owner, MINT);
  const info = (await ctx.rpc.call('getAccountInfo', [ata, { encoding: 'jsonParsed', commitment: 'confirmed' }]))?.value?.data?.parsed?.info;
  return { delegate: info?.delegate ?? null, amount: BigInt(info?.delegatedAmount?.amount ?? 0) };
}

// A demo seller on the real x402 stack with the iussum gate mounted ahead of paymentMiddleware.
export async function startDemoSeller(ctx, { name, signer, mode }) {
  const srv = http.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}`; // the seller's own canonical origin: the resource it signs is origin + path, never the Host header
  const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-gate-')); // the gate keeps the receipts it signs in its own SQLite file (Phase 1.5, H1)
  const gate = createSellerGate({ mode, payTo: signer.address, asset: MINT, network: NETWORK, rpc: ctx.rpc, origin, dataDir: gateDir, key: receiptKey(), log: (e) => { if (e.reason) console.log(`      [seller ${name}] mode=${e.mode} ${e.refuse ? 'REFUSES' : 'saw'} ${e.reason}`); } });
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR }));
  registerExactSvmScheme(server, { networks: [NETWORK] });
  const route = (amount) => ({ accepts: [{ scheme: 'exact', price: { amount, asset: MINT }, network: NETWORK, payTo: signer.address }], description: `demo ${amount}`, mimeType: 'application/json' });
  const app = express();
  app.get('/.well-known/iussum.json', gate.wellKnown);
  app.use(gate.middleware);
  app.use(paymentMiddleware({ 'GET /v1/quote': route('10000'), 'GET /v1/mid': route('20000'), 'GET /v1/big': route('60000') }, server));
  for (const p of ['quote', 'mid', 'big']) app.get(`/v1/${p}`, (_req, res) => res.json({ ok: true, seller: name, item: p }));
  srv.on('request', app);
  return { name, origin, gate, address: signer.address, url: (p = 'quote') => `${origin}/v1/${p}`, close: () => { srv.close(); gate.close(); fs.rmSync(gateDir, { recursive: true, force: true }); } };
}
export { mandateId };
