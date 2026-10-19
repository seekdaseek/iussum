// Demo refund executor: a TransferChecked from the refund-float wallet's token account to the principal's token account. Devnet only.
import { pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, getSignatureFromTransaction } from '@solana/kit';
import { getTransferCheckedInstruction, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { principalAta } from '@iussum/core';
export function makeRefundSender({ rpc, float }) {
  return async ({ to, mint, amount, reason }) => {
    const [src, dst] = [await principalAta(float.address, mint), await principalAta(to, mint)];
    const ixs = [await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: float, mint, owner: to }), getTransferCheckedInstruction({ source: src, mint, destination: dst, authority: float, amount: BigInt(amount), decimals: 6 }, { programAddress: TOKEN_PROGRAM_ADDRESS })];
    const { value: bh } = await rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]).then((v) => ({ value: v.value }));
    const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(float, m), (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.blockhash, lastValidBlockHeight: BigInt(bh.lastValidBlockHeight) }, m), (m) => appendTransactionMessageInstructions(ixs, m));
    const signed = await signTransactionMessageWithSigners(msg);
    await rpc.call('sendTransaction', [getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    const sig = getSignatureFromTransaction(signed);
    for (let i = 0; i < 40; i++) { const s = (await rpc.call('getSignatureStatuses', [[sig]])).value[0]; if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') { if (s.err) throw new Error(`refund failed: ${JSON.stringify(s.err)}`); return sig; } await new Promise((r) => setTimeout(r, 1000)); }
    throw new Error('refund not confirmed in time');
  };
}
