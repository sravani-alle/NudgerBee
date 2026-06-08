import { db } from '../index.js';

const addStmt = db.prepare(
  `INSERT INTO intros (requester_user_id, peer_user_id, cohort_key, created_at)
   VALUES (?, ?, ?, strftime('%s','now'))
   ON CONFLICT(requester_user_id, peer_user_id) DO NOTHING`,
);
const hasStmt = db.prepare('SELECT 1 FROM intros WHERE requester_user_id = ? AND peer_user_id = ?');

/**
 * Record that `requester` was introduced to `peer`. Idempotent.
 * @param {string} requesterUserId
 * @param {string} peerUserId
 * @param {string|null} [cohortKey]
 */
export function addIntro(requesterUserId, peerUserId, cohortKey = null) {
  addStmt.run(requesterUserId, peerUserId, cohortKey);
}

/**
 * Has this exact directed intro already happened?
 * @param {string} requesterUserId
 * @param {string} peerUserId
 * @returns {boolean}
 */
export function hasIntro(requesterUserId, peerUserId) {
  return hasStmt.get(requesterUserId, peerUserId) != null;
}
