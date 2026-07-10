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
  `UPDATE hivemates
   SET last_active_at = strftime('%s','now'), updated_at = strftime('%s','now'),
       dormant_since = NULL, dormancy_notified_at = NULL
   WHERE slack_user_id = ?`,
);

const setDormantSinceStmt = db.prepare(
  `UPDATE hivemates SET dormant_since = ?, updated_at = strftime('%s','now') WHERE slack_user_id = ?`,
);

const setDormancyNotifiedStmt = db.prepare(
  `UPDATE hivemates SET dormancy_notified_at = ?, updated_at = strftime('%s','now') WHERE slack_user_id = ?`,
);

const completeOnboardingStmt = db.prepare(
  `UPDATE hivemates
   SET profile_json = ?, onboarding_state = 'complete', updated_at = strftime('%s','now')
   WHERE slack_user_id = ?`,
);

const updateCohortStmt = db.prepare(
  `UPDATE hivemates SET cohort_key = ?, updated_at = strftime('%s','now')
   WHERE slack_user_id = ?`,
);

const listByCohortStmt = db.prepare("SELECT * FROM hivemates WHERE cohort_key = ? AND onboarding_state = 'complete'");

const listActiveStmt = db.prepare("SELECT * FROM hivemates WHERE onboarding_state = 'complete'");

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

/**
 * Mark a Hivemate active "now" and clear any dormancy flags — they're back, so
 * a future quiet spell should be eligible to page the keeper again.
 * @param {string} userId
 */
export function touchActive(userId) {
  touchActiveStmt.run(userId);
}

/**
 * @param {string} userId
 * @param {number} sinceSec - unix seconds they have been quiet since
 */
export function setDormantSince(userId, sinceSec) {
  setDormantSinceStmt.run(sinceSec, userId);
}

/**
 * @param {string} userId
 * @param {number} atSec - unix seconds the keeper was paged about this dormancy
 */
export function setDormancyNotified(userId, atSec) {
  setDormancyNotifiedStmt.run(atSec, userId);
}

/**
 * Finalize onboarding: persist the consolidated profile and flip the state to
 * 'complete' in one statement. Note this does NOT touch `language` — that is
 * owned by the deterministic detector in `services/language.js`.
 *
 * @param {string} userId
 * @param {Record<string, string>} profile - the filled slot map to consolidate
 */
export function completeOnboarding(userId, profile) {
  completeOnboardingStmt.run(JSON.stringify(profile ?? {}), userId);
}

/**
 * @param {string} userId
 * @param {string} cohortKey
 */
export function setCohortKey(userId, cohortKey) {
  updateCohortStmt.run(cohortKey, userId);
}

/**
 * @param {string} cohortKey
 * @returns {HivemateRow[]} completed Hivemates in this cohort
 */
export function listByCohort(cohortKey) {
  return /** @type {HivemateRow[]} */ (listByCohortStmt.all(cohortKey));
}

/**
 * @returns {HivemateRow[]} all Hivemates who have finished onboarding
 */
export function listActiveHivemates() {
  return /** @type {HivemateRow[]} */ (listActiveStmt.all());
}

/**
 * A human-friendly label for a Hivemate in user-facing copy (keeper digests,
 * hive_stats, peer suggestions). Real Slack users have no stored name, so we
 * render a `<@id>` mention that Slack resolves to their display name. Seeded
 * demo Hivemates carry a `name` in their profile_json so they read as "Rosa"
 * even though their id isn't a real Slack user.
 *
 * @param {HivemateRow | null | undefined} row
 * @returns {string}
 */
export function displayName(row) {
  if (!row) return 'a Hivemate';
  try {
    const name = JSON.parse(row.profile_json || '{}')?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch {
    // profile_json not valid JSON — fall through to a mention
  }
  return `<@${row.slack_user_id}>`;
}
