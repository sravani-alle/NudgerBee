/**
 * Activity provider — how the bee decides when a Hivemate has gone "dormant."
 *
 * REWORK NOTE: the original Phase E design polled `conversations.history` of each
 * cohort channel. The Phase C redesign removed cohort channels, so activity is
 * now derived from what we already track per Hivemate: `last_active_at` (touched
 * on every DM turn) and `last_checkin_at` (a Honey check-in). This keeps the
 * `ActivityProvider`-style indirection so a future real-time/search overlay can
 * slot in without changing the silence scheduler.
 */

const SECONDS_PER_DAY = 86400;

/**
 * The most recent moment we have any signal a Hivemate was active. Falls back
 * to when they joined, so a never-active completed Hivemate is measured from
 * join time rather than treated as active forever.
 *
 * @param {import('../db/repos/hivemates.js').HivemateRow} hivemate
 * @returns {number} unix seconds
 */
export function lastActiveAt(hivemate) {
  return Math.max(hivemate.last_active_at ?? 0, hivemate.last_checkin_at ?? 0, hivemate.joined_at ?? 0);
}

/**
 * If the Hivemate has been quiet for at least `thresholdDays`, return the unix
 * second they were last active (i.e. "dormant since"); otherwise null.
 *
 * @param {import('../db/repos/hivemates.js').HivemateRow} hivemate
 * @param {number} thresholdDays
 * @param {number} [nowSec] - injectable for tests
 * @returns {number | null}
 */
export function dormantSince(hivemate, thresholdDays, nowSec = Math.floor(Date.now() / 1000)) {
  const last = lastActiveAt(hivemate);
  const quietSeconds = nowSec - last;
  return quietSeconds >= thresholdDays * SECONDS_PER_DAY ? last : null;
}
