import { db } from '../index.js';

const getStmt = db.prepare('SELECT * FROM hivemates WHERE slack_user_id = ?');

const upsertStmt = db.prepare(
  `INSERT INTO hivemates (slack_user_id, slack_team_id, joined_at, updated_at)
   VALUES (?, ?, strftime('%s','now'), strftime('%s','now'))
   ON CONFLICT(slack_user_id) DO UPDATE SET
     slack_team_id = excluded.slack_team_id,
     updated_at = excluded.updated_at`,
);

const updateStateStmt = db.prepare(
  `UPDATE hivemates SET onboarding_state = ?, updated_at = strftime('%s','now')
   WHERE slack_user_id = ?`,
);

const updateLanguageStmt = db.prepare(
  `UPDATE hivemates SET language = ?, updated_at = strftime('%s','now')
   WHERE slack_user_id = ?`,
);

const touchActiveStmt = db.prepare(
  `UPDATE hivemates SET last_active_at = strftime('%s','now'), updated_at = strftime('%s','now')
   WHERE slack_user_id = ?`,
);

/**
 * @typedef {Object} HivemateRow
 * @property {string} slack_user_id
 * @property {string} slack_team_id
 * @property {string} language
 * @property {string|null} timezone
 * @property {'new'|'in_progress'|'complete'} onboarding_state
 * @property {string|null} cohort_key
 * @property {string} profile_json
 * @property {number|null} last_active_at
 * @property {number|null} dormant_since
 * @property {number|null} dormancy_notified_at
 * @property {number} honey_streak
 * @property {number|null} last_checkin_at
 * @property {number} joined_at
 * @property {number} updated_at
 */

/**
 * Ensure a hivemates row exists. Idempotent.
 * @param {{userId: string, teamId: string}} args
 */
export function upsertHivemate({ userId, teamId }) {
  upsertStmt.run(userId, teamId);
}

/**
 * @param {string} userId
 * @returns {HivemateRow | null}
 */
export function getHivemate(userId) {
  const row = getStmt.get(userId);
  return /** @type {HivemateRow | null} */ (row ?? null);
}

/**
 * @param {string} userId
 * @param {'new'|'in_progress'|'complete'} state
 */
export function setOnboardingState(userId, state) {
  updateStateStmt.run(state, userId);
}

/**
 * @param {string} userId
 * @param {string} language
 */
export function setLanguage(userId, language) {
  updateLanguageStmt.run(language, userId);
}

/** @param {string} userId */
export function touchActive(userId) {
  touchActiveStmt.run(userId);
}
