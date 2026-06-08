import { db } from '../index.js';

const insertStmt = db.prepare(
  `INSERT INTO nudge_log (slack_user_id, slack_channel_id, kind, template_id, message, created_at)
   VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`,
);
const countByKindStmt = db.prepare('SELECT COUNT(*) AS n FROM nudge_log WHERE slack_user_id = ? AND kind = ?');
const recentStmt = db.prepare('SELECT * FROM nudge_log WHERE slack_user_id = ? ORDER BY created_at DESC LIMIT ?');

/**
 * Record an outbound message the bee sent. Powers template round-robin
 * (counting prior `reminder` rows) and the visible escalation/silence story.
 *
 * @param {{ userId: string, channelId?: string|null, kind: string, templateId?: number|null, message: string }} args
 */
export function logNudge({ userId, channelId = null, kind, templateId = null, message }) {
  insertStmt.run(userId, channelId, kind, templateId, message);
}

/**
 * How many nudges of a given kind we've sent this user — used to round-robin
 * reminder templates so the same one never lands twice in a row.
 *
 * @param {string} userId
 * @param {string} kind
 * @returns {number}
 */
export function countNudges(userId, kind) {
  const row = /** @type {{ n: number }} */ (countByKindStmt.get(userId, kind));
  return row?.n ?? 0;
}

/**
 * @param {string} userId
 * @param {number} [limit]
 * @returns {any[]}
 */
export function recentNudges(userId, limit = 10) {
  return recentStmt.all(userId, limit);
}
