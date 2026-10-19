// N2 (review v2-new.mjs): a second token debit in the same transaction must not turn a violation into "no verdict". The x402 path needs the WHOLE
// transaction to be the x402 shape; anything else that carries an agent debit of the source is debit_not_x402, agent operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { A, T0, SRC, mandate, payTx, ata } from '../fixtures.mjs';
import { chainSim, grantAt, live, sig } from '../regression/chainsim.mjs';
import { service, amt } from './helpers.mjs';

const M = mandate({ nonce: 'a2'.repeat(16) });
const G = sig('G');
async function judge(extra) {
  const AGENT_ATA = await ata(A.agent), X_ATA = await ata(A.sellerB);
  const p = payTx({ slot: 1100, blockTime: T0 + 1100, amount: '40000', payTo: A.sellerC }); // pay_to not allowed
  if (extra) {
    p.transaction.message.accountKeys.push({ pubkey: AGENT_ATA, signer: false, writable: true, source: 'transaction' }, { pubkey: X_ATA, signer: false, writable: true, source: 'transaction' });
    p.transaction.message.instructions.push({ programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transferChecked', info: { source: AGENT_ATA, destination: X_ATA, mint: A.asset, authority: A.agent, tokenAmount: amt('1') } } });
    const n = p.transaction.message.accountKeys.length;
    p.meta.preTokenBalances.push({ accountIndex: n - 2, mint: A.asset, owner: A.agent, uiTokenAmount: { amount: '5', decimals: 6 } }, { accountIndex: n - 1, mint: A.asset, owner: A.sellerB, uiTokenAmount: { amount: '0', decimals: 6 } });
    p.meta.postTokenBalances.push({ accountIndex: n - 2, mint: A.asset, owner: A.agent, uiTokenAmount: { amount: '4', decimals: 6 } }, { accountIndex: n - 1, mint: A.asset, owner: A.sellerB, uiTokenAmount: { amount: '1', decimals: 6 } });
  }
  const c = chainSim(); c.add('G', grantAt(M, 1000)); c.add('P', p); c.setAccount(SRC, live(M));
  const { svc, store } = service(c);
  return { v: await svc.dispute({ tx_sig: sig('P'), mandate: M, grant_tx: G, receipt: null }), store };
}
test('N2 control: 40000 to a seller not on the list is pay_to_not_allowed, agent operator', async () => {
  const { v } = await judge(false);
  assert.equal(v.reason, 'pay_to_not_allowed'); assert.equal(v.liable, 'agent_operator');
});
test('N2 plus 1 unit from the agent\'s own token account in the same transaction: debit_not_x402, agent operator, stored (the operator cannot step out of R3)', async () => {
  const { v, store } = await judge(true);
  assert.equal(v.verdict, 'valid', JSON.stringify(v)); assert.equal(v.reason, 'debit_not_x402'); assert.equal(v.liable, 'agent_operator'); assert.equal(store.count(), 1);
  assert.ok(v.delta.length >= 2, 'every debit of the transaction is listed');
});
