// Test harness: a mock x402 facilitator (no chain), a seller built on the REAL @x402/express middleware with the iussum gate ahead of it,
// and a fake RPC that serves fixture grant transactions and a mutable source-account state.
import http from 'node:http';
import express from 'express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { registerExactSvmScheme } from '@x402/svm/exact/server';
import { generateKeyPairSigner } from '@solana/kit';
import { createSellerGate } from '@iussum/seller';
import { receiptKey, mandateId } from '@iussum/core';
import { A, T0, DAY, mandate, grantTx } from './fixtures.mjs';

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

export async function startMockFacilitator({ fixedTx = null } = {}) {
  const counts = { verify: 0, settle: 0 }; let n = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/supported') return res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: DEVNET, extra: { feePayer: A.thief } }], extensions: [], signers: { 'solana:*': [A.thief] } }));
      if (req.url === '/verify') { counts.verify++; return res.end(JSON.stringify({ isValid: true, payer: A.agent })); }
      if (req.url === '/settle') { counts.settle++; return res.end(JSON.stringify({ success: true, transaction: fixedTx ?? `MOCKSETTLE${++n}`.padEnd(88, 'x'), network: DEVNET, payer: JSON.parse(b).paymentPayload ? A.agent : A.agent })); }
      res.statusCode = 404; res.end('{}');
    });
  });
  const port = await listen(srv);
  return { url: `http://127.0.0.1:${port}`, counts, close: () => srv.close() };
}

export function fakeRpc() {
  const s = { grants: new Map(), account: null, newer: [], mints: new Map([[A.asset, 6]]), calls: { getTransaction: 0, getAccountInfoParsed: 0 } };
  return Object.assign(s, {
    async getTransaction(sig) { s.calls.getTransaction++; return s.grants.get(sig) ?? null; },
    async getAccountInfoParsed(addr) { s.calls.getAccountInfoParsed++; if (s.mints.has(addr)) return { data: { parsed: { info: { decimals: s.mints.get(addr) } } } }; return s.account; },
    async getAccountContext(addr) { s.calls.getAccountInfoParsed++; return { slot: s.contextSlot ?? 1_000_000_000, value: s.account }; },
    async getSignaturesForAddress() { return s.newer; }, // signatures newer than the grant on the source account (none unless a test sets them)
    async call() { throw new Error('unexpected rpc call'); },
  });
}
export const liveAccount = (m, o = {}) => ({ data: { parsed: { info: { owner: m.principal, mint: m.asset, delegate: m.agent, delegatedAmount: { amount: m.total_cap }, ...o } } } });
export const GRANT_SIG = 'G'.repeat(88);

// Start one seller. Returns { url, gate, rpc, facilitator, close, hits }.
export async function startSeller({ mode = 'enforce', payTo = A.sellerA, price = '10000', requireMandate = false, now, facilitator, asset = A.asset }) {
  const rpc = fakeRpc();
  const srv = http.createServer();
  const port = await listen(srv);
  const origin = `http://127.0.0.1:${port}`;
  const gate = createSellerGate({ mode, payTo, asset, network: DEVNET, rpc, key: receiptKey(Buffer.alloc(32, 9)), requireMandate, now, origin });
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitator.url }));
  registerExactSvmScheme(server, { networks: [DEVNET] });
  const app = express();
  const hits = { handler: 0, paymentHeader: 0 };
  app.use((req, _res, next) => { if (req.get('payment-signature')) hits.paymentHeader++; next(); });
  app.get('/.well-known/iussum.json', gate.wellKnown);
  app.use(gate.middleware);
  app.use(paymentMiddleware({ 'GET /v1/quote': { accepts: [{ scheme: 'exact', price: { amount: price, asset }, network: DEVNET, payTo }], description: 't', mimeType: 'application/json' }, 'GET /other/quote': { accepts: [{ scheme: 'exact', price: { amount: price, asset }, network: DEVNET, payTo }], description: 't', mimeType: 'application/json' } }, server));
  app.get('/v1/quote', (_req, res) => { hits.handler++; res.json({ ok: true }); });
  app.get('/other/quote', (_req, res) => { hits.handler++; res.json({ ok: true }); });
  srv.on('request', app);
  return { origin, url: `${origin}/v1/quote`, otherUrl: `${origin}/other/quote`, gate, rpc, hits, close: () => srv.close() };
}

// A mandate for this seller's origin, an agent keypair, and the fixture grant wired into the seller's fake rpc.
export async function newScenario(seller, o = {}) {
  const agentSigner = await generateKeyPairSigner();
  const m = mandate({ agent: agentSigner.address, allow: { pay_to: o.payTos ?? [A.sellerA], resource_prefix: [`${seller.origin}/v1/`] }, nonce: o.nonce ?? 'aa'.repeat(16), not_before: T0, expires_at: T0 + 7 * DAY, ...o.mandate });
  seller.rpc.grants.set(GRANT_SIG, grantTx(m, o.grant ?? {}));
  seller.rpc.account = liveAccount(m);
  return { mandate: m, signer: agentSigner, grant_tx: GRANT_SIG, id: mandateId(m) };
}
export const blockhash = async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 });
