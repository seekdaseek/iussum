// Property (Addendum P, P1): whatever a seller puts in the `amount` of a 402 (negative, hex, whitespace, leading zeros, exponent, a sign, an empty string), and however many payments
// run at the same time, the agent never settles more than period_budget and refuses every malformed amount before reserving anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '@iussum/agent';
import { T0 } from '../fixtures.mjs';
import { startMockFacilitator, startSeller, newScenario } from '../harness.mjs';

const realFetch = globalThis.fetch, NOW = T0 + 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rngFor = (seed) => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32; }; };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const SEEDS = Number(process.env.PROPERTY_P1_SEEDS ?? 40);
// a generator of malformed spellings of an amount
const malformed = (r) => {
  const n = String(1 + Math.floor(r() * 1e9));
  return pick(r, [`-${n}`, `-${n}`, `-0`, `0x${Number(n).toString(16)}`, ` ${n}`, `${n} `, `0${n}`, `00`, `${n}e3`, `1E${1 + Math.floor(r() * 9)}`, `+${n}`, '', `${n}.0`, `${n}\n`, `\t${n}`, `${n}_000`, '-', '--5', '0b101', '0o17']);
};
test(`property P1: malformed amounts in a 402 never lift the period budget and are always refused as amount_over_cap (${SEEDS} seeds)`, async (tc) => {
  let refused = 0, settledTotal = 0, bursts = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rngFor(seed * 2654435761);
    const price = pick(r, [10000, 20000]), budget = pick(r, [30000, 50000, 70000]);
    const facilitator = await startMockFacilitator(); const seller = await startSeller({ facilitator, mode: 'off', now: () => NOW, price: String(price) });
    const s = await newScenario(seller, { mandate: { period_budget: String(budget), per_payment_max: String(price), total_cap: '10000000' } });
    let current = null;
    globalThis.fetch = async (req, init) => {
      const res = await realFetch(req, init);
      const u = new URL(req instanceof Request ? req.url : String(req));
      if (u.searchParams.has('bad') && res.status === 402) { const pr = JSON.parse(Buffer.from(res.headers.get('payment-required'), 'base64').toString()); pr.accepts[0].amount = u.searchParams.get('bad'); const h = new Headers(res.headers); h.set('payment-required', Buffer.from(JSON.stringify(pr)).toString('base64')); return new Response('{}', { status: 402, headers: h }); }
      return res;
    };
    const getBlockhash = async () => { await sleep(20 + Math.floor(r() * 80)); return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, contextSlot: 10 }; };
    const a = await createAgent({ mandate: s.mandate, grant_tx: s.grant_tx, signer: s.signer, rpc: seller.rpc, getBlockhash, now: () => NOW });
    globalThis.fetch = realFetch; // the agent has captured the wrapper
    const ctx = `seed ${seed} price ${price} budget ${budget}`;
    const out = async (p) => { try { const x = await p; await x.text(); return x.status; } catch (e) { return e.reason ?? `error: ${e.message.slice(0, 60)}`; } };
    try {
      for (let step = 0; step < 4; step++) {
        const batch = []; const kinds = [];
        for (let k = 0, n = 2 + Math.floor(r() * 4); k < n; k++) { if (r() < 0.45) { const bad = malformed(r); kinds.push('bad'); batch.push(out(a.fetch(`${seller.url}?bad=${encodeURIComponent(bad)}`))); } else { kinds.push('ok'); batch.push(out(a.fetch(seller.url))); } if (r() < 0.5) await sleep(Math.floor(r() * 40)); }
        const res = await Promise.all(batch); bursts++;
        res.forEach((x, k) => { if (kinds[k] === 'bad') { assert.equal(x, 'amount_over_cap', `${ctx} step ${step}: a malformed amount must be refused, got ${x}`); refused++; } });
        assert.ok(facilitator.counts.settle * price <= budget, `${ctx} step ${step}: settled ${facilitator.counts.settle} x ${price} against a budget of ${budget}`);
      }
      settledTotal += facilitator.counts.settle;
      assert.equal(a.reservations.filter((x) => x.state === 'held').length, 0, `${ctx}: nothing is left held`);
    } finally { await a.close(); facilitator.close(); seller.close(); }
  }
  void tc;
  console.log(`property P1: ${SEEDS} seeds, ${bursts} bursts of concurrent payments, ${refused} malformed amounts refused as amount_over_cap, ${settledTotal} payments settled, never above the budget`);
});
