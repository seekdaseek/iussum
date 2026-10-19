// G0.4 live on devnet: ONE x402 payment settled through a real facilitator where the payer authority is a delegate.
//   STAGE=a  SPL ApproveChecked delegate (agent) on the principal's USDC account (no Subscriptions authority on it)
//   STAGE=b  Subscriptions & Allowances delegatee (agent) pulling via TransferRecurring (nuntius mandate-chain copy)
//   FAC=https://facilitator.payai.network | https://x402.org/facilitator
// Needs: .secrets/{principal,agent,seller}.json; principal funded with devnet SOL (>= 0.05) and devnet USDC (>= 1).
// Every landed signature and every facilitator answer is appended to docs/ALLOWANCE-live.jsonl.
// The iussum extension rides along as extensions.iussum.info (X402-SURFACE.md).
import fs from 'node:fs';
import express from 'express';
process.env.LOCALNET_RPC = '';
const V = '../vendor/nuntius-mandate/dist';
const { signAndSend, computeBudgetInstructions } = await import(`${V}/tx.js`);
const { buildGrantTx, pullInstruction, delegationPdaOf } = await import(`${V}/mandate-chain.js`);
const kit = await import('@solana/kit');
const tok = await import('@solana-program/token');
const { x402Client } = await import('@x402/core/client');
const { x402ResourceServer, HTTPFacilitatorClient } = await import('@x402/core/server');
const { paymentMiddleware } = await import('@x402/express');
const { wrapFetchWithPayment } = await import('@x402/fetch');
const { registerExactSvmScheme } = await import('@x402/svm/exact/server');

const STAGE = process.env.STAGE, FAC = process.env.FAC;
if (!['a', 'b'].includes(STAGE) || !FAC) throw new Error('set STAGE=a|b and FAC=<facilitator url>');
const RPC_URL = 'https://api.devnet.solana.com';
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'; // Circle devnet USDC, == @x402/svm USDC_DEVNET_ADDRESS
const rpc = kit.createSolanaRpc(RPC_URL);
const load = async (n) => kit.createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(new URL(`../.secrets/${n}.json`, import.meta.url), 'utf8'))));
const principal = await load('principal'), agent = await load('agent'), seller = await load('seller');
const log = (o) => { const line = JSON.stringify({ at: new Date().toISOString(), stage: STAGE, fac: FAC, ...o }); console.log(line); fs.appendFileSync(new URL('../docs/ALLOWANCE-live.jsonl', import.meta.url), line + '\n'); };

const [principalAta] = await tok.findAssociatedTokenPda({ mint: MINT, owner: principal.address, tokenProgram: tok.TOKEN_PROGRAM_ADDRESS });
const [sellerAta] = await tok.findAssociatedTokenPda({ mint: MINT, owner: seller.address, tokenProgram: tok.TOKEN_PROGRAM_ADDRESS });
const sol = (await rpc.getBalance(principal.address).send()).value;
const usdc = await rpc.getTokenAccountBalance(principalAta).send().then((r) => r.value.amount, () => null);
log({ step: 'preflight', principal: principal.address, agent: agent.address, seller: seller.address, principalLamports: String(sol), principalUsdcBase: usdc });
if (sol < 20_000_000n || usdc === null || BigInt(usdc) < 1_000_000n) { log({ step: 'STOP', reason: 'principal needs >= 0.02 SOL and >= 1 devnet USDC' }); process.exit(2); }

const land = async (label, signer, ixs) => { const r = await signAndSend(rpc, signer, ixs); log({ step: label, sig: r.signature, err: r.err }); return r; };
const sellerAtaInfo = await rpc.getAccountInfo(sellerAta, { encoding: 'base64' }).send();
if (!sellerAtaInfo.value) await land('create seller ATA', principal, [await tok.getCreateAssociatedTokenInstructionAsync({ payer: principal, mint: MINT, owner: seller.address })]);

