// G0.4 on localnet, through the REAL @x402/svm 2.28.0 facilitator code (ExactSvmScheme.verify/settle).
// Question per addendum A: can an x402 "exact" SVM payment be settled when the payer authority is
//  (a) an SPL ApproveChecked delegate, or (b) a Subscriptions & Allowances delegatee?
// Not proven here: any live facilitator operator's configuration (they may set smartWalletAllowedPrograms differently).
import fs from 'node:fs';
process.env.LOCALNET_RPC ??= 'http://127.0.0.1:8899';
const V = '../vendor/nuntius-mandate/dist';
const { requireLocal, funded, mintTo, ataFor, signAndLand, deviceSignAndSend, tokenBalance } = await import(`${V}/test/localnet.js`);
const { signAndSend, computeBudgetInstructions } = await import(`${V}/tx.js`);
const { buildGrantTx, pullInstruction, delegationPdaOf, userAtaOf } = await import(`${V}/mandate-chain.js`);
const { ExactSvmScheme } = await import('@x402/svm/exact/facilitator');
const { toFacilitatorSvmSigner } = await import('@x402/svm');
const kit = await import('@solana/kit');
const tok = await import('@solana-program/token');

const RPC_URL = process.env.LOCALNET_RPC;
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const PROGRAM = 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44';
const results = [];
const rec = (step, expect, got, extra = {}) => { const r = { step, expect, got, ...extra }; results.push(r); console.log(JSON.stringify(r)); };

const rpc = requireLocal();
const owner = await funded(rpc); const agent = await funded(rpc); const facilitator = await funded(rpc); const seller = await funded(rpc);
const { mint, ata: ownerAta } = await mintTo(rpc, owner, owner.address, 5_000_000n);
const sellerAta = await ataFor(rpc, seller, mint, seller.address);
const delegateOf = async () => {
  const a = await rpc.getAccountInfo(ownerAta, { encoding: 'jsonParsed' }).send();
  const i = a.value.data.parsed.info; return { delegate: i.delegate ?? null, delegatedAmount: i.delegatedAmount?.amount ?? null };
};

