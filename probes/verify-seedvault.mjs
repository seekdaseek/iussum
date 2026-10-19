// Verify a Seed Vault signMessages result in Node against the account's public key.
// usage: node verify-seedvault.mjs <address_b64> <returned_b64> <message-utf8-file>
// Accepts both layouts: returned = message||signature(64) (MWA signed payload) or returned = signature(64) alone.
import crypto from 'node:crypto';
import fs from 'node:fs';

export function verify(addrB64, retB64, msg) {
  const pub = Buffer.from(addrB64, 'base64'), ret = Buffer.from(retB64, 'base64');
  if (pub.length !== 32) return { ok: false, why: `address is ${pub.length} bytes` };
  let sig, layout;
  if (ret.length === msg.length + 64 && ret.subarray(0, msg.length).equals(msg)) { sig = ret.subarray(msg.length); layout = 'message||signature'; }
  else if (ret.length === 64) { sig = ret; layout = 'signature only'; }
  else return { ok: false, why: `unexpected returned length ${ret.length} for message length ${msg.length}` };
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' });
  return { ok: crypto.verify(null, msg, key, sig), layout };
}

if (process.argv[1].endsWith('verify-seedvault.mjs') && process.argv.length >= 5) {
  const [, , a, r, f] = process.argv;
  console.log(JSON.stringify(verify(a, r, fs.readFileSync(f))));
} else if (process.argv[2] === '--selftest') {
  // known-positive and known-negative inputs (G1)
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const msg = Buffer.from('iussum v0.1 | selftest');
  const sig = crypto.sign(null, msg, privateKey);
  const good = verify(pub.toString('base64'), Buffer.concat([msg, sig]).toString('base64'), msg);
  const bad = verify(pub.toString('base64'), Buffer.concat([msg, Buffer.from(sig).fill(0, 0, 1)]).toString('base64'), msg);
  const wrongMsg = verify(pub.toString('base64'), Buffer.concat([msg, sig]).toString('base64'), Buffer.from('other'));
  console.log(JSON.stringify({ good, tamperedSig: bad, wrongMessage: wrongMsg }));
}
