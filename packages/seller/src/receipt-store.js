// The gate's own record of the receipts it signed, by tx_sig, in a SQLite file under the gate's dataDir (Addendum H, H1). One receipt per settled
// transaction has to survive a restart: a facilitator that repeats a success after a restart must get the SAME bytes back, never a second receipt with
// another settled_at (that would be receipt_equivocation against an honest seller). A store that cannot be opened or fails its integrity check stops the start.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openReceiptStore(dataDir) {
  const file = path.join(dataDir, 'receipts.sqlite');
  let db;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(file);
    const ok = db.prepare('PRAGMA integrity_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('integrity check failed');
    db.exec('CREATE TABLE IF NOT EXISTS receipts (tx_sig TEXT PRIMARY KEY, bytes TEXT NOT NULL, issued_at INTEGER NOT NULL)');
  } catch (e) {
    try { db?.close(); } catch { /* already unusable */ }
    throw new Error(`createSellerGate: the receipt store ${file} is unreadable or corrupt (${e.message}); refusing to start`);
  }
  const get = db.prepare('SELECT bytes FROM receipts WHERE tx_sig = ?');
  const put = db.prepare('INSERT OR IGNORE INTO receipts (tx_sig, bytes, issued_at) VALUES (?, ?, ?)');
  return {
    get: (tx) => get.get(tx)?.bytes,
    // returns the bytes that are stored for this tx_sig after the write: ours, or the ones another writer got in first
    put(tx, bytes) { put.run(tx, bytes, Date.now()); return get.get(tx).bytes; },
    close() { db.close(); },
  };
}
