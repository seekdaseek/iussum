// Fund the Seed Vault test account natX on DEVNET from the throw-away principal: 0.02 SOL + 1 devnet USDC.
// Devnet RPC only. The principal signs; natX gets its USDC account created by the principal (idempotent).
import fs from 'node:fs';
const kit = await import('@solana/kit');
const tok = await import('@solana-program/token');
const sys = await import('@solana-program/system');
const RPC = 'https://api.devnet.solana.com';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const NATX = 'ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX';
const rpc = kit.createSolanaRpc(RPC);
const principal = await kit.createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(new URL('../.secrets/principal.json', import.meta.url), 'utf8'))));
const [srcAta] = await tok.findAssociatedTokenPda({ mint: MINT, owner: principal.address, tokenProgram: tok.TOKEN_PROGRAM_ADDRESS });
const [dstAta] = await tok.findAssociatedTokenPda({ mint: MINT, owner: NATX, tokenProgram: tok.TOKEN_PROGRAM_ADDRESS });
console.log(JSON.stringify({ natxUsdcAta: dstAta, principalUsdcAta: srcAta }));
const ixs = [
  sys.getTransferSolInstruction({ source: principal, destination: NATX, amount: 20_000_000n }),
  await tok.getCreateAssociatedTokenIdempotentInstructionAsync({ payer: principal, mint: MINT, owner: NATX }),
  tok.getTransferCheckedInstruction({ source: srcAta, mint: MINT, destination: dstAta, authority: principal, amount: 1_000_000n, decimals: 6 }),
];
const { value: bh } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
const msg = kit.pipe(kit.createTransactionMessage({ version: 0 }), (m) => kit.setTransactionMessageFeePayerSigner(principal, m), (m) => kit.setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => kit.appendTransactionMessageInstructions(ixs, m));
const signed = await kit.signTransactionMessageWithSigners(msg);
const sig = kit.getSignatureFromTransaction(signed);
await rpc.sendTransaction(kit.getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
for (let i = 0; i < 30; i++) { const s = (await rpc.getSignatureStatuses([sig]).send()).value[0]; if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { console.log(JSON.stringify({ sig, status: s.confirmationStatus, err: s.err })); break; } await new Promise((r) => setTimeout(r, 1000)); }
const bal = await rpc.getBalance(NATX).send(); const ta = await rpc.getTokenAccountBalance(dstAta).send();
console.log(JSON.stringify({ natxLamports: String(bal.value), natxUsdcBase: ta.value.amount }));
