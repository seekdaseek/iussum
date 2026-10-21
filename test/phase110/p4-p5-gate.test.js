// P4 and P5 of Addendum P: the gate must see exactly the payment x402 will settle (header decoding), and exactly the resource x402 will price and Express will serve (raw path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { registerExactSvmScheme } from '@x402/svm/exact/server';
import { generateKeyPairSigner } from '@solana/kit';
import { createAgent } from '@iussum/agent';
import { createSellerGate, readPaymentHeader } from '@iussum/seller';
import { receiptKey, mandateId, signReceipt, resourceAllowed } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, mandate, grantTx } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, fakeRpc, liveAccount, GRANT_SIG, DEVNET, listen } from '../harness.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// ---- P4
const req = (h) => ({ get: (k) => h[k.toLowerCase()] });
test('P4 readPaymentHeader reads only payment-signature, decodes it the way x402 does, and throws on a header that is present but cannot be decoded', () => {
  const body = Buffer.from(JSON.stringify({ x402Version: 2, payload: {} }));
  const b64 = body.toString('base64');
  assert.equal(readPaymentHeader(req({})), null);
  assert.equal(readPaymentHeader(req({ 'x-payment': b64 })), null, 'x-payment is not read: x402 2.28 does not read it either');
  assert.deepEqual(readPaymentHeader(req({ 'payment-signature': b64 })), { x402Version: 2, payload: {} });
  assert.deepEqual(readPaymentHeader(req({ 'payment-signature': Buffer.concat([BOM, body]).toString('base64') })), { x402Version: 2, payload: {} }, 'a leading BOM is dropped, as x402 drops it');
  assert.deepEqual(readPaymentHeader(req({ 'payment-signature': b64.replace(/=+$/, '') })), { x402Version: 2, payload: {} }, 'unpadded base64 is what atob accepts');
  for (const bad of ['not base64!', `${b64.slice(0, 6)} ${b64.slice(6)}`, Buffer.concat([body, Buffer.from([0xff])]).toString('base64'), Buffer.from('null').toString('base64'), Buffer.from('5').toString('base64'), Buffer.from('[]').toString('base64'), Buffer.from('"x"').toString('base64')]) {
    assert.throws(() => readPaymentHeader(req({ 'payment-signature': bad })), /payment-signature/i, bad.slice(0, 30));
  }
});

async function headerRun(mode, transform) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode, now: () => NOW });
  const s = await newScenario(seller);
  seller.rpc.getSignaturesForAddress = async () => [];
  globalThis.fetch = async (input, init) => {
    const r = new Request(input, init); const h = r.headers.get('payment-signature');
    if (h) { const headers = new Headers(r.headers); headers.set('payment-signature', transform(h)); return realFetch(new Request(r, { headers })); }
    return realFetch(r);
  };
  try {
    const agent = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
    const res = await agent.fetch(seller.otherUrl); // outside allow.resource_prefix
    const body = await res.text();
    return { status: res.status, body, settled: facilitator.counts.settle, handler: seller.hits.handler, receipt: res.headers.get('x-iussum-receipt') };
  } finally { globalThis.fetch = realFetch; facilitator.close(); seller.close(); }
}
const variants = {
  none: (h) => h,
  'leading BOM': (h) => Buffer.concat([BOM, Buffer.from(h, 'base64')]).toString('base64'),
  'BOM and padding stripped': (h) => Buffer.concat([BOM, Buffer.from(h, 'base64')]).toString('base64').replace(/=+$/, ''),
  'invalid UTF-8 after the JSON': (h) => Buffer.concat([Buffer.from(h, 'base64'), Buffer.from([0xff, 0xfe])]).toString('base64'),
  base64url: (h) => h.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '-_',
  'padding stripped': (h) => h.replace(/=+$/, ''),
  'inner whitespace': (h) => `${h.slice(0, 12)} ${h.slice(12)}`,
  'inner newline': (h) => `${h.slice(0, 12)}\n${h.slice(12)}`.replace(/\n/g, ' '),
};
for (const [name, tf] of Object.entries(variants)) {
  test(`P4 enforce: an out-of-scope payment whose header is sent with ${name} is refused or not settled, never settled unseen (g1)`, async () => {
    const r = await headerRun('enforce', tf);
    assert.equal(r.settled, 0, `settled ${r.settled}, status ${r.status} ${r.body.slice(0, 80)}`); assert.equal(r.handler, 0); assert.ok([400, 402, 403].includes(r.status), `status ${r.status}`);
  });
}
test('P4 enforce: the BOM header is judged like the plain one: 403 resource_not_allowed (g1)', async () => {
  const r = await headerRun('enforce', variants['leading BOM']);
  assert.equal(r.status, 403); assert.match(r.body, /resource_not_allowed/);
});
test('P4 observe: a BOM header is decoded, the payment goes on and the receipt records it; an undecodable header is refused, not passed', async () => {
  const ok = await headerRun('observe', variants['leading BOM']);
  assert.equal(ok.status, 200); assert.equal(ok.settled, 1); assert.ok(ok.receipt, 'a receipt was issued: the gate saw the payment');
  const bad = await headerRun('observe', variants['invalid UTF-8 after the JSON']);
  assert.equal(bad.settled, 0); assert.ok([400, 402].includes(bad.status));
});

