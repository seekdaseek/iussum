// Finding 5: the seller's resource must come from its configured origin, never from the Host header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { registerExactSvmScheme } from '@x402/svm/exact/server';
import { createAgent } from '@iussum/agent';
import { createSellerGate } from '@iussum/seller';
import { receiptKey } from '@iussum/core';
import { generateKeyPairSigner } from '@solana/kit';
import { A, T0, mandate, grantTx } from '../fixtures.mjs';
import { startMockFacilitator, fakeRpc, liveAccount, GRANT_SIG, DEVNET, listen, blockhash } from '../harness.mjs';

async function seller() {
  const rpc = fakeRpc(); rpc.getSignaturesForAddress = async () => []; // a fixed gate may scan the account; nothing newer exists
  const srv = http.createServer(); const port = await listen(srv); const origin = `http://127.0.0.1:${port}`;
  const gate = () => createSellerGate({ mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: DEVNET, rpc, key: receiptKey(Buffer.alloc(32, 9)), now: () => T0 + 1000, origin });
  return { rpc, srv, port, origin, gate };
}
// Node's fetch ignores a Host override (a forbidden header), so a malicious agent is simulated with raw http.request.
function forgedFetch(host, origin, realFetch) {
  return (input, init = {}) => new Promise((resolve, reject) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!target.startsWith(origin)) return resolve(realFetch(input, init)); // facilitator calls go through untouched
    const isReq = typeof input !== 'string' && !(input instanceof URL);
    const u = new URL(isReq ? input.url : input);
    const headers = Object.fromEntries(new Headers(init.headers ?? (isReq ? input.headers : {})).entries());
    init = { method: isReq ? input.method : init.method, ...init };
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method ?? 'GET', agent: false, headers: { ...headers, host, connection: 'close' } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => {
        const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        resolve(new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: h }));
      });
    });
    req.on('error', reject); if (init.body) req.write(init.body); req.end();
  });
}

test('F5: createSellerGate refuses to start without a canonical origin', async () => {
  const facilitator = await startMockFacilitator();
  try {
    const base = { mode: 'enforce', payTo: A.sellerA, asset: A.asset, network: DEVNET, rpc: fakeRpc() };
    assert.throws(() => createSellerGate(base), /origin/);
    assert.throws(() => createSellerGate({ ...base, origin: 'http://example.test/with/path' }), /origin/);
    assert.throws(() => createSellerGate({ ...base, origin: 'example.test' }), /origin/);
  } finally { facilitator.close(); }
});
test('F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt', async () => {
  const facilitator = await startMockFacilitator();
  const s = await seller();
  const gate = s.gate();
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitator.url }));
  registerExactSvmScheme(server, { networks: [DEVNET] });
  const app = express();
  app.use(gate.middleware);
  app.use(paymentMiddleware({ 'GET /v1/quote': { accepts: [{ scheme: 'exact', price: { amount: '10000', asset: A.asset }, network: DEVNET, payTo: A.sellerA }], description: 't', mimeType: 'application/json' } }, server));
  app.get('/v1/quote', (_req, res) => res.json({ ok: true }));
  s.srv.on('request', app);
  const agentSigner = await generateKeyPairSigner();
  // the mandate allows ONLY https://allowed.example/v1/ ; this seller really lives at http://127.0.0.1:<port>
  const m = mandate({ agent: agentSigner.address, allow: { pay_to: [A.sellerA], resource_prefix: ['http://allowed.example/v1/'] } });
  s.rpc.grants.set(GRANT_SIG, grantTx(m)); s.rpc.account = liveAccount(m);
  const realFetch = globalThis.fetch;
  globalThis.fetch = forgedFetch('allowed.example', s.origin, realFetch);
  try {
    const agent = await createAgent({ mandate: m, grant_tx: GRANT_SIG, signer: agentSigner, rpc: s.rpc, getBlockhash: blockhash, localChecks: false, now: () => T0 + 1000 });
    const res = await agent.fetch(`${s.origin}/v1/quote`);
    assert.equal(res.status, 403, 'the seller must judge its real origin, not the Host header');
    assert.equal((await res.json()).reason, 'resource_not_allowed');
    assert.equal(facilitator.counts.settle, 0);
  } finally { globalThis.fetch = realFetch; facilitator.close(); s.srv.close(); }
});