let payIx; // built per payment inside the scheme
if (STAGE === 'a') {
  await land('ApproveChecked 1 USDC -> agent', principal, [tok.getApproveCheckedInstruction({ source: principalAta, mint: MINT, delegate: agent.address, owner: principal, amount: 1_000_000n, decimals: 6 })]);
  payIx = (amount) => tok.getTransferCheckedInstruction({ source: principalAta, mint: MINT, destination: sellerAta, authority: agent, amount: BigInt(amount), decimals: 6 });
} else {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (!process.env.SKIP_GRANT) {
  const grant = await buildGrantTx(rpc, { owner: principal.address, mint: MINT, delegatee: agent.address, nonce: BigInt(process.env.NONCE ?? 0), amountPerPeriod: 500_000n, periodLengthS: 3600n, startTs: 0n, expiryTs: now + 86_400n });
  const { deviceSignAndSend } = await import(`${V}/test/localnet.js`).catch(() => ({}));
  if (!deviceSignAndSend) throw new Error('localnet helper not importable');
  const l = await deviceSignAndSend(rpc, { keyPair: principal.keyPair }, grant.transactionBase64);
  log({ step: 'Subscriptions grant (init + recurring delegation)', sig: l.signature, err: l.err });
  }
  const { delegationPda } = await delegationPdaOf(principal.address, MINT, agent.address, BigInt(process.env.NONCE ?? 0));
  payIx = (amount) => pullInstruction({ delegatee: agent, delegationPda, delegator: principal.address, delegatorAta: principalAta, receiverAta: sellerAta, mint: MINT, amount: BigInt(amount) });
}

// agent-side scheme: same wire layout as @x402/svm's exact client, but source = principal's ATA, authority = agent.
const scheme = {
  scheme: 'exact',
  async createPaymentPayload(x402Version, req) {
    const bh = req.extra?.recentBlockhash
      ? { blockhash: req.extra.recentBlockhash, lastValidBlockHeight: BigInt(req.extra.lastValidBlockHeight ?? 0) }
      : (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
    const ix = await payIx(req.amount);
    const memo = { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', data: new TextEncoder().encode(Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('')) };
    const m = kit.pipe(
      kit.createTransactionMessage({ version: 0 }),
      (t) => kit.setTransactionMessageFeePayer(req.extra.feePayer, t),
      (t) => kit.appendTransactionMessageInstructions([...computeBudgetInstructions({ unitLimit: Number(process.env.CU ?? (STAGE === 'a' ? 20_000 : 100_000)), microLamportsPerUnit: 1 }), ix, memo], t),
      (t) => kit.setTransactionMessageLifetimeUsingBlockhash(bh, t),
    );
    const signed = await kit.partiallySignTransactionMessageWithSigners(m);
    return { x402Version, payload: { transaction: kit.getBase64EncodedWireTransaction(signed) } };
  },
};

const seen = { hook: null };
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FAC }));
registerExactSvmScheme(server, { networks: [DEVNET] });
server.onBeforeVerify(async (ctx) => { seen.hook = ctx.paymentPayload.extensions ?? null; });
const app = express();
app.use(paymentMiddleware({ 'GET /paid': { accepts: [{ scheme: 'exact', price: { amount: '10000', asset: MINT }, network: DEVNET, payTo: seller.address }], description: 'g04 probe', mimeType: 'application/json' } }, server));
app.get('/paid', (_req, res) => res.json({ ok: true }));
const srv = app.listen(0); await new Promise((r) => srv.once('listening', r));

const client = new x402Client();
client.setSpendControls(false); // custom scheme has no findDefaultAsset; the probe pays 0.01 USDC only
client.register(DEVNET, scheme);
client.registerExtension({ key: 'iussum', enrichPaymentPayload: async (p) => ({ ...p, extensions: { ...(p.extensions ?? {}), iussum: { info: { mandate: { v: 'iussum/0.1', note: 'probe-not-a-real-mandate' }, principal_sig: 'PROBE' } } } }) });
const r = await wrapFetchWithPayment(fetch, client)(`http://127.0.0.1:${srv.address().port}/paid`);
const pr = r.headers.get('payment-required'), resp = r.headers.get('payment-response');
log({
  step: `x402 payment, payer authority = ${STAGE === 'a' ? 'SPL delegate' : 'Subscriptions delegatee'}`,
  httpStatus: r.status,
  refusal: pr ? JSON.parse(Buffer.from(pr, 'base64').toString()).error : null,
  settle: resp ? JSON.parse(Buffer.from(resp, 'base64').toString()) : null,
  extensionSeenByHook: seen.hook,
});
srv.close();
if (STAGE === 'a') await land('Revoke SPL delegate', principal, [tok.getRevokeInstruction({ source: principalAta, owner: principal })]);
