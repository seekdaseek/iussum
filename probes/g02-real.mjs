// G0.2 local carriage probe: does a custom PaymentPayload.extensions key travel client -> server hook/handler -> facilitator?
// Mock facilitator on localhost records exactly what /verify and /settle receive.
import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import { x402Client } from '@x402/core/client';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { wrapFetchWithPayment } from '@x402/fetch';
import { registerExactSvmScheme as registerServer } from '@x402/svm/exact/server';
import { registerExactSvmScheme as registerClient } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const SECRETS = '/Volumes/D/iussum/.secrets';
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const agent = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(`${SECRETS}/agent.json`, 'utf8'))));
const seller = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(fs.readFileSync(`${SECRETS}/seller.json`, 'utf8'))));

const seen = { verify: [], settle: [], hook: [], handler: [] };

const facUrl = process.env.FAC_URL;
const fac = { close(){} };
// ---- seller
const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facUrl }));
registerServer(server, { networks: [DEVNET] });
server.onBeforeVerify(async (ctx) => { seen.hook.push({ ext: ctx.paymentPayload.extensions ?? null }); });
const app = express();
app.use(paymentMiddleware({ 'GET /paid': { accepts: [{ scheme: 'exact', price: '$0.001', network: DEVNET, payTo: seller.address }], description: 'probe', mimeType: 'application/json' } }, server));
app.get('/paid', (req, res) => {
  const hdr = req.get('payment-signature');
  const decoded = hdr ? JSON.parse(Buffer.from(hdr, 'base64').toString('utf8')) : null;
  seen.handler.push({ ext: decoded?.extensions ?? null });
  res.json({ ok: true });
});
const srv = app.listen(0);
await new Promise((r) => srv.once('listening', r));

// ---- agent
const MANDATE = { v: 'iussum/0.1', note: 'probe-not-a-real-mandate' };
const client = new x402Client();
registerClient(client, { signer: agent, networks: [DEVNET] });
client.registerExtension(process.env.EXT==='0' ? {key:'noop'} : {
  key: 'iussum',
  enrichPaymentPayload: async (payload) => ({ ...payload, extensions: { ...(payload.extensions ?? {}), iussum: process.env.EXT==='2' ? { info: { mandate: MANDATE, principal_sig: 'PROBE' } } : process.env.EXT==='3' ? { info: { mandate: MANDATE, principal_sig: 'PROBE' }, schema: { type: 'object' } } : { mandate: MANDATE, principal_sig: 'PROBE' } } }),
});
const f = wrapFetchWithPayment(fetch, client);
const r = await f(`http://127.0.0.1:${srv.address().port}/paid`);
console.log('EXT',process.env.EXT,'FAC',facUrl,'http status', r.status, 'body', (await r.text()).slice(0,300)); console.log('payment-required hdr:', (r.headers.get('payment-required')||'').slice(0,0)); const pr=r.headers.get('payment-required'); if(pr) console.log('decoded error:', JSON.stringify(JSON.parse(Buffer.from(pr,'base64').toString()).error));
console.log('facilitator /verify extensions:', JSON.stringify(seen.verify[0]?.paymentPayload?.extensions ?? null));
console.log('facilitator /settle extensions:', JSON.stringify(seen.settle[0]?.paymentPayload?.extensions ?? null));
console.log('seller onBeforeVerify hook extensions:', JSON.stringify(seen.hook[0]?.ext ?? null));
console.log('seller handler (decoded PAYMENT-SIGNATURE) extensions:', JSON.stringify(seen.handler[0]?.ext ?? null));
console.log('counts verify/settle/hook/handler', seen.verify.length, seen.settle.length, seen.hook.length, seen.handler.length);
srv.close(); fac.close();