// ---- P5
const dots = ['/premium/../v1/quote', '/premium/%2e%2e/v1/quote', '/premium/%2E./v1/quote', '/premium/.%2e/v1/quote', '/premium/%2E%2E/v1/quote', '/premium\\..\\v1/quote', '/premium/..\\v1/quote', '/./v1/quote', '/v1/./quote', '/v1/x/../quote', '/v1/x/%2e%2e/quote', '/v1\\quote'];
test('P5 resourceAllowed refuses any resource whose normalised form differs from its raw origin and path: .. %2e%2e %2E. backslash /./', () => {
  const pre = ['http://127.0.0.1:3000/v1/'];
  assert.equal(resourceAllowed(pre, 'http://127.0.0.1:3000/v1/quote'), true);
  assert.equal(resourceAllowed(pre, 'http://127.0.0.1:3000/v1/quote?a=/../b'), true, 'the query is not part of it');
  assert.equal(resourceAllowed(pre, 'http://127.0.0.1:3000/v1//quote'), true, '// is kept by the URL parser, by x402 and by the router alike');
  assert.equal(resourceAllowed(pre, 'http://127.0.0.1:3000//v1/quote'), false, 'and it is not under the prefix');
  for (const p of dots) assert.equal(resourceAllowed(pre, `http://127.0.0.1:3000${p}`), false, p);
  assert.equal(resourceAllowed(['http://127.0.0.1:3000/'], 'http://127.0.0.1:3000'), true, 'an origin without a path is /');
});

