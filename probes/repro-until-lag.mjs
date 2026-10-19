// Repro for docs/FEEDBACK.md (Solana RPC, item 1): getSignaturesForAddress with `until` set to a signature that was confirmed a moment ago
// fails with "Transaction <sig> not found" on the public devnet RPC for a second or two. Sends one memo transaction from the throw-away
// principal, then asks for the signatures newer than it, immediately and again every second.
import fs from 'node:fs';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { sendTx } from '../scripts/demo-lib.mjs';
import { makeRpc } from '@iussum/core';
const rpc = makeRpc('https://api.devnet.solana.com');
const p = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(new URL('../.secrets/principal.json', import.meta.url), 'utf8'))));
const sig = await sendTx(rpc, p, [{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: new TextEncoder().encode('iussum repro') }]);
console.log('confirmed', sig);
for (let i = 0; i < 8; i++) {
  try { const r = await rpc.call('getSignaturesForAddress', [p.address, { until: sig, commitment: 'confirmed' }]); console.log(`+${i}s ok, ${r.length} newer`); break; }
  catch (e) { console.log(`+${i}s ${e.message}`); await new Promise((r) => setTimeout(r, 1000)); }
}
