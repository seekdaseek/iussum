// Collects every devnet signature printed by demo-runs/run-*.txt into demo-runs/signatures.md, labelled by run and scenario, and checks each on chain.
import fs from 'node:fs';
import { makeRpc } from '@iussum/core';
const DIR = process.argv[2] ?? 'demo-runs';
const rpc = makeRpc(process.env.DEVNET_RPC ?? 'https://api.devnet.solana.com');
const SIG = /[1-9A-HJ-NP-Za-km-z]{85,90}/g;
const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^run-\d+\.txt$/.test(x)).sort()) {
  let scenario = '';
  for (const line of fs.readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) {
    const h = /^=== Scenario (\d+)\./.exec(line); if (h) scenario = h[1];
    if (/^\s+PASS|^\s+FAIL/.test(line) && !/refund|payment|grant/i.test(line)) continue;
    const kind = /grant \(/.test(line) ? 'grant' : /Revoke/.test(line) ? 'revoke' : /refund tx|refund_tx/.test(line) ? 'refund' : /plain Transfer/.test(line) ? 'plain-transfer' : /payment tx|payment 1 |payment 2 |settled transactions|next payment |landed: /.test(line) ? 'payment' : null;
    if (!kind) continue;
    for (const s of line.match(SIG) ?? []) if (!rows.some((r) => r.sig === s)) rows.push({ run: f.replace(/\D/g, ''), scenario, kind, sig: s });
  }
}
const out = [];
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const vals = (await rpc.call('getSignatureStatuses', [chunk.map((r) => r.sig), { searchTransactionHistory: true }])).value;
  chunk.forEach((r, j) => { const v = vals[j]; out.push({ ...r, status: v ? `${v.confirmationStatus}${v.err ? ' ERR ' + JSON.stringify(v.err) : ''}` : 'not found' }); });
}
const md = `# Devnet signatures printed by the five demo runs\n\nChecked with getSignatureStatuses on devnet. ${out.length} signatures. A payment that a seller refused (403) or a facilitator failed (402) has no signature and does not appear.\n\n| run | scenario | kind | status | signature |\n|---|---|---|---|---|\n${out.map((r) => `| ${r.run} | ${r.scenario} | ${r.kind} | ${r.status} | \`${r.sig}\` |`).join('\n')}\n`;
fs.writeFileSync(`${DIR}/signatures.md`, md);
console.log(`${out.length} signatures; not finalized/confirmed: ${out.filter((r) => !/confirmed|finalized/.test(r.status) || /ERR/.test(r.status)).length}`);
console.log([...new Set(out.map((r) => r.kind))].map((k) => `${k}:${out.filter((r) => r.kind === k).length}`).join(' '));
