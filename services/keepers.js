/**
 * Hive Keeper resolution + hive overview.
 *
 * There is no `hive_keepers` table yet (Deferred). A keeper is recorded in
 * `app_kv` as `keeper:{cohort_key} = <slack_user_id>`, with an optional
 * workspace-wide `default_keeper`. This module is the single place that reads
 * those conventions, shared by the silence scheduler (who to page) and the
 * safety/stats tools (escalation target + a keeper's hive overview).
 */

import { listActiveHivemates } from '../db/repos/hivemates.js';
import { kvEntriesWithPrefix, kvGet } from '../db/repos/kv.js';
import { lastActiveAt } from './activity.js';

const SECONDS_PER_DAY = 86400;

/**
 * Resolve the Hive Keeper for a cohort: the cohort-specific keeper, else the
 * workspace `default_keeper`, else null.
 * @param {string | null | undefined} cohortKey
 * @returns {string | null}
 */
export function keeperFor(cohortKey) {
  return (cohortKey && kvGet(`keeper:${cohortKey}`)) || kvGet('default_keeper') || null;
}

/**
 * The cohort keys a user keeps (via `keeper:{cohort_key}` entries).
 * @param {string} userId
 * @returns {string[]}
 */
export function cohortsForKeeper(userId) {
  return kvEntriesWithPrefix('keeper:')
    .filter((e) => e.v === userId)
    .map((e) => e.k.slice('keeper:'.length));
}

/**
 * Is this user a Hive Keeper at all — of any cohort, or the workspace default?
 * Gates the `hive_stats` tool so only keepers can query the hive overview.
 * @param {string} userId
 * @returns {boolean}
 */
export function isKeeper(userId) {
  return cohortsForKeeper(userId).length > 0 || kvGet('default_keeper') === userId;
}

/**
 * Build a keeper's hive overview: their Hivemates bucketed by activity, with
 * streaks and days-quiet. A `default_keeper` sees the whole hive; a cohort
 * keeper sees only their cohorts. No health details — cohort + activity only.
 *
 * @param {string} userId
 * @param {{ thresholdDays?: number, nowSec?: number }} [opts]
 * @returns {{
 *   isKeeper: boolean,
 *   scope: 'all' | 'cohorts',
 *   cohorts: string[],
 *   total: number,
 *   activeCount: number,
 *   dormant: { userId: string, cohort: string | null, daysQuiet: number }[],
 *   topStreaks: { userId: string, streak: number }[],
 * }}
 */
export function statsForKeeper(userId, { thresholdDays, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const threshold = thresholdDays ?? (Number(kvGet('dormancy_threshold_days')) || 3);
  const isDefault = kvGet('default_keeper') === userId;
  const owned = new Set(cohortsForKeeper(userId));

  if (!isDefault && owned.size === 0) {
    return { isKeeper: false, scope: 'cohorts', cohorts: [], total: 0, activeCount: 0, dormant: [], topStreaks: [] };
  }

  const mine = listActiveHivemates().filter((h) => isDefault || (h.cohort_key && owned.has(h.cohort_key)));

  const dormant = [];
  let activeCount = 0;
  for (const h of mine) {
    const daysQuiet = Math.floor((nowSec - lastActiveAt(h)) / SECONDS_PER_DAY);
    if (daysQuiet >= threshold) {
      dormant.push({ userId: h.slack_user_id, cohort: h.cohort_key, daysQuiet });
    } else {
      activeCount++;
    }
  }
  dormant.sort((a, b) => b.daysQuiet - a.daysQuiet);

  const topStreaks = mine
    .filter((h) => (h.honey_streak ?? 0) > 0)
    .sort((a, b) => (b.honey_streak ?? 0) - (a.honey_streak ?? 0))
    .slice(0, 5)
    .map((h) => ({ userId: h.slack_user_id, streak: h.honey_streak ?? 0 }));

  return {
    isKeeper: true,
    scope: isDefault ? 'all' : 'cohorts',
    cohorts: isDefault ? [...new Set(mine.map((h) => h.cohort_key).filter(Boolean))] : [...owned],
    total: mine.length,
    activeCount,
    dormant,
    topStreaks,
  };
}