const bh = async () => (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
const memo = () => ({ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', data: crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '') });
memo.enc = (ix) => ({ ...ix, data: new TextEncoder().encode(ix.data) });

// An x402 "exact" payload: [CULimit, CUPrice, <pay ix>, Memo], fee payer = facilitator (unsigned), agent partial-signs.
async function x402Tx(payIx, unitLimit = 20_000) {
  const m = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (t) => kit.setTransactionMessageFeePayer(facilitator.address, t),
    (t) => kit.appendTransactionMessageInstructions([...computeBudgetInstructions({ unitLimit, microLamportsPerUnit: 1 }), payIx, memo.enc(memo())], t),
    async (t) => kit.setTransactionMessageLifetimeUsingBlockhash(await bh(), await t),
  );
  const signed = await kit.partiallySignTransactionMessageWithSigners(await m);
  return kit.getBase64EncodedWireTransaction(signed);
}
const reqs = (amount) => ({ scheme: 'exact', network: DEVNET, asset: mint, amount: String(amount), payTo: seller.address, maxTimeoutSeconds: 60, extra: { feePayer: facilitator.address } });
const payload = (r, transaction) => ({ x402Version: 2, resource: { url: 'http://probe/paid', description: '', mimeType: '' }, accepted: r, payload: { transaction } });
const fsigner = toFacilitatorSvmSigner(facilitator, { defaultRpcUrl: RPC_URL });
const scheme = (options) => new ExactSvmScheme(fsigner, undefined, options);

// ---------- (a) SPL ApproveChecked delegate on an account with NO Subscriptions authority
rec('a0 delegate before', 'none', await delegateOf());
const ap = await signAndSend(rpc, owner, [tok.getApproveCheckedInstruction({ source: ownerAta, mint, delegate: agent.address, owner, amount: 1_000_000n, decimals: 6 })]);
rec('a1 ApproveChecked 1.000000 to agent', 'landed', ap.err ?? 'ok', { sig: ap.signature });
rec('a1 delegate after', 'agent / 1000000', await delegateOf());

const transferIx = (amt) => tok.getTransferCheckedInstruction({ source: ownerAta, mint, destination: sellerAta, authority: agent, amount: BigInt(amt), decimals: 6 });
{
  const r = reqs(10_000); const tx = await x402Tx(transferIx(10_000));
  const v = await scheme().verify(payload(r, tx), r);
  rec('a2 facilitator verify: delegate-signed TransferChecked in cap', 'isValid true, payer=agent', { isValid: v.isValid, invalidReason: v.invalidReason, payer: v.payer, payerIsAgent: v.payer === agent.address });
  const s = await scheme().settle(payload(r, tx), r);
  rec('a3 facilitator settle', 'success', { success: s.success, errorReason: s.errorReason, transaction: s.transaction, payer: s.payer });
  rec('a3 seller balance', '10000', String(await tokenBalance(rpc, sellerAta)));
}
{
  const r = reqs(2_000_000); const tx = await x402Tx(transferIx(2_000_000));
  const v = await scheme().verify(payload(r, tx), r);
  rec('a4 facilitator verify: over the approved cap (2.0 vs 0.99)', 'isValid false', { isValid: v.isValid, invalidReason: v.invalidReason });
}
const rv = await signAndSend(rpc, owner, [tok.getRevokeInstruction({ source: ownerAta, owner })]);
rec('a5 Revoke', 'landed', rv.err ?? 'ok', { sig: rv.signature });
{
  const r = reqs(10_000); const tx = await x402Tx(transferIx(10_000));
  const v = await scheme().verify(payload(r, tx), r);
  rec('a6 facilitator verify after revoke', 'isValid false', { isValid: v.isValid, invalidReason: v.invalidReason });
}

// ---------- conflict: ApproveChecked delegate vs Subscriptions authority on ONE token account
await signAndSend(rpc, owner, [tok.getApproveCheckedInstruction({ source: ownerAta, mint, delegate: agent.address, owner, amount: 1_000_000n, decimals: 6 })]);
rec('c0 agent is SPL delegate again', 'agent / 1000000', await delegateOf());
const now = BigInt(Math.floor(Date.now() / 1000));
const terms = { owner: owner.address, mint, delegatee: agent.address, nonce: 0n, amountPerPeriod: 500_000n, periodLengthS: 3600n, startTs: 0n, expiryTs: now + 86_400n };
const grant = await buildGrantTx(rpc, terms);
const gl = await deviceSignAndSend(rpc, owner, grant.transactionBase64);
rec('c1 Subscriptions grant (init authority + recurring delegation) signed by owner', 'landed', gl.err ?? 'ok', { sig: gl.signature });
rec('c2 SPL delegate after Subscriptions grant', 'authority PDA, NOT agent', { ...(await delegateOf()), authorityPda: grant.authorityPda, agentWasDisplaced: (await delegateOf()).delegate !== agent.address });
{
  const r = reqs(10_000); const tx = await x402Tx(transferIx(10_000));
  const v = await scheme().verify(payload(r, tx), r);
  rec('c3 facilitator verify: agent SPL-delegate transfer after displacement', 'isValid false', { isValid: v.isValid, invalidReason: v.invalidReason });
}

// ---------- (b) Subscriptions delegatee as x402 payer authority
const { delegationPda } = await delegationPdaOf(owner.address, mint, agent.address, 0n);
const pull = (amt) => pullInstruction({ delegatee: agent, delegationPda, delegator: owner.address, delegatorAta: ownerAta, receiverAta: sellerAta, mint, amount: BigInt(amt) });
const bTx = await x402Tx(await pull(10_000), 100_000);
const r = reqs(10_000);
for (const [label, opts] of [
  ['b1 default options (smart-wallet path off)', undefined],
  ['b2 enableSmartWalletVerification, default allowed programs', { enableSmartWalletVerification: true }],
  ['b3 enableSmartWalletVerification + De1egAFM added to smartWalletAllowedPrograms', { enableSmartWalletVerification: true, smartWalletAllowedPrograms: [PROGRAM] }],
]) {
  const v = await scheme(opts).verify(payload(r, bTx), r);
  rec(`${label}: verify`, 'see got', { isValid: v.isValid, invalidReason: v.invalidReason, payer: v.payer, payerIsAgent: v.payer === agent.address });
}
{
  const before = await tokenBalance(rpc, sellerAta);
  const s = await scheme({ enableSmartWalletVerification: true, smartWalletAllowedPrograms: [PROGRAM] }).settle(payload(r, bTx), r);
  rec('b4 settle with De1egAFM allow-listed', 'see got', { success: s.success, errorReason: s.errorReason, transaction: s.transaction, payer: s.payer, sellerDelta: String((await tokenBalance(rpc, sellerAta)) - before) });
}
// ---------- reverse conflict: an SPL ApproveChecked to the agent AFTER the Subscriptions grant breaks the delegation
{
  const ap2 = await signAndSend(rpc, owner, [tok.getApproveCheckedInstruction({ source: ownerAta, mint, delegate: agent.address, owner, amount: 1_000_000n, decimals: 6 })]);
  rec('d1 ApproveChecked(agent) after Subscriptions grant', 'landed', ap2.err ?? 'ok', { sig: ap2.signature });
  rec('d2 SPL delegate now', 'agent (authority PDA displaced)', await delegateOf());
  const r2 = reqs(10_000); const tx2 = await x402Tx(await pull(10_000), 100_000);
  const v2 = await scheme({ enableSmartWalletVerification: true, smartWalletAllowedPrograms: [PROGRAM] }).verify(payload(r2, tx2), r2);
  rec('d3 Subscriptions pull verify after the displacement (allow-listed facilitator)', 'isValid false', { isValid: v2.isValid, invalidReason: v2.invalidReason });
}
fs.writeFileSync(new URL('./g04-local-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), rpc: 'localnet', x402svm: '2.28.0', results }, null, 1));
