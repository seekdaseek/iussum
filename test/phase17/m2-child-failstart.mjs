// child of the M2 leak test: starts an agent whose start-up fails after the lock was taken (a write of the start fails while the chain is read), then
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
// the first write of the start (the checkpoint) fails the way a full disk would, WITHOUT file permissions (a permission failure does not happen as root, which is how
// most containers and CI run): the rename of the checkpoint throws ENOSPC once
const realRename = fs.renameSync; let failed = false;
fs.renameSync = (a, b) => { if (!failed && String(b).endsWith('.checkpoint.json')) { failed = true; throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC' }); } return realRename(a, b); };
try { await createAgent({ mandate: m, grant_tx: GRANT_SIG, signer, rpc, getBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }), dataDir }); console.log('STARTED'); }
catch (e) { console.log(`FAILED ${e.code ?? e.message.slice(0, 40)}`); }
setInterval(() => {}, 1 << 30);
