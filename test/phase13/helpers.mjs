// Builders for the Phase 1.3 regression tests (Addendum F). Only shapes that exist at e065db0, so the same tests run against it (and must fail there).
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { A, T0, SRC, key, payTx } from '../fixtures.mjs';
import { amt, THIEF_ATA } from '../phase12/helpers.mjs';
export { service, amt, THIEF_ATA } from '../phase12/helpers.mjs';

// the agent moves `amount` from SRC to SRC (source == destination): the token program neither lowers the allowance nor moves anything
export function selfTransfer(kind, { slot, amount = '50000', authority = A.agent } = {}) {
  const tx = payTx({ slot, blockTime: T0 + slot, amount, payTo: A.principal, dest: SRC, authority, moved: 0 });
  const ixs = tx.transaction.message.instructions;
  const i = ixs.findIndex((x) => x.parsed?.type === 'transferChecked');
  if (kind === 'transfer') ixs[i] = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transfer', info: { source: SRC, destination: SRC, authority, amount } } };
  tx.meta.preTokenBalances = [tx.meta.preTokenBalances[0]];
  tx.meta.postTokenBalances = [{ ...tx.meta.preTokenBalances[0] }];
  return tx;
}
// a stranger credits SRC with `amount` (dust): the source balance rises, nobody the agent controls signs anything
export function dustCredit(slot, amount = '1') {
  const bal = (accountIndex, owner, n) => ({ accountIndex, mint: A.asset, owner, uiTokenAmount: { amount: String(n), decimals: 6 } });
  const keys = [key('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4', true, true), key(A.thief, true), key(THIEF_ATA, false, true), key(SRC, false, true), key(A.asset)];
  const tc = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transferChecked', info: { authority: A.thief, destination: SRC, mint: A.asset, source: THIEF_ATA, tokenAmount: amt(amount) } } };
  const a = BigInt(amount);
  return { slot, blockTime: T0 + slot, meta: { err: null, preTokenBalances: [bal(2, A.thief, 5000000n), bal(3, A.principal, 5000000n)], postTokenBalances: [bal(2, A.thief, 5000000n - a), bal(3, A.principal, 5000000n + a)] }, transaction: { signatures: [], message: { accountKeys: keys, instructions: [tc] } } };
}
