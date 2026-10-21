// The seventh review's independent verdict_id check, kept as a regression: every /dispute and /v/:tx response type is collected over real HTTP and each verdict_id (and each
// kept id of a replaced verdict) is recomputed from the response ALONE by a separate implementation in Python (RFC 8785 JCS + sha256, `python3 -I`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('verdict_id is recomputed from the response alone by an independent Python implementation: mismatches 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-'));
  const out = path.join(dir, 'out.json');
  const d = spawnSync(process.execPath, ['--no-warnings', 'scripts/verdict-id-dump.mjs', out], { encoding: 'utf8', env: { ...process.env, TMPDIR: dir } });
  assert.equal(d.status, 0, d.stderr);
  const r = spawnSync('python3', ['-I', 'scripts/verdict-id-recompute.py', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /mismatches: 0\s*$/, r.stdout);
  assert.ok((r.stdout.match(/recompute ok/g) ?? []).length >= 15, r.stdout);
  assert.ok(!/MISMATCH/.test(r.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
});
