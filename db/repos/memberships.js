import { db } from '../index.js';

const addStmt = db.prepare(
  `INSERT INTO memberships (slack_user_id, slack_channel_id, joined_at)
   VALUES (?, ?, strftime('%s','now'))
   ON CONFLICT(slack_user_id, slack_channel_id) DO NOTHING`,
);
const hasStmt = db.prepare('SELECT 1 FROM memberships WHERE slack_user_id = ? AND slack_channel_id = ?');
const listForChannelStmt = db.prepare('SELECT slack_user_id FROM memberships WHERE slack_channel_id = ?');

/**
 * Record that a Hivemate belongs to a cohort channel. Idempotent.
 * @param {string} userId
 * @param {string} channelId
 */
export function addMembership(userId, channelId) {
  addStmt.run(userId, channelId);
}

/**
 * @param {string} userId
 * @param {string} channelId
 * @returns {boolean}
 */
export function isMember(userId, channelId) {
  return hasStmt.get(userId, channelId) != null;
}

/**
 * @param {string} channelId
 * @returns {string[]} member user ids
 */
export function listMembers(channelId) {
  const rows = /** @type {{ slack_user_id: string }[]} */ (listForChannelStmt.all(channelId));
  return rows.map((r) => r.slack_user_id);
}
