// Chain access and parsing. Everything pure takes jsonParsed getTransaction results, so tests can feed recorded devnet responses.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export function makeRpc(url, { retries = 8, fetchImpl = fetch } = {}) {
  let id = 0;
  async function call(method, params) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`rpc http ${r.status}`), { retry: true });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message}`), { retry: /rate|limit|too many|429/i.test(j.error.message) });
        return j.result;
      } catch (e) {
        if (attempt >= retries || !(e.retry || e.name === 'TypeError')) throw e;
        await new Promise((res) => setTimeout(res, Math.min(5000, 400 * 2 ** attempt) * (0.75 + Math.random() / 2)));
      }
    }
  }
  const txCache = new Map();
  return {
    url, call,
    async getTransaction(sig) {
      if (txCache.has(sig)) return txCache.get(sig);
      let t = await call('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      for (let i = 0; i < 6 && !t; i++) { await new Promise((res) => setTimeout(res, 700)); t = await call('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); }
      if (t) txCache.set(sig, t);
      return t;
    },
    async getAccountInfoParsed(addr) { return (await call('getAccountInfo', [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }])).value; },
    // `until`/`before` name a signature; a freshly confirmed one may not be in this node's signature index yet ("Transaction ... not found"),
    // so that one error is retried for a few seconds. Any other error, or the same error after the retries, propagates (callers fail closed).
    async getSignaturesForAddress(addr, opts = {}) {
      for (let attempt = 0; ; attempt++) {
        try { return await call('getSignaturesForAddress', [addr, { commitment: 'confirmed', ...opts }]); }
        catch (e) { if (attempt >= 8 || !/Transaction .* not found/i.test(e.message)) throw e; await new Promise((res) => setTimeout(res, 800)); }
      }
    },
  };
}

// Parse the token movements of one transaction. destination owner comes from postTokenBalances (accountIndex -> owner).
export function parsePayment(tx) {
  if (!tx || !tx.transaction) return { found: false };
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const owners = new Map();
  for (const b of tx.meta?.postTokenBalances ?? []) owners.set(keys[b.accountIndex], b.owner);
  const transfers = [];
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId !== TOKEN_PROGRAM_ADDRESS || ix.parsed?.type !== 'transferChecked') continue;
    const i = ix.parsed.info;
    transfers.push({ source: i.source, destination: i.destination, mint: i.mint, authority: i.authority ?? i.multisigAuthority, amount: i.tokenAmount.amount, decimals: i.tokenAmount.decimals, dest_owner: owners.get(i.destination) ?? null, source_owner: owners.get(i.source) ?? null });
  }
  return { found: true, err: tx.meta?.err ?? null, slot: tx.slot, block_time: tx.blockTime ?? null, transfers };
}

// Agent spend history from chain: TransferChecked out of `source` with authority = agent, successful, ordered by (slot, signature).
// PAGINATED (Addendum C, fix 2): getSignaturesForAddress is newest first, so page with `before` until the history reaches the grant
// (`until`) or the start of the period of interest (`stopAtTime`: the oldest signature on the page is older than it). `complete` says
// whether that was shown; a page that cannot be read, or too many pages, means complete:false. Never treat an incomplete history as complete.
export async function agentSpendHistory(rpc, { source, agent, mint, until = null, stopAtTime = null, pageSize = 100, maxPages = 1000 }) {
  const out = [];
  let before, complete = false, reason = null;
  try {
    for (let pages = 0; ; pages++) {
      if (pages >= maxPages) { reason = `more than ${maxPages} pages`; break; }
      const page = await rpc.getSignaturesForAddress(source, { limit: pageSize, ...(until ? { until } : {}), ...(before ? { before } : {}) });
      for (const s of page) {
        if (s.err) continue;
        const p = parsePayment(await rpc.getTransaction(s.signature));
        if (!p.found || p.err) continue;
        for (const t of p.transfers) if (t.source === source && t.authority === agent && t.mint === mint) out.push({ tx_sig: s.signature, slot: p.slot, block_time: p.block_time, amount: t.amount, dest_owner: t.dest_owner });
      }
      if (page.length < pageSize) { complete = true; break; }
      const oldest = page[page.length - 1];
      if (stopAtTime !== null && oldest.blockTime != null && oldest.blockTime < stopAtTime) { complete = true; break; }
      before = oldest.signature;
    }
  } catch (e) { reason = e.message; }
  return { entries: out.sort((a, b) => a.slot - b.slot || (a.tx_sig < b.tx_sig ? -1 : 1)), complete, reason };
}

// Decimals come from the mint account, not from a constant (Addendum C, fix 11).
export async function mintDecimals(rpc, mint) {
  const acct = await rpc.getAccountInfoParsed(mint);
  const d = acct?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(d) || d < 0 || d > 255) throw new Error(`cannot read the decimals of mint ${mint}`);
  return d;
}
