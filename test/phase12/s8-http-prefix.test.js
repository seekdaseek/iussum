// S8: a mandate may not accept http:// resource prefixes (a man in the middle could rewrite a 402), except for local development hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMandate } from '@iussum/core';
import { A, mandate } from '../fixtures.mjs';

const withPrefix = (p) => validateMandate(mandate({ allow: { pay_to: [A.sellerA], resource_prefix: [p] } }));
test('S8 http://example.com/ is refused', () => { const e = withPrefix('http://api.example.com/v1/'); assert.equal(e.length, 1, JSON.stringify(e)); assert.match(e[0], /http/); });
for (const ok of ['http://localhost/v1/', 'http://localhost:3000/v1/', 'http://127.0.0.1:8080/v1/', 'http://[::1]:8080/v1/', 'https://api.example.com/v1/']) test(`S8 ${ok} is accepted`, () => assert.deepEqual(withPrefix(ok), []));
test('S8 a host that only starts with localhost is not local', () => assert.equal(withPrefix('http://localhost.evil.io/v1/').length, 1));
