// I4 (review v4-cp.mjs part D): the agent's files are keyed by grant_tx, source, agent and asset, like the resolver's checkpoint. A re-grant of the SAME mandate
// (G2) must not load the G1-era checkpoint; files of another grant are ignored and never deleted; one lock per grant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '@iussum/agent';
import { A, T0, SRC } from '../fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
async function world(tc) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 5000, price: '100' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iussum-i4-'));
  tc.after(() => { facilitator.close(); seller.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const s = await newScenario(seller, { mandate: { per_payment_max: '1000', period_budget: '100000' } });
  const c = chainSim(); c.add('G1', grantAt(s.mandate, 1000)); c.add('P1', payAt(1100, { amount: '100', authority: s.signer.address }));
  c.setAccount(SRC, live(s.mandate)); c.setAccount(A.asset, { data: { parsed: { info: { decimals: 6 } } } });
  const run = (grant) => createAgent({ mandate: s.mandate, grant_tx: sig(grant), signer: s.signer, rpc: c, getBlockhash: bh, now: () => T0 + 5000, dataDir: dir });
  return { s, c, dir, run, seller };
}
test('I4 the principal re-grants the SAME mandate (G2): a restarted agent on G2 with the data directory of G1 pays', async (tc) => {
  const w = await world(tc);
  await (await w.run('G1')).close(); // run 1 on G1 writes its checkpoint
  w.c.add('G2', grantAt(w.s.mandate, 1200)); w.c.add('P2', payAt(1300, { amount: '100', authority: w.s.signer.address }));
  const a = await w.run('G2');
  assert.equal((await a.fetch(w.seller.url)).status, 200);
  await a.close();
  const b = await w.run('G2');
  assert.equal((await b.fetch(w.seller.url)).status, 200, 'and after another restart');
  await b.close();
});
test('I4 the files of the other grant are ignored and never deleted', async (tc) => {
  const w = await world(tc);
  await (await w.run('G1')).close();
  const g1Files = fs.readdirSync(w.dir).filter((f) => f.endsWith('.json')).sort();
  assert.ok(g1Files.length >= 1, 'G1 left a checkpoint');
  w.c.add('G2', grantAt(w.s.mandate, 1200));
  await (await w.run('G2')).close();
  const after = fs.readdirSync(w.dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of g1Files) assert.ok(after.includes(f), `${f} was deleted`);
  assert.ok(after.length > g1Files.length, 'G2 has its own files');
});
test('I4 one lock per grant: two grants of one agent can run in one data directory, one grant cannot run twice', async (tc) => {
  const w = await world(tc);
  w.c.add('G2', grantAt(w.s.mandate, 1200));
  const a1 = await w.run('G1');
  const a2 = await w.run('G2'); // another grant: allowed
  await assert.rejects(() => w.run('G1'), /data directory|lock/i);
  await a1.close(); await a2.close();
});
