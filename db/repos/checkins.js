import { db } from '../index.js';

const SECONDS_PER_DAY = 86400;

const insertStmt = db.prepare(
  `INSERT INTO checkins (slack_user_id, kind, content, created_at)
   VALUES (?, ?, ?, ?)`,
);
const getStreakStmt = db.prepare('SELECT honey_streak, last_checkin_at FROM hivemates WHERE slack_user_id = ?');
const setStreakStmt = db.prepare(
  `UPDATE hivemates
   SET honey_streak = ?, last_checkin_at = ?, last_active_at = ?, updated_at = strftime('%s','now'),
       dormant_since = NULL, dormancy_notified_at = NULL
   WHERE slack_user_id = ?`,
);
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE slack_user_id = ?');

/**
 * Pure Honey-streak rule, separated so every branch is unit-testable.
 *
 * Day boundaries are UTC day indices (floor(seconds / 86400)). Same-day repeat
 * check-ins don't inflate the streak; a single missed day resets it to 1.
 * (Per-timezone day boundaries are a future refinement; UTC is fine for the
 * sprint demo.)
 *
 * @param {number} prevStreak - current honey_streak (0 if never)
 * @param {number | null} lastCheckinSec - unix seconds of the last check-in, or null
 * @param {number} nowSec - unix seconds of this check-in
 * @returns {number} the new streak length
 */
export function computeStreak(prevStreak, lastCheckinSec, nowSec) {
  if (!lastCheckinSec) return 1;
  const lastDay = Math.floor(lastCheckinSec / SECONDS_PER_DAY);
  const today = Math.floor(nowSec / SECONDS_PER_DAY);
  const delta = today - lastDay;
  if (delta <= 0) return Math.max(prevStreak, 1); // same day (or clock skew): unchanged
  if (delta === 1) return prevStreak + 1; // consecutive day: extend
  return 1; // a day (or more) was missed: restart
}

/**
 * Record a check-in and recompute the Hivemate's Honey streak atomically.
 *
 * @param {string} userId
 * @param {'meds'|'food'|'mood'|'text'|'photo'} kind
 * @param {string | null} [content]
 * @param {number} [nowSec] - injectable for tests; defaults to now
 * @returns {{ honey_streak: number, kind: string }}
 */
export function recordCheckin(userId, kind, content = null, nowSec = Math.floor(Date.now() / 1000)) {
  const tx = db.transaction(() => {
    insertStmt.run(userId, kind, content, nowSec);
    const row = /** @type {{ honey_streak: number, last_checkin_at: number|null } | undefined} */ (
      getStreakStmt.get(userId)
    );
    const newStreak = computeStreak(row?.honey_streak ?? 0, row?.last_checkin_at ?? null, nowSec);
    // A check-in is activity: bump honey_streak + last_checkin_at + last_active_at
    // and clear dormancy in one statement.
    setStreakStmt.run(newStreak, nowSec, nowSec, userId);
    return newStreak;
  });
  return { honey_streak: tx(), kind };
}

/**
 * @param {string} userId
 * @returns {number} total check-ins ever recorded for this user
 */
export function countCheckins(userId) {
  const row = /** @type {{ n: number }} */ (countStmt.get(userId));
  return row?.n ?? 0;
}
