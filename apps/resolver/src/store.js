// provisional = decided without a seller receipt; replaced = the provisional verdicts a later receipt superseded (kept for the record).
// Only hashes and verdicts are stored, keyed by tx_sig (v3): a repeat dispute returns the stored verdict, never a second refund.
// refund_pending / refund_pending_at record a refund transaction that was signed but not yet confirmed (Addendum C, fix 9).
import { DatabaseSync } from 'node:sqlite';
export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS verdicts (tx_sig TEXT PRIMARY KEY, mandate_sha TEXT, receipt_sha TEXT, verdict TEXT NOT NULL, refund_tx TEXT, created_at INTEGER NOT NULL)');
  for (const col of ['refund_pending TEXT', 'refund_pending_at INTEGER', 'provisional INTEGER DEFAULT 0', 'replaced TEXT', 'receipt_json TEXT', 'grant_tx TEXT', 'verdict_id TEXT']) { try { db.exec(`ALTER TABLE verdicts ADD COLUMN ${col}`); } catch { /* already there */ } }
  // verified-history checkpoints, one per grant (Addendum G, T2): the newest signature read plus the verified debits up to it
  db.exec('CREATE TABLE IF NOT EXISTS checkpoints (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const getCp = db.prepare('SELECT json FROM checkpoints WHERE key = ?');
  const putCp = db.prepare('INSERT INTO checkpoints (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
  const get = db.prepare('SELECT * FROM verdicts WHERE tx_sig = ?');
  const put = db.prepare('INSERT OR IGNORE INTO verdicts (tx_sig, mandate_sha, receipt_sha, verdict, refund_tx, created_at, provisional, replaced, receipt_json, grant_tx, verdict_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const replace = db.prepare('UPDATE verdicts SET mandate_sha = ?, receipt_sha = ?, verdict = ?, created_at = ?, provisional = 0, replaced = ?, receipt_json = ?, grant_tx = ?, verdict_id = ? WHERE tx_sig = ? AND provisional = 1 AND created_at = ? AND verdict = ?');
  const replaceAny = db.prepare('UPDATE verdicts SET mandate_sha = ?, receipt_sha = ?, verdict = ?, created_at = ?, provisional = 0, replaced = ?, receipt_json = ?, grant_tx = ?, verdict_id = ? WHERE tx_sig = ? AND created_at = ? AND verdict = ?');
  const setRefund = db.prepare('UPDATE verdicts SET refund_tx = ?, refund_pending = NULL WHERE tx_sig = ? AND refund_tx IS NULL');
  const setPending = db.prepare('UPDATE verdicts SET refund_pending = ?, refund_pending_at = ? WHERE tx_sig = ? AND refund_tx IS NULL');
  const rowOf = (r) => ({ ...r, verdict: JSON.parse(r.verdict), provisional: r.provisional === 1, replaced: r.replaced ? JSON.parse(r.replaced) : [] });
  return {
    get(tx) { const r = get.get(tx); return r ? { ...r, verdict: JSON.parse(r.verdict), provisional: r.provisional === 1, replaced: r.replaced ? JSON.parse(r.replaced) : [] } : null; },
    put(tx, { mandate_sha, receipt_sha, verdict, refund_tx = null, now, provisional = false, receipt = null, grant_tx = null, verdict_id = null }) { return put.run(tx, mandate_sha, receipt_sha, JSON.stringify(verdict), refund_tx, now, provisional ? 1 : 0, null, receipt ? JSON.stringify(receipt) : null, grant_tx, verdict_id).changes === 1; },
    // A provisional verdict is replaced by one decided with a verifying receipt; the replaced verdict stays in the record (replaced column) with the id and the
    // grant_tx and provisional flag its record hashed. Both replacements are compare-and-swap on the row the caller READ (`expect`: its created_at and verdict): a row
    // that changed meanwhile (another service on the same store) is not replaced, and the caller answers from the row that is there (Addendum M, M4 d).
    // `idOfOld(row)` computes the id of the row read INSIDE this call, so the kept id always pairs with the verdict it sits beside.
    replaceProvisional(tx, { mandate_sha, receipt_sha, verdict, now, receipt = null, grant_tx = null, verdict_id = null, expect = null, idOfOld = () => null }) {
      const old = get.get(tx);
      if (!old || old.provisional !== 1) return false;
      if (expect && (old.created_at !== expect.created_at || old.verdict !== JSON.stringify(expect.verdict))) return false;
      const history = [...(old.replaced ? JSON.parse(old.replaced) : []), { verdict: JSON.parse(old.verdict), mandate_sha: old.mandate_sha, receipt_sha: old.receipt_sha, decided_at: old.created_at, grant_tx: old.grant_tx ?? null, provisional: true, verdict_id: idOfOld(rowOf(old)) }];
      return replace.run(mandate_sha, receipt_sha, JSON.stringify(verdict), now, JSON.stringify(history), receipt ? JSON.stringify(receipt) : null, grant_tx, verdict_id, tx, old.created_at, old.verdict).changes === 1;
    },
    // receipt equivocation replaces whatever is stored, provisional or final; the replaced verdict stays in the record and the refund columns are kept
    replaceAny(tx, { mandate_sha, receipt_sha, verdict, now, receipt, grant_tx = null, verdict_id = null, expect = null, idOfOld = () => null }) {
      const old = get.get(tx);
      if (!old) return false;
      if (expect && (old.created_at !== expect.created_at || old.verdict !== JSON.stringify(expect.verdict))) return false;
      const history = [...(old.replaced ? JSON.parse(old.replaced) : []), { verdict: JSON.parse(old.verdict), mandate_sha: old.mandate_sha, receipt_sha: old.receipt_sha, decided_at: old.created_at, grant_tx: old.grant_tx ?? null, provisional: old.provisional === 1, verdict_id: idOfOld(rowOf(old)) }];
      return replaceAny.run(mandate_sha, receipt_sha, JSON.stringify(verdict), now, JSON.stringify(history), JSON.stringify(receipt), grant_tx, verdict_id, tx, old.created_at, old.verdict).changes === 1;
    },
    setRefund(tx, sig) { return setRefund.run(sig, tx).changes === 1; },
    setPending(tx, sig, at) { setPending.run(sig, at, tx); },
    getCheckpoint(key) { const r = getCp.get(key); return r ? JSON.parse(r.json) : null; },
    putCheckpoint(key, cp, now) { putCp.run(key, JSON.stringify(cp), now); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n; },
    close() { db.close(); },
  };
}
