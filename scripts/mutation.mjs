// Mutation check: for every registered check, skip it (IUSSUM_MUTATE=name) and require at least one test to fail.
// A check whose removal leaves the suite green is a vacuous green and the run exits non-zero. Writes the table to TESTS.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { CHECK_NAMES } from '@iussum/core';
import '@iussum/seller';
import '@iussum/agent';
import '@iussum/resolver';

const files = [...fs.globSync('{packages,apps}/*/test/*.test.js'), ...fs.globSync('test/{regression,phase11,phase12,phase13,phase14,phase15,phase16,phase17}/*.test.js')];
const run = (env) => {
  const r = spawnSync(process.execPath, ['--test', '--test-force-exit', '--test-timeout=60000', '--test-reporter=tap', ...files], { env: { PROPERTY_SEEDS: '120', ...process.env, ...env }, encoding: 'utf8' });
  const n = (k) => Number(new RegExp(`^# ${k} (\\d+)`, 'm').exec(r.stdout)?.[1] ?? NaN);
  const names = [...r.stdout.matchAll(/^not ok \d+ - (.+?)(?: #.*)?$/gm)].map((m) => m[1]);
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), names };
};
const base = run({ IUSSUM_MUTATE: '' });
console.log(`baseline: ${base.tests} tests, ${base.pass} pass, ${base.fail} fail`);
if (base.fail !== 0 || !(base.tests > 0)) { console.error('baseline is not green, stop'); process.exit(2); }
const rows = []; let vacuous = 0;
for (const name of [...CHECK_NAMES].sort()) {
  const m = run({ IUSSUM_MUTATE: name });
  const killed = m.fail > 0;
  if (!killed) vacuous++;
  rows.push({ name, fail: m.fail, first: m.names[0] ?? '' });
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${name}  failing tests: ${m.fail}${m.names[0] ? `  e.g. ${m.names[0].slice(0, 90)}` : ''}`);
}
const md = `| check skipped | tests that fail | first failing test |\n|---|---|---|\n${rows.map((r) => `| \`${r.name}\` | ${r.fail} | ${r.first.replace(/\|/g, '\\|')} |`).join('\n')}\n`;
fs.writeFileSync(new URL('../mutation-table.md', import.meta.url), `baseline: ${base.tests} tests, ${base.pass} pass, 0 fail\nchecks mutated: ${rows.length}, survived (vacuous): ${vacuous}\n\n${md}`);
console.log(`checks mutated: ${rows.length}, survived: ${vacuous}`);
process.exit(vacuous ? 1 : 0);
