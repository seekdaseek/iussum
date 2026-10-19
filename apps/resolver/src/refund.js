// Demo refund executor: a TransferChecked from the refund-float wallet's token account to the principal's token account. Devnet only.
// `decimals` comes from the disputed payment's own transfer (chain-proven), not from a constant (Addendum C, fix 11).
// hooks.onSigned(signature) is called after signing and BEFORE broadcasting, so a caller can record a pending attempt (fix 9).
import { pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/kit';
import { getTransferCheckedInstruction, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { principalAta, mintDecimals } from '@iussum/core';
export function makeRefundSender({ rpc, float }) {
  return async ({ to, mint, amount, decimals, reason }, hooks = {}) => {
    const dec = Number.isInteger(decimals) ? decimals : await mintDecimals(rpc, mint);
    const [src, dst] = [await principalAta(float.address, mint), await principalAta(to, mint)];
    const ixs = [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: float, mint, owner: to }), getTransferCheckedInstruction({ source: src, mint, destination: dst, authority: float, amount: BigInt(amount), decimals: dec }, { programAddress: TOKEN_PROGRAM_ADDRESS })];
    const { value: bh } = await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(float, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m), (m) => appendTransactionMessageInstructions(ixs, m));
    const signed = await signTransactionMessageWithSigners(msg);
    const sig = getSignatureFromTransaction(signed);
    if (hooks.onSigned) await hooks.onSigned(sig);
    await rpc.call('sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    for (let i = 0; i < 40; i++) { const s = (await rpc.call('getSignatureStatuses', [[sig]])).value[0]; if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { if (s.err) throw new Error(`refund failed: ${JSON.stringify(s.err)}`); return sig; } await new Promise((r) => setTimeout(r, 1000)); }
    throw new Error('refund not confirmed in time');
  };
}
