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

// an x402-shaped payment (agent TransferChecked out of SRC) plus a second agent debit of 1 unit from the agent's own account (Addendum F, N2)
import { TOKEN_PROGRAM_ADDRESS as TOKEN_PROGRAM } from '@solana-program/token';
import { ata } from '../fixtures.mjs';
export async function payWithExtraDebit(slot, { amount = '10000', payTo = A.sellerA } = {}) {
  const AGENT_ATA = await ata(A.agent), X_ATA = await ata(A.sellerB);
  const p = payTx({ slot, blockTime: T0 + slot, amount, payTo });
  p.transaction.message.accountKeys.push({ pubkey: AGENT_ATA, signer: false, writable: true, source: 'transaction' }, { pubkey: X_ATA, signer: false, writable: true, source: 'transaction' });
  p.transaction.message.instructions.push({ programId: TOKEN_PROGRAM, program: 'spl-token', parsed: { type: 'transferChecked', info: { source: AGENT_ATA, destination: X_ATA, mint: A.asset, authority: A.agent, tokenAmount: amt('1') } } });
  const n = p.transaction.message.accountKeys.length;
  p.meta.preTokenBalances.push({ accountIndex: n - 2, mint: A.asset, owner: A.agent, uiTokenAmount: { amount: '5', decimals: 6 } }, { accountIndex: n - 1, mint: A.asset, owner: A.sellerB, uiTokenAmount: { amount: '0', decimals: 6 } });
  p.meta.postTokenBalances.push({ accountIndex: n - 2, mint: A.asset, owner: A.agent, uiTokenAmount: { amount: '4', decimals: 6 } }, { accountIndex: n - 1, mint: A.asset, owner: A.sellerB, uiTokenAmount: { amount: '1', decimals: 6 } });
  return p;
}
// the associated token account is created in this transaction (no pre balance) with `amount` in it
export function recreateTx(slot, amount = '1') {
  const tx = dustCredit(slot, amount);
  tx.meta.preTokenBalances = tx.meta.preTokenBalances.filter((b) => b.accountIndex !== 3); // SRC had no balance entry before
  tx.meta.postTokenBalances = tx.meta.postTokenBalances.map((b) => (b.accountIndex === 3 ? { ...b, uiTokenAmount: { amount: String(amount), decimals: 6 } } : b));
  tx.meta.preTokenBalances = tx.meta.preTokenBalances.map((b) => (b.accountIndex === 2 ? { ...b, uiTokenAmount: { amount: String(5000000n), decimals: 6 } } : b));
  tx.meta.postTokenBalances = tx.meta.postTokenBalances.map((b) => (b.accountIndex === 2 ? { ...b, uiTokenAmount: { amount: String(5000000n - BigInt(amount)), decimals: 6 } } : b));
  return tx;
}

// a self-transfer made by CPI (an inner instruction of another program)
export function selfInner(slot, { amount = '50000' } = {}) {
  const tx = selfTransfer('transferChecked', { slot, amount });
  const ixs = tx.transaction.message.instructions;
  const i = ixs.findIndex((x) => x.parsed?.type === 'transferChecked');
  const inner = ixs[i];
  ixs[i] = { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', accounts: [SRC], data: 'abc' };
  tx.meta.innerInstructions = [{ index: i, instructions: [{ ...inner, stackHeight: 2 }] }];
  return tx;
}
// a self-transfer authorised through a multisig authority (the info names multisigAuthority, not authority)
export function selfMulti(slot, { amount = '50000' } = {}) {
  const tx = selfTransfer('transferChecked', { slot, amount });
  const i = tx.transaction.message.instructions.findIndex((x) => x.parsed?.type === 'transferChecked');
  const { authority, ...rest } = tx.transaction.message.instructions[i].parsed.info;
  tx.transaction.message.instructions[i].parsed.info = { ...rest, multisigAuthority: authority, signers: [authority] };
  return tx;
}
