// provisional = decided without a seller receipt; replaced = the provisional verdicts a later receipt superseded (kept for the record).
// Only hashes and verdicts are stored, keyed by tx_sig (v3): a repeat dispute returns the stored verdict, never a second refund.
// refund_pending / refund_pending_at record a refund transaction that was signed but not yet confirmed (Addendum C, fix 9).
import { DatabaseSync } from 'node:sqlite';
export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS verdicts (tx_sig TEXT PRIMARY KEY, mandate_sha TEXT, receipt_sha TEXT, verdict TEXT NOT NULL, refund_tx TEXT, created_at INTEGER NOT NULL)');
  for (const col of ['refund_pending TEXT', 'refund_pending_at INTEGER', 'provisional INTEGER DEFAULT 0', 'replaced TEXT']) { try { db.exec(`ALTER TABLE verdicts ADD COLUMN ${col}`); } catch { /* already there */ } }
  const get = db.prepare('SELECT * FROM verdicts WHERE tx_sig = ?');
  const put = db.prepare('INSERT OR IGNORE INTO verdicts (tx_sig, mandate_sha, receipt_sha, verdict, refund_tx, created_at, provisional, replaced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const replace = db.prepare('UPDATE verdicts SET mandate_sha = ?, receipt_sha = ?, verdict = ?, created_at = ?, provisional = 0, replaced = ? WHERE tx_sig = ? AND provisional = 1');
  const setRefund = db.prepare('UPDATE verdicts SET refund_tx = ?, refund_pending = NULL WHERE tx_sig = ? AND refund_tx IS NULL');
  const setPending = db.prepare('UPDATE verdicts SET refund_pending = ?, refund_pending_at = ? WHERE tx_sig = ? AND refund_tx IS NULL');
  return {
    get(tx) { const r = get.get(tx); return r ? { ...r, verdict: JSON.parse(r.verdict), provisional: r.provisional === 1, replaced: r.replaced ? JSON.parse(r.replaced) : [] } : null; },
    put(tx, { mandate_sha, receipt_sha, verdict, refund_tx = null, now, provisional = false }) { return put.run(tx, mandate_sha, receipt_sha, JSON.stringify(verdict), refund_tx, now, provisional ? 1 : 0, null).changes === 1; },
    // a provisional verdict is replaced by one decided with a verifying receipt; the replaced verdict stays in the record (replaced column)
    replaceProvisional(tx, { mandate_sha, receipt_sha, verdict, now }) {
      const old = get.get(tx);
      if (!old || old.provisional !== 1) return false;
      const history = [...(old.replaced ? JSON.parse(old.replaced) : []), { verdict: JSON.parse(old.verdict), mandate_sha: old.mandate_sha, receipt_sha: old.receipt_sha, decided_at: old.created_at }];
      return replace.run(mandate_sha, receipt_sha, JSON.stringify(verdict), now, JSON.stringify(history), tx).changes === 1;
    },
    setRefund(tx, sig) { return setRefund.run(sig, tx).changes === 1; },
    setPending(tx, sig, at) { setPending.run(sig, at, tx); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n; },
    close() { db.close(); },
  };
}
