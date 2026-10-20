// child of the M2 leak test: starts an agent whose start-up fails after the lock was taken (the directory becomes unwritable while the chain is read), then
// stays alive (idle, so no garbage collection frees a leaked lock) until the parent kills it
import fs from 'node:fs';
import { createAgent } from '@iussum/agent';
import { fakeRpc, liveAccount, GRANT_SIG } from '../harness.mjs';
import { A, mandate, grantTx } from '../fixtures.mjs';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
const dataDir = process.argv[2];
const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(7));
const m = mandate({ agent: signer.address, allow: { pay_to: [A.sellerA], resource_prefix: ['https://seller.test/v1/'] }, nonce: 'aa'.repeat(16) });
const rpc = fakeRpc(); rpc.grants.set(GRANT_SIG, grantTx(m)); rpc.account = liveAccount(m);
const o = rpc.getAccountContext.bind(rpc);
rpc.getAccountContext = async (...x) => { fs.chmodSync(dataDir, 0o500); return o(...x); }; // the first write of the start (the checkpoint) fails, the way ENOSPC would
try { await createAgent({ mandate: m, grant_tx: GRANT_SIG, signer, rpc, getBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }), dataDir }); console.log('STARTED'); }
catch (e) { fs.chmodSync(dataDir, 0o700); console.log(`FAILED ${e.code ?? e.message.slice(0, 40)}`); }
setInterval(() => {}, 1 << 30);
