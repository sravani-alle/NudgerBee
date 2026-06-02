import { db } from '../index.js';

const getStmt = db.prepare('SELECT v FROM app_kv WHERE k = ?');
const setStmt = db.prepare(
  `INSERT INTO app_kv (k, v, updated_at) VALUES (?, ?, strftime('%s','now'))
   ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
);
const deleteStmt = db.prepare('DELETE FROM app_kv WHERE k = ?');

/**
 * @param {string} key
 * @returns {string | null}
 */
export function kvGet(key) {
  const row = /** @type {{ v: string } | undefined} */ (getStmt.get(key));
  return row ? row.v : null;
}

/**
 * @param {string} key
 * @param {string} value
 */
export function kvSet(key, value) {
  setStmt.run(key, value);
}

/** @param {string} key */
export function kvDelete(key) {
  deleteStmt.run(key);
}