async function dotSegmentServer({ mode = 'enforce' } = {}) {
  const PAY = sig('PAYF1');
  const facilitator = await startMockFacilitator({ fixedTx: PAY });
  const rpc = fakeRpc(); rpc.getSignaturesForAddress = async () => [];
  const srv = http.createServer(); const port = await listen(srv); const origin = `http://127.0.0.1:${port}`;
  const KEY = receiptKey(Buffer.alloc(32, 9));
  const gate = createSellerGate({ mode, payTo: A.sellerA, asset: A.asset, network: DEVNET, rpc, key: KEY, now: () => NOW, origin });
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitator.url }));
  registerExactSvmScheme(server, { networks: [DEVNET] });
  const acc = (amount) => ({ accepts: [{ scheme: 'exact', price: { amount, asset: A.asset }, network: DEVNET, payTo: A.sellerA }], description: 't', mimeType: 'application/json' });
  const hits = { v1: 0, premium: 0 }; const app = express();
  app.use(gate.middleware);
  app.use(paymentMiddleware({ 'GET /v1/*': acc('10000'), 'GET /premium/*': acc('40000') }, server));
  app.get('/v1/*', (_q, r) => { hits.v1++; r.json({ served: 'v1' }); });
  app.get('/premium/*', (req, r) => { hits.premium++; r.json({ served: 'PREMIUM', path: req.path }); });
  srv.on('request', app);
  const signer = await generateKeyPairSigner();
  const m = mandate({ agent: signer.address, allow: { pay_to: [A.sellerA], resource_prefix: [`${origin}/v1/`] } });
  rpc.grants.set(GRANT_SIG, grantTx(m)); rpc.account = liveAccount(m);
  // a client that sends the raw request target it was given (Node's fetch resolves dot segments itself): /DOTDOT/ -> /../
  globalThis.fetch = (input, init = {}) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!target.startsWith(origin)) return realFetch(input, init);
    return new Promise((resolve, reject) => {
      const isReq = typeof input !== 'string' && !(input instanceof URL); const u = new URL(target);
      const headers = Object.fromEntries(new Headers(init.headers ?? (isReq ? input.headers : {})).entries());
      const path = (u.pathname + u.search).replaceAll('/DOTDOT/', '/../').replaceAll('/PCT/', '/%2e%2e/');
      const r = http.request({ hostname: u.hostname, port: u.port, path, method: (isReq ? input.method : init.method) ?? 'GET', agent: false, headers: { ...headers, connection: 'close' } }, (res) => {
        const ch = []; res.on('data', (c) => ch.push(c)); res.on('end', () => { const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) h.set(k, Array.isArray(v) ? v.join(', ') : v); resolve(new Response(Buffer.concat(ch), { status: res.statusCode, headers: h })); });
      });
      r.on('error', reject); r.end();
    });
  };
  const agent = await createAgent({ mandate: m, grant_tx: GRANT_SIG, signer, rpc, getBlockhash: blockhash, localChecks: false, now: () => NOW });
  return { facilitator, srv, origin, KEY, m, signer, agent, hits, PAY, close: async () => { globalThis.fetch = realFetch; facilitator.close(); srv.close(); await agent.close?.(); } };
}
for (const seg of ['DOTDOT', 'PCT']) {
  test(`P5 the gate refuses a raw dot-segment path (${seg}) before x402 prices and serves it: 403, nothing settled, the premium handler never runs (g2)`, async () => {
    const t = await dotSegmentServer();
    try {
      const ctl = await t.agent.fetch(`${t.origin}/premium/report`); assert.equal(ctl.status, 403, 'control: the served path itself is refused'); await ctl.text();
      const atk = await t.agent.fetch(`${t.origin}/premium/${seg}/v1/quote`); const body = await atk.text();
      assert.equal(atk.status, 403, body); assert.match(body, /resource_not_allowed/);
      assert.equal(t.facilitator.counts.settle, 0); assert.deepEqual(t.hits, { v1: 0, premium: 0 });
    } finally { await t.close(); }
  });
}
test('P5 an in-scope path is still served (control), and the resolver judges a receipt whose resource is a raw dot-segment path as resource_not_allowed, seller liable', async () => {
  const t = await dotSegmentServer(); let receipt;
  try {
    const ok = await t.agent.fetch(`${t.origin}/v1/quote`); assert.equal(ok.status, 200); await ok.text(); receipt = ok.receipt;
    assert.equal(t.facilitator.counts.settle, 1); assert.ok(receipt);
  } finally { await t.close(); }
  const chain = chainSim(); const G = chain.add(GRANT_SIG, grantAt(t.m, 1000)); chain.add('PAYF1', payAt(1100, { amount: receipt.amount, authority: t.signer.address })); chain.setAccount(SRC, live(t.m));
  const { signature: _s, ...body } = receipt;
  const judge = async (resource) => {
    const refunds = [];
    const svc = createResolver({ rpc: chain, network: DEVNET, sellerKey: async () => t.KEY.publicKey, store: openStore(), sendRefund: async (r) => { refunds.push(r); return 'R'.repeat(88); }, now: () => T0 + 5000 });
    return { v: await svc.dispute({ tx_sig: sig('PAYF1'), mandate: t.m, grant_tx: G, receipt: signReceipt({ ...body, resource }, t.KEY) }), refunds };
  };
  const good = await judge(`${t.origin}/v1/quote`); assert.equal(good.v.reason, 'in_scope'); assert.equal(good.refunds.length, 0);
  const bad = await judge(`${t.origin}/premium/../v1/quote`); assert.equal(bad.v.reason, 'resource_not_allowed'); assert.equal(bad.v.liable, 'seller'); assert.equal(bad.refunds.length, 1);
});
