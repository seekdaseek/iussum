// One-time setup for running the devnet demo yourself with your own throw-away keys. Devnet only; never use real keys.
//   node scripts/demo-setup.mjs            creates .secrets/{principal,agent,seller,seller2,seller3,refund-float}.json (mode 600) if missing
//                                          and prints the principal address to fund with devnet SOL (faucet.solana.com, >= 0.1)
//                                          and devnet USDC (faucet.circle.com, >= 3, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
//   node scripts/demo-setup.mjs --fund     once the principal is funded: creates the token accounts and gives the refund float 0.5 USDC + 0.02 SOL
// SECRETS_DIR overrides the key directory (used to test this script without touching real keys).
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createKeyPairSignerFromPrivateKeyBytes, createKeyPairSignerFromBytes } from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction } from '@solana-program/token';
import { principalAta } from '@iussum/core';
import { makeCtx, sendTx, MINT } from './demo-lib.mjs';

const dir = process.env.SECRETS_DIR ?? new URL('../.secrets', import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const NAMES = ['principal', 'agent', 'seller', 'seller2', 'seller3', 'refund-float'];
const signers = {};
for (const n of NAMES) {
  const f = path.join(dir, `${n}.json`);
  if (!fs.existsSync(f)) {
    const seed = randomBytes(32);
    const s = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    const pub = Buffer.from(await crypto.subtle.exportKey('raw', s.keyPair.publicKey));
    fs.writeFileSync(f, JSON.stringify([...seed, ...pub]), { mode: 0o600 });
    console.log(`created ${f}`);
  }
  signers[n] = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(f, 'utf8'))));
}
console.log(Object.entries(signers).map(([n, s]) => `${n.padEnd(13)} ${s.address}`).join('\n'));
if (!process.argv.includes('--fund')) { console.log(`\nFund the principal on devnet (SOL: faucet.solana.com, USDC ${MINT}: faucet.circle.com), then: node scripts/demo-setup.mjs --fund`); process.exit(0); }
const ctx = makeCtx(); const p = signers.principal;
const sysTransfer = { programAddress: '11111111111111111111111111111111', accounts: [{ address: p.address, role: 3 }, { address: signers['refund-float'].address, role: 1 }], data: Uint8Array.from([2, 0, 0, 0, ...new Uint8Array(new BigUint64Array([20_000_000n]).buffer)]) };
const ixs = [sysTransfer, ...(await Promise.all(['seller', 'seller2', 'seller3', 'refund-float', 'agent'].map((n) => getCreateAssociatedTokenIdempotentInstructionAsync({ payer: p, mint: MINT, owner: signers[n].address })))),
  getTransferCheckedInstruction({ source: await principalAta(p.address, MINT), mint: MINT, destination: await principalAta(signers['refund-float'].address, MINT), authority: p, amount: 500_000n, decimals: 6 })];
console.log('funding setup tx:', await sendTx(ctx.rpc, p, ixs));
