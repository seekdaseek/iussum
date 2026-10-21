// N2 (Addendum N): a transaction answered without `slot` must not make the supersession scan fail open. It passed the M1a bar, entered `found` with slot undefined,
// Math.min gave NaN, `atMin` was empty and the scan answered "not superseded" (and hid a well-formed superseder in the same scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker, scanSupersede, mandateId } from '@iussum/core';
import { createAgent } from '@iussum/agent';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, grantTx, receipt } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { dustCredit } from '../phase13/helpers.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, liveAccount } from '../harness.mjs';

const M1 = mandate({ nonce: '0a'.repeat(16) }), M2 = mandate({ nonce: '0b'.repeat(16), total_cap: '500000', per_payment_max: '20000' }), M3 = mandate({ nonce: '0c'.repeat(16), total_cap: '400000' });
function chain({ slotless = true, withG3 = false } = {}) {
  const c = chainSim();
  const G1 = c.add('G1', grantAt(M1, 1000));
  for (let i = 1; i <= 5; i++) c.add(`D${i}`, dustCredit(1000 + i));
  const g2 = grantAt(M2, 2000); if (slotless) delete g2.slot;
  c.add('G2', g2);
  if (withG3) c.add('G3', grantAt(M3, 3000));
  c.setAccount(SRC, live(withG3 ? M3 : M2));
  return { c, G1 };
}

test('N2 core: a superseder answered without slot makes the check fail closed, with or without a well-formed superseder next to it (g1, g1b)', async () => {
  for (const withG3 of [false, true]) {
    const { c, G1 } = chain({ withG3 });
    const r = await createGrantChecker(c).check(M1, G1, { active: true });
    assert.equal(r.ok, false, `withG3=${withG3}: ${JSON.stringify(r)}`);
    assert.match(r.detail, /slot|superseded/, r.detail);
    const again = await createGrantChecker(c).check(M1, G1, { active: true });
    assert.equal(again.ok, false);
  }
  const { c, G1 } = chain({ slotless: false });
  assert.match((await createGrantChecker(c).check(M1, G1, { active: true })).detail, /superseded by/, 'control: with a slot it is superseded');
});

test('N2 core: the slot must equal the listing entry\'s slot when the listing has one, and a stored found list with a slot that is not a safe integer cannot reach NaN', async () => {
  const { c, G1 } = chain({ slotless: false });
  const o = c.getSignaturesForAddress.bind(c);
  c.getSignaturesForAddress = async (...a) => (await o(...a)).map((e) => (e.signature === sig('G2') ? { ...e, slot: 999 } : e)); // the listing says 999, the transaction says 2000
  await assert.rejects(() => scanSupersede(c, SRC, G1), /slot/);
  const { c: c2, G1: H1 } = chain({ slotless: false });
  await assert.rejects(() => scanSupersede(c2, SRC, H1, { resume: { cursor: sig('D3'), newest: sig('G2'), found: [{ sig: 'X', tx_sig: 'X', slot: undefined }] } }), /slot/);
  await assert.rejects(() => scanSupersede(c2, SRC, H1, { resume: { cursor: sig('D3'), newest: sig('G2'), found: [{ sig: 'X', tx_sig: 'X', slot: 'abc' }] } }), /slot/);
});

test('N2 real gate: nothing settles under a mandate whose superseder was answered without slot (g1e)', async () => {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'enforce', now: () => T0 + 1000, price: '10000' });
  const s = await newScenario(seller, { mandate: { period_budget: '100000', per_payment_max: '20000' } });
  const M2b = { ...s.mandate, nonce: 'bb'.repeat(16), total_cap: '500000' }; const G2 = 'G2'.padEnd(88, 'y'); const g2 = grantTx(M2b); delete g2.slot;
  seller.rpc.grants.set(G2, g2); seller.rpc.newer = [{ signature: G2, err: null }]; seller.rpc.account = liveAccount(M2b);
  const ar = fakeRpc(); ar.grants = seller.rpc.grants; ar.account = seller.rpc.account;
  const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: ar, getBlockhash: blockhash, now: () => T0 + 1000, localChecks: false, retry: { max: 0 } });
  const r = await a.fetch(seller.url); await r.text();
  assert.notEqual(r.status, 200); assert.equal(facilitator.counts.settle, 0);
  await a.close(); seller.close(); facilitator.close();
});

test('N2 resolver: no final verdict is stored for a payment after a slotless superseder (g1c)', async () => {
  const MM1 = mandate({ total_cap: '1000000', per_payment_max: '50000', period_budget: '100000', nonce: '0d'.repeat(16) });
  const MM2 = mandate({ total_cap: '1000000', per_payment_max: '5000', period_budget: '100000', nonce: '0e'.repeat(16) });
  const c = chainSim(); const G1 = c.add('G1', grantAt(MM1, 1000));
  const g2 = grantAt(MM2, 2000); delete g2.slot; c.add('G2', g2);
  c.contextSlot = 3000; // the node's context slot (the simulated chain derives it from the transaction slots otherwise)
  const P2 = c.add('P2', payAt(2001, { amount: '10000' })); c.setAccount(SRC, live(MM2));
  const store = openStore();
  const svc = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9000 });
  const v = await svc.dispute({ tx_sig: P2, mandate: MM1, grant_tx: G1, receipt: receipt({ mandate_id: mandateId(MM1), grant_tx: G1, tx_sig: P2, settled_at: T0 + 2001 }) });
  assert.notEqual(v.reason, 'in_scope', JSON.stringify(v)); assert.equal(store.count(), 0, 'nothing stored: the dispute can be resubmitted');
});
