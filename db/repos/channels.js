import { db } from '../index.js';

const getByCohortStmt = db.prepare('SELECT * FROM channels WHERE cohort_key = ?');
const getByChannelStmt = db.prepare('SELECT * FROM channels WHERE slack_channel_id = ?');
const insertStmt = db.prepare(
  `INSERT INTO channels (cohort_key, slack_channel_id, slack_team_id, display_name, created_at)
   VALUES (?, ?, ?, ?, strftime('%s','now'))
   ON CONFLICT(cohort_key) DO NOTHING`,
);
const listStmt = db.prepare('SELECT * FROM channels');

/**
 * @typedef {Object} ChannelRow
 * @property {string} cohort_key
 * @property {string} slack_channel_id
 * @property {string} slack_team_id
 * @property {string|null} display_name
 * @property {number} created_at
 */

/**
 * @param {string} cohortKey
 * @returns {ChannelRow | null}
 */
export function getChannelByCohort(cohortKey) {
  return /** @type {ChannelRow | null} */ (getByCohortStmt.get(cohortKey) ?? null);
}

/**
 * @param {string} channelId
 * @returns {ChannelRow | null}
 */
export function getChannelById(channelId) {
  return /** @type {ChannelRow | null} */ (getByChannelStmt.get(channelId) ?? null);
}

/**
 * Persist a cohort → channel mapping. No-op if the cohort already has one.
 * @param {{ cohortKey: string, channelId: string, teamId: string, displayName?: string }} args
 */
export function insertChannel({ cohortKey, channelId, teamId, displayName }) {
  insertStmt.run(cohortKey, channelId, teamId, displayName ?? null);
}

/** @returns {ChannelRow[]} */
export function listChannels() {
  return /** @type {ChannelRow[]} */ (listStmt.all());
}
