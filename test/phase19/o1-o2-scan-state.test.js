// O1 and O2 (Addendum O, eighth review). O1: the -32020 restart (a stored cursor the node no longer knows) threw away the superseders the scan had already read and then
// answered "not superseded" on a lagging node. O2: a stored state whose `found` carries an entry without a usable slot blocked that grant's scan for good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrantChecker } from '@iussum/core';
import { chainSim, live, grantAt, payAt, tokenIx } from '../regression/chainsim.mjs';
import { A, SRC, mandate } from '../fixtures.mjs';

const mem = () => { const db = new Map(); return { db, get: (k) => (db.has(k) ? JSON.parse(JSON.stringify(db.get(k))) : undefined), put: (k, v) => db.set(k, JSON.parse(JSON.stringify(v))) }; };

function chainWithRevoke() {
  const m = mandate(); const sim = chainSim();
  const G = sim.add('GRANT', grantAt(m, 1000));
  for (let i = 0; i < 120; i++) sim.add(`P${String(i).padStart(3, '0')}`, payAt(1100 + i)); // slots 1100..1219
  const R = sim.add('REVOKE', tokenIx('revoke', { source: SRC, owner: A.principal }, 1300)); // the superseder
  for (let i = 0; i < 50; i++) sim.add(`Q${String(i).padStart(3, '0')}`, payAt(1400 + i));
  sim.setAccount(SRC, live(m));
  return { m, sim, G, R };
}

test('O1 a restart after -32020 keeps the superseders the scan had already read: a lagging node cannot turn them into "not superseded" (r5)', async () => {
  const { sim, G, R } = chainWithRevoke();
  const raw = sim.getSignaturesForAddress.bind(sim);
  let mode = 'call1', pages = 0; const TIP = 1150; // the lagging node's slot
  sim.getSignaturesForAddress = async (addr, o = {}) => {
    if (mode === 'call1') { if (++pages === 2) throw new Error('getSignaturesForAddress: rpc http 503'); return raw(addr, o); }
    const slotOf = (s) => sim.txs.find((t) => t.sig === s)?.tx.slot;
    if (o.before && slotOf(o.before) > TIP) throw new Error(`getSignaturesForAddress: Transaction ${o.before} not found`);
    return (await raw(addr, { ...o, limit: 1e6 })).filter((x) => x.slot <= TIP).slice(0, o.limit ?? 1000);
  };
  const store = mem(); const k = `${SRC}:${G}`;
  const checker = createGrantChecker(sim, { scanStore: store });
  await assert.rejects(() => checker.supersededBy(SRC, G));
  assert.equal(store.db.get(k).partial.found.length, 1, 'call 1 read the revoke on page 1');
  mode = 'call2';
  const sup = await checker.supersededBy(SRC, G);
  assert.ok(sup, 'call 2 must not answer "not superseded"'); assert.equal(sup.sig, R); assert.equal(sup.slot, 1300);
  assert.equal(store.db.get(k).superseded?.sig, R, 'and the stored state says so');
});

test('O1 the carried superseder survives a restarted scan that is cut short again', async () => {
  const { sim, G, R } = chainWithRevoke();
  const raw = sim.getSignaturesForAddress.bind(sim);
  let phase = 1, pages = 0;
  sim.getSignaturesForAddress = async (addr, o = {}) => {
    if (phase === 1) { if (++pages === 2) throw new Error('getSignaturesForAddress: rpc http 503'); return raw(addr, o); }
    if (phase === 2) { if (o.before) throw new Error(`getSignaturesForAddress: Transaction ${o.before} not found`); throw new Error('getSignaturesForAddress: rpc http 503'); } // the restart itself fails at once
    const slotOf = (x) => sim.txs.find((t) => t.sig === x)?.tx.slot; // phase 3: a node that lags (lists only up to its own slot)
    if (o.before && slotOf(o.before) > 1150) throw new Error(`getSignaturesForAddress: Transaction ${o.before} not found`);
    return (await raw(addr, { ...o, limit: 1e6 })).filter((x) => x.slot <= 1150).slice(0, o.limit ?? 1000);
  };
  const store = mem();
  await assert.rejects(() => createGrantChecker(sim, { scanStore: store }).supersededBy(SRC, G));
  phase = 2; await assert.rejects(() => createGrantChecker(sim, { scanStore: store }).supersededBy(SRC, G));
  phase = 3; const sup = await createGrantChecker(sim, { scanStore: store }).supersededBy(SRC, G);
  assert.equal(sup?.sig, R, 'the superseder read in call 1 is still known after a failed restart');
});

test('O2 a stored state whose found entry has no usable slot is treated as absent: the scan restarts from the grant and finds the real superseder (r4)', async () => {
  const m = mandate(); const sim = chainSim();
  const G = sim.add('GRANT', grantAt(m, 1000));
  for (let i = 0; i < 5; i++) sim.add(`P${i}`, payAt(1100 + i));
  const R = sim.add('REVOKE', tokenIx('revoke', { source: SRC, owner: A.principal }, 1200));
  const P5 = sim.add('P5', payAt(1300)); sim.setAccount(SRC, live(m));
  for (const bad of [{ sig: R, tx_sig: R, slot: undefined }, null, { sig: R, slot: 'abc' }, { slot: 1200 }, 7]) {
    const store = mem(); store.db.set(`${SRC}:${G}`, { since: G, superseded: null, partial: { cursor: P5, newest: P5, found: [bad] } });
    for (let call = 1; call <= 2; call++) {
      const sup = await createGrantChecker(sim, { scanStore: store }).supersededBy(SRC, G);
      assert.equal(sup?.sig, R, `${JSON.stringify(bad)} call ${call}`); assert.equal(sup.slot, 1200);
    }
  }
  // a well-formed entry next to a bad one is never dropped: the restart keeps it
  const store = mem(); const good = { sig: R, tx_sig: R, slot: 1200 };
  store.db.set(`${SRC}:${G}`, { since: G, superseded: null, partial: { cursor: P5, newest: P5, found: [null, good] } });
  const seen = []; const raw = sim.getSignaturesForAddress.bind(sim);
  sim.getSignaturesForAddress = async (a, o) => { const r = await raw(a, o); seen.push(r.length); return r; };
  assert.equal((await createGrantChecker(sim, { scanStore: store }).supersededBy(SRC, G))?.sig, R);
  assert.ok(seen.length > 0, 'it restarted from the grant (read the history again)');
});
