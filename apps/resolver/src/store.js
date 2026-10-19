// Only hashes and verdicts are stored, keyed by tx_sig (v3): a repeat dispute returns the stored verdict, never a second refund.
import { DatabaseSync } from 'node:sqlite';
export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS verdicts (tx_sig TEXT PRIMARY KEY, mandate_sha TEXT, receipt_sha TEXT, verdict TEXT NOT NULL, refund_tx TEXT, created_at INTEGER NOT NULL)');
  const get = db.prepare('SELECT * FROM verdicts WHERE tx_sig = ?');
  const put = db.prepare('INSERT OR IGNORE INTO verdicts (tx_sig, mandate_sha, receipt_sha, verdict, refund_tx, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const setRefund = db.prepare('UPDATE verdicts SET refund_tx = ? WHERE tx_sig = ?');
  return {
    get(tx) { const r = get.get(tx); return r ? { ...r, verdict: JSON.parse(r.verdict) } : null; },
    put(tx, { mandate_sha, receipt_sha, verdict, refund_tx = null, now }) { return put.run(tx, mandate_sha, receipt_sha, JSON.stringify(verdict), refund_tx, now).changes === 1; },
    setRefund(tx, sig) { setRefund.run(sig, tx); },
    count() { return db.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n; },
    close() { db.close(); },
  };
}
