// Shared builders for the Phase 1.2 regression tests (Addendum E). They only use shapes that exist at the section 1 HEAD, so the same
// test runs against that commit (and must fail there) and against the fixed code.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, ata, payTx } from '../fixtures.mjs';

export const THIEF_ATA = await ata(A.thief);
export const amt = (a) => ({ amount: a, decimals: 6, uiAmount: 0, uiAmountString: '0' });
export const service = (rpc, { sendRefund = null, store = openStore() } = {}) => ({ store, svc: createResolver({ rpc, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, sendRefund, now: () => T0 + 9999 }) });

// a debit by the agent out of SRC in the given form; balances move by what the instruction really moves
export function debitTx(kind, { slot, amount = '50000', authority = A.agent } = {}) {
  const base = payTx({ slot, blockTime: T0 + slot, amount, payTo: A.sellerA, authority });
  const ixs = base.transaction.message.instructions;
  const tcIdx = ixs.findIndex((i) => i.parsed?.type === 'transferChecked');
  const tc = ixs[tcIdx];
  if (kind === 'transfer') ixs[tcIdx] = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transfer', info: { source: SRC, destination: THIEF_ATA, authority, amount } } };
  if (kind === 'burnChecked') ixs[tcIdx] = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'burnChecked', info: { account: SRC, mint: A.asset, authority, tokenAmount: amt(amount) } } };
  if (kind === 'burn') ixs[tcIdx] = { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'burn', info: { account: SRC, mint: A.asset, authority, amount } } };
  if (kind === 'cpi') {
    ixs[tcIdx] = { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', accounts: [SRC], data: 'abc' };
    base.meta.innerInstructions = [{ index: tcIdx, instructions: [{ ...tc, stackHeight: 2 }] }];
  }
  if (kind === 'twoTransfers') ixs.push({ ...tc, parsed: { ...tc.parsed, info: { ...tc.parsed.info, destination: THIEF_ATA } } });
  if (kind === 'unparsed') { // the balance drops by `amount` but no instruction the parser knows explains it
    ixs[tcIdx] = { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', accounts: [SRC], data: 'abc' };
    base.meta.innerInstructions = [{ index: tcIdx, instructions: [{ programId: TOKEN_PROGRAM_ADDRESS, accounts: [SRC], data: 'zz', stackHeight: 2 }] }];
  }
  const drop = kind === 'twoTransfers' ? 2n * BigInt(amount) : BigInt(amount);
  const pre = BigInt(base.meta.preTokenBalances[0].uiTokenAmount.amount);
  base.meta.postTokenBalances[0].uiTokenAmount.amount = String(pre - drop);
  return base;
}
