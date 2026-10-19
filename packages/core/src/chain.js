// Chain access and parsing. Everything pure takes jsonParsed getTransaction results, so tests can feed recorded devnet responses.
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export function makeRpc(url, { retries = 4, fetchImpl = fetch } = {}) {
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
        await new Promise((res) => setTimeout(res, 400 * 2 ** attempt));
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
    async getSignaturesForAddress(addr, opts = {}) { return call('getSignaturesForAddress', [addr, { commitment: 'confirmed', ...opts }]); },
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
    transfers.push({ source: i.source, destination: i.destination, mint: i.mint, authority: i.authority ?? i.multisigAuthority, amount: i.tokenAmount.amount, dest_owner: owners.get(i.destination) ?? null });
  }
  return { found: true, err: tx.meta?.err ?? null, slot: tx.slot, block_time: tx.blockTime ?? null, transfers };
}

// Agent spend history from chain: TransferChecked out of `source` with authority = agent, successful, ordered by (slot, signature).
export async function agentSpendHistory(rpc, { source, agent, mint, limit = 100, until = null, stopAtSig = null }) {
  const sigs = await rpc.getSignaturesForAddress(source, { limit, ...(until ? { until } : {}) });
  const out = [];
  for (const s of sigs) {
    if (s.err) continue;
    const p = parsePayment(await rpc.getTransaction(s.signature));
    if (!p.found || p.err) continue;
    for (const t of p.transfers) if (t.source === source && t.authority === agent && t.mint === mint) out.push({ tx_sig: s.signature, slot: p.slot, block_time: p.block_time, amount: t.amount, dest_owner: t.dest_owner });
    if (stopAtSig && s.signature === stopAtSig) break;
  }
  return out.sort((a, b) => a.slot - b.slot || (a.tx_sig < b.tx_sig ? -1 : 1));
}
