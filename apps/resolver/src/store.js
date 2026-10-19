// Only hashes and verdicts are stored, keyed by tx_sig (v3): a repeat dispute returns the stored verdict, never a second refund.
// refund_pending / refund_pending_at record a refund transaction that was signed but not yet confirmed (Addendum C, fix 9).
import { DatabaseSync } from 'node:sqlite';
export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS verdicts (tx_sig TEXT PRIMARY KEY, mandate_sha TEXT, receipt_sha TEXT, verdict TEXT NOT NULL, refund_tx TEXT, created_at INTEGER NOT NULL)');
  for (const col of ['refund_pending TEXT', 'refund_pending_at INTEGER']) { try { db.exec(`ALTER TABLE verdicts ADD COLUMN ${col}`); } catch { /* already there */ } }
  const get = db.prepare('SELECT * FROM verdicts WHERE tx_sig = ?');
  const put = db.prepare('INSERT OR IGNORE INTO verdicts (tx_sig, mandate_sha, receipt_sha, verdict, refund_tx, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const setRefund = db.prepare('UPDATE verdicts SET refund_tx = ?, refund_pending = NULL WHERE tx_sig = ? AND refund_tx IS NULL');
  const setPending = db.prepare('UPDATE verdicts SET refund_pending = ?, refund_pending_at = ? WHERE tx_sig = ? AND refund_tx IS NULL');
  return {
    get(tx) { const r = get.get(tx); return r ? { ...r, verdict: JSON.parse(r.verdict) } : null; },
    put(tx, { mandate_sha, receipt_sha, verdict, refund_tx = null, now }) { return put.run(tx, mandate_sha, receipt_sha, JSON.stringify(verdict), refund_tx, now).changes === 1; },
    setRefund(tx, sig) { return setRefund.run(sig, tx).changes === 1; },
    setPending(tx, sig, at) { setPending.run(sig, at, tx); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n; },
    close() { db.close(); },
  };
}
