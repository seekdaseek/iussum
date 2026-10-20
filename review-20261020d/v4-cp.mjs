// Fourth pass (b5dfa77, imports ../). T2 checkpoints.
//  D: the agent's checkpoint file is keyed by mandate id + signer (agent.js `stem`), not by grant_tx. The principal re-grants the SAME mandate (G2):
//     a restarted agent on G2 loads the G1-era checkpoint, counts pre-G2 debits, fails C1, and refuses every payment while that file exists.
//  E: resolver resume across maxPages: progress kept, no double counting, final verdict equals a fresh read; a dispute under a wrong mandate writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../packages/agent/src/index.js';
import { createResolver, openStore } from '../apps/resolver/src/index.js';
import { mandateId } from '../packages/core/src/index.js';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../test/fixtures.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../test/regression/chainsim.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../test/harness.mjs';

const BASE = '/tmp/claude-0/-home-claude/14b15ee1-14b1-5e02-8b04-582538b3093f/scratchpad/review/v4-data';
const bh = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
{ // D
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => T0 + 5000, price: '100' });
  const s = await newScenario(seller, { mandate: { per_payment_max: '1000', period_budget: '100000' } });
  for (const shared of [false, true]) {
    const dirs = [path.join(BASE, `D-${shared}-1`), path.join(BASE, `D-${shared}-2`)]; for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    const c = chainSim(); c.add('G1', grantAt(s.mandate, 1000)); c.add('P1', payAt(1100, { amount: '100', authority: s.signer.address }));
    c.setAccount(SRC, live(s.mandate)); c.setAccount(A.asset, { data: { parsed: { info: { decimals: 6 } } } });
    const run = (grant, dir) => createAgent({ mandate: s.mandate, grant_tx: sig(grant), signer: s.signer, rpc: c, getBlockhash: bh, now: () => T0 + 5000, dataDir: dir });
    await run('G1', dirs[0]); // run 1 on G1 writes its checkpoint
    c.add('G2', grantAt(s.mandate, 1200)); c.add('P2', payAt(1300, { amount: '100', authority: s.signer.address })); // the principal re-grants the same mandate
    const a = await run('G2', shared ? dirs[0] : dirs[1]); // run 2 on G2
    let r; try { r = (await a.fetch(seller.url)).status; } catch (e) { r = `${e.reason}: ${String(e.delta?.[0]?.actual ?? '').slice(0, 110)}`; }
    const r2 = await (async () => { try { return (await (await run('G2', shared ? dirs[0] : dirs[1])).fetch(seller.url)).status; } catch (e) { return e.reason; } })();
    console.log(`D agent on G2 ${shared ? 'with the G1 data directory' : 'with a fresh data directory (control)'}: ${r} | after another restart: ${r2}`);
  }
  facilitator.close(); seller.close();
}
{ // E
  const M = mandate({ per_payment_max: '1000', period_budget: '100000', nonce: 'e4'.repeat(16) }), G = sig('G');
  const c = chainSim(); c.add('G', grantAt(M, 1000)); for (let i = 1; i <= 250; i++) c.add(`P${i}`, payAt(1000 + i, { amount: '500' })); c.setAccount(SRC, live(M));
  const store = openStore();
  const svc = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store, now: () => T0 + 9999, historyMaxPages: 1 });
  const fresh = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store: openStore(), now: () => T0 + 9999 });
  const rc = (i) => receipt({ mandate_id: mandateId(M), grant_tx: G, tx_sig: sig(`P${i}`), amount: '500', settled_at: T0 + 1000 + i });
  const wrong = await svc.dispute({ tx_sig: sig('P201'), mandate: mandate({ nonce: 'ff'.repeat(16) }), grant_tx: G, receipt: null });
  const cps = () => JSON.stringify(store).length; // not used
  const seen = [];
  for (let k = 0; k < 4; k++) { const v = await svc.dispute({ tx_sig: sig('P201'), mandate: M, grant_tx: G, receipt: rc(201) }); seen.push(`${v.reason}/${v.liable}`); if (v.liable !== null) break; }
  const f = await fresh.dispute({ tx_sig: sig('P201'), mandate: M, grant_tx: G, receipt: rc(201) });
  console.log(`E wrong-mandate dispute: ${wrong.reason}; maxPages=1 disputes in turn: ${seen.join(' -> ')}; fresh full read: ${f.reason}/${f.liable} (P201 is the 201st payment of 500: 100500 > 100000)`);
}
