// One-off devnet setup for Phase 1: seller2, seller3 and the refund-float wallet get USDC accounts; the
// refund float gets 0.5 devnet USDC and 0.02 SOL from the throw-away principal. Devnet only.
import fs from 'node:fs';
import { createSolanaRpc, createKeyPairSignerFromBytes, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
const RPC = 'https://api.devnet.solana.com', MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const rpc = createSolanaRpc(RPC);
const load = async (n) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(new URL(`../.secrets/${n}.json`, import.meta.url), 'utf8'))));
const [principal, s2, s3, float] = await Promise.all(['principal', 'seller2', 'seller3', 'refund-float'].map(load));
const [pAta] = await findAssociatedTokenPda({ mint: MINT, owner: principal.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const [fAta] = await findAssociatedTokenPda({ mint: MINT, owner: float.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const sysTransfer = (to, lamports) => ({ programAddress: '11111111111111111111111111111111', accounts: [{ address: principal.address, role: 3 }, { address: to, role: 1 }], data: Uint8Array.from([2, 0, 0, 0, ...new Uint8Array(new BigUint64Array([lamports]).buffer)]) });
const ixs = [
  sysTransfer(float.address, 20_000_000n),
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: principal, mint: MINT, owner: s2.address }),
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: principal, mint: MINT, owner: s3.address }),
  await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: principal, mint: MINT, owner: float.address }),
  getTransferCheckedInstruction({ source: pAta, mint: MINT, destination: fAta, authority: principal, amount: 500_000n, decimals: 6 }),
];
const { value: bh } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(principal, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions(ixs, m));
const signed = await signTransactionMessageWithSigners(msg);
await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
const sig = getSignatureFromTransaction(signed);
for (let i = 0; i < 30; i++) { const s = (await rpc.getSignatureStatuses([sig]).send()).value[0]; if (s?.confirmationStatus) { console.log(JSON.stringify({ sig, status: s.confirmationStatus, err: s.err, seller2: s2.address, seller3: s3.address, refundFloat: float.address })); break; } await new Promise((r) => setTimeout(r, 1000)); }
