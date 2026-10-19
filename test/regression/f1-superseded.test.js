// Finding 1: a mandate that was superseded by a later grant on the same account must not stay active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker, mandateId } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, tokenIx, live, sig } from './chainsim.mjs';

const M1 = mandate({ total_cap: '1000000', per_payment_max: '50000', nonce: '01'.repeat(16) });
const M2 = mandate({ total_cap: '500000', per_payment_max: '20000', nonce: '02'.repeat(16) });
const G1 = sig('G1'), G2 = sig('G2'), P1 = sig('P1');

function twoGrants() {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000));
  c.add('P1', payAt(1100, { amount: '10000' }));
  c.add('G2', grantAt(M2, 1200));
  c.setAccount(SRC, live(M2)); // the account's current delegate is still the agent: the old check cannot tell M1 from M2
  return c;
}

test('F1: after M2 is granted, M1 (broader, older) fails the grant check with superseded by <sig>', async () => {
  const c = twoGrants();
  const checker = createGrantChecker(c);
  const r1 = await checker.check(M1, G1, { active: true });
  assert.equal(r1.ok, false, 'M1 must not stay active');
  assert.equal(r1.reason, 'grant_inactive');
  assert.match(r1.detail, new RegExp(`superseded by ${G2}`));
  const r2 = await checker.check(M2, G2, { active: true });
  assert.equal(r2.ok, true, 'M2 is the current grant');
});
test('F1: the agent\'s own payments after the grant do not supersede it', async () => {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000)); c.add('P1', payAt(1100)); c.add('P2', payAt(1101));
  c.setAccount(SRC, live(M1));
  assert.equal((await createGrantChecker(c).check(M1, G1, { active: true })).ok, true);
});
for (const [type, info] of [
  ['approve', { source: SRC, delegate: A.thief, owner: A.principal, amount: '1' }],
  ['approveChecked', { source: SRC, mint: A.asset, delegate: A.agent, owner: A.principal, tokenAmount: { amount: '500000' } }],
  ['revoke', { source: SRC, owner: A.principal }],
  ['setAuthority', { account: SRC, authorityType: 'accountOwner', newAuthority: A.thief, authority: A.principal }],
  ['closeAccount', { account: SRC, destination: A.principal, owner: A.principal }],
]) test(`F1: a later ${type} on the source account supersedes the grant`, async () => {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000)); c.add('X1', tokenIx(type, info, 1050));
  c.setAccount(SRC, live(M1));
  const r = await createGrantChecker(c).check(M1, G1, { active: true });
  assert.equal(r.ok, false); assert.equal(r.reason, 'grant_inactive'); assert.match(r.detail, /superseded by/);
});
test('F1: the superseding instruction is found when it is more than one page behind the newest signature', async () => {
  const c = chainSim();
  c.add('G1', grantAt(M1, 1000)); c.add('G2', grantAt(M2, 1001));
  for (let i = 0; i < 230; i++) c.add(`PP${i}`, payAt(1100 + i));
  c.setAccount(SRC, live(M2));
  const r = await createGrantChecker(c).check(M1, G1, { active: true });
  assert.equal(r.ok, false); assert.match(r.detail, new RegExp(`superseded by ${G2}`));
});
test('F1: the resolver rejects a mandate superseded before the payment slot as mandate_superseded, liable null, not stored', async () => {
  const c = twoGrants();
  const P2 = 'P2'; c.add(P2, payAt(1300, { amount: '10000' })); // paid after G2 under M1's id
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  const rc = receipt({ mandate_id: mandateId(M1), grant_tx: G1, tx_sig: sig(P2), settled_at: T0 + 1300 });
  const v = await service.dispute({ tx_sig: sig(P2), mandate: M1, grant_tx: G1, receipt: rc });
  assert.equal(v.reason, 'mandate_superseded'); assert.equal(v.liable, null); assert.equal(store.count(), 0);
});
test('F1: a payment made BEFORE the supersession is still judged under the mandate that was current then', async () => {
  const c = twoGrants();
  const store = openStore();
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  const rc = receipt({ mandate_id: mandateId(M1), grant_tx: G1, tx_sig: P1, settled_at: T0 + 1100 });
  const v = await service.dispute({ tx_sig: P1, mandate: M1, grant_tx: G1, receipt: rc });
  assert.notEqual(v.reason, 'mandate_superseded');
});
