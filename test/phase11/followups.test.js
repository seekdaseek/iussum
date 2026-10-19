// Review follow-ups after Phase 1.1: (1) the agent judges the URL it requested, and refuses when that is unknown, even if the seller omits
// resource.url; (2) a delegate change made by CPI (meta.innerInstructions) supersedes a grant like a top-level one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createAgent, IussumRefusal } from '@iussum/agent';
import { createGrantChecker, mandateId } from '@iussum/core';
import { createResolver, openStore } from '@iussum/resolver';
import { A, T0, SRC, SELLER_KEY, mandate, receipt } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario, blockhash, listen } from '../harness.mjs';
import { chainSim, grantAt, payAt, live, sig } from '../regression/chainsim.mjs';

const NOW = T0 + 1000;

// ---------------------------------------------------------------- (1) requested URL
// A proxy in front of the seller that DELETES resource.url from the 402 challenge (or declares another one). Everything else is forwarded,
// including the paid retry, so a payment the agent is willing to make really settles.
function rewritingProxy(sellerOrigin, rewrite) {
  return http.createServer((req, res) => {
    const up = http.request(`${sellerOrigin}${req.url}`, { method: req.method, headers: { ...req.headers, host: new URL(sellerOrigin).host, connection: 'close' }, agent: false }, (r) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => {
        const headers = { ...r.headers };
        if (r.statusCode === 402 && headers['payment-required']) {
          const pr = JSON.parse(Buffer.from(headers['payment-required'], 'base64').toString('utf8'));
          rewrite(pr);
          headers['payment-required'] = Buffer.from(JSON.stringify(pr)).toString('base64');
        }
        res.writeHead(r.statusCode, headers); res.end(Buffer.concat(chunks));
      });
    });
    req.pipe(up);
  });
}
async function proxied(rewrite) {
  const facilitator = await startMockFacilitator();
  const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW });
  const proxy = rewritingProxy(seller.origin, rewrite);
  const port = await listen(proxy);
  const base = `http://127.0.0.1:${port}`;
  const s = await newScenario(seller, { mandate: { allow: { pay_to: [A.sellerA], resource_prefix: [`${base}/v1/`] } } }); // the mandate allows the URL the agent will REQUEST
  const agent = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash: blockhash, now: () => NOW });
  return { facilitator, seller, proxy, base, s, agent, close: () => { proxy.close(); facilitator.close(); seller.close(); } };
}
test('review 1: a seller that OMITS resource.url does not stop an in-scope payment: the agent judges the URL it requested', async () => {
  const t = await proxied((pr) => { delete pr.resource; });
  try {
    const res = await t.agent.fetch(`${t.base}/v1/quote`);
    assert.equal(res.status, 200);
    assert.equal(t.facilitator.counts.settle, 1);
  } finally { t.close(); }
});
test('review 1: omitting resource.url does not hide an out-of-scope request either', async () => {
  const t = await proxied((pr) => { delete pr.resource; });
  try {
    await assert.rejects(() => t.agent.fetch(`${t.base}/other/quote`), (e) => e instanceof IussumRefusal && e.reason === 'resource_not_allowed');
    assert.equal(t.facilitator.counts.settle, 0);
  } finally { t.close(); }
});
test('review 1: a payment that was not created through agent.fetch has no requested URL and is refused (resource_mismatch)', async () => {
  const t = await proxied(() => {});
  try {
    const challenge = await fetch(`${t.base}/v1/quote`);
    assert.equal(challenge.status, 402);
    const paymentRequired = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString('utf8'));
    await assert.rejects(() => t.agent.client.createPaymentPayload(paymentRequired), /IUSSUM_REFUSAL:.*resource_mismatch/);
  } finally { t.close(); }
});

