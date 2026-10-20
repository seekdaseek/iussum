// Child process for k-lock.test.js: starts ONE real agent on a shared data directory and reports on stdout ("STARTED" or "REFUSED: ..."), then stays alive until stdin
// closes (or a signal arrives). Options: argv = dataDir ctlDir pause fakePid
//   pause = 'lock'  : stop at the lock attempt until <ctl>/<role>-go exists. Old PID lock: right AFTER the O_EXCL create of the lock file (before the pid is written);
//                     SQLite lock: right BEFORE the BEGIN EXCLUSIVE. Either way the other process gets to run while this one is paused at its lock.
//           'none'
//   fakePid = a number: this process pretends to have that pid (a container restart gets pid 1 again, or a pid that a live process has)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const W = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [role, dataDir, ctl, pause, fakePid] = process.argv.slice(2);
if (fakePid && fakePid !== '-') Object.defineProperty(process, 'pid', { value: Number(fakePid) });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitFor = (f) => { while (!fs.existsSync(f)) sleep(10); };
const mark = (name) => fs.writeFileSync(path.join(ctl, `${role}-${name}`), '');
let paused = false;
if (pause === 'lock') {
  const origOpen = fs.openSync;
  fs.openSync = function (p, flags, ...a) { const fd = origOpen.call(this, p, flags, ...a); if (!paused && flags === 'wx' && String(p).endsWith('.lock')) { paused = true; mark('at-lock'); waitFor(path.join(ctl, `${role}-go`)); } return fd; };
  const origExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql, ...a) { if (!paused && /BEGIN EXCLUSIVE/i.test(sql)) { paused = true; mark('at-lock'); waitFor(path.join(ctl, `${role}-go`)); } return origExec.call(this, sql, ...a); };
}
const { createAgent } = await import(`${W}/packages/agent/src/index.js`);
const { fakeRpc, newScenario } = await import(`${W}/test/harness.mjs`);
const seller = { origin: 'https://seller.test', rpc: fakeRpc() };
const s = await newScenario(seller, {});
try {
  await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }), dataDir });
  console.log('STARTED');
} catch (e) { console.log(`REFUSED: ${e.message.slice(0, 100)}`); }
mark('done');
process.stdin.resume(); process.stdin.on('end', () => process.exit(0));