// ---------------------------------------------------------------- (2) supersession by CPI
const M1 = mandate({ nonce: '01'.repeat(16) });
const G1 = sig('G1');
const OTHER_PROGRAM = 'Fake111111111111111111111111111111111111111';
// a transaction whose only top-level instruction is a call to another program; the token instruction happens inside it (CPI)
function cpiTx(type, info, slot, { err = null, wrapDepth = 1 } = {}) {
  const inner = [{ programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type, info }, stackHeight: 2 }];
  return { slot, blockTime: T0 + slot, meta: { err, innerInstructions: [{ index: 0, instructions: wrapDepth === 2 ? [{ programId: OTHER_PROGRAM, accounts: [], data: 'x', stackHeight: 2 }, ...inner] : inner }] }, transaction: { message: { accountKeys: [{ pubkey: A.principal, signer: true, writable: true }, { pubkey: SRC, signer: false, writable: true }], instructions: [{ programId: OTHER_PROGRAM, accounts: [SRC], data: 'abc' }] } } };
}
for (const [type, info] of [
  ['approve', { source: SRC, delegate: A.thief, owner: A.principal, amount: '1' }],
  ['approveChecked', { source: SRC, mint: A.asset, delegate: A.thief, owner: A.principal, tokenAmount: { amount: '5' } }],
  ['revoke', { source: SRC, owner: A.principal }],
  ['setAuthority', { account: SRC, authorityType: 'accountOwner', newAuthority: A.thief, authority: A.principal }],
  ['closeAccount', { account: SRC, destination: A.principal, owner: A.principal }],
]) test(`review 2: a ${type} made by CPI (meta.innerInstructions) supersedes the grant`, async () => {
  const c = chainSim(); c.add('G1', grantAt(M1, 1000)); c.add('CPI', cpiTx(type, info, 1050)); c.setAccount(SRC, live(M1));
  const r = await createGrantChecker(c).check(M1, G1, { active: true });
  assert.equal(r.ok, false); assert.equal(r.reason, 'grant_inactive'); assert.match(r.detail, new RegExp(`superseded by ${sig('CPI')}`));
});
test('review 2: a nested CPI (an inner instruction after another inner instruction) is found too', async () => {
  const c = chainSim(); c.add('G1', grantAt(M1, 1000)); c.add('CPI', cpiTx('revoke', { source: SRC, owner: A.principal }, 1050, { wrapDepth: 2 })); c.setAccount(SRC, live(M1));
  assert.equal((await createGrantChecker(c).check(M1, G1, { active: true })).ok, false);
});
test('review 2: an inner token transferChecked, a CPI approve on ANOTHER account, and a FAILED transaction do not supersede', async () => {
  const c = chainSim(); c.add('G1', grantAt(M1, 1000));
  c.add('T', cpiTx('transferChecked', { source: SRC, destination: A.thief, mint: A.asset, authority: A.agent, tokenAmount: { amount: '1' } }, 1050));
  c.add('X', cpiTx('approve', { source: A.thief, delegate: A.agent, owner: A.thief, amount: '1' }, 1060));
  c.add('F', cpiTx('revoke', { source: SRC, owner: A.principal }, 1070, { err: { InstructionError: [0, 'Custom'] } }));
  c.setAccount(SRC, live(M1));
  assert.equal((await createGrantChecker(c).check(M1, G1, { active: true })).ok, true);
});
test('review 2: the resolver rejects a mandate superseded by CPI before the payment slot as mandate_superseded', async () => {
  const c = chainSim(); c.add('G1', grantAt(M1, 1000)); c.add('CPI', cpiTx('approveChecked', { source: SRC, mint: A.asset, delegate: A.agent, owner: A.principal, tokenAmount: { amount: '1' } }, 1100)); c.add('PAY', payAt(1200)); c.setAccount(SRC, live(M1));
  const service = createResolver({ rpc: c, network: A.net, sellerKey: async () => SELLER_KEY.publicKey, store: openStore(), now: () => T0 + 9000 });
  const v = await service.dispute({ tx_sig: sig('PAY'), mandate: M1, grant_tx: G1, receipt: receipt({ mandate_id: mandateId(M1), grant_tx: G1, tx_sig: sig('PAY'), settled_at: T0 + 1200 }) });
  assert.equal(v.reason, 'mandate_superseded'); assert.equal(v.liable, null);
});
