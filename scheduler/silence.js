import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { displayName, listActiveHivemates, setDormancyNotified, setDormantSince } from '../db/repos/hivemates.js';
import { kvGet } from '../db/repos/kv.js';
import { dormantSince } from '../services/activity.js';
import { sendDormancyDigest } from '../services/hivekeeper.js';
import { keeperFor } from '../services/keepers.js';

/** @type {WebClient | undefined} */
let fallbackClient;
/** @param {WebClient} [provided] */
function getClient(provided) {
  if (provided) return provided;
  if (!fallbackClient) fallbackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  return fallbackClient;
}

/**
 * Hourly dormancy scan. Walks completed Hivemates; any quiet for >= threshold
 * days is flagged `dormant_since`. The cohort's Hive Keeper is paged ONCE per
 * dormancy spell (gated by `dormancy_notified_at`); a digest groups all of a
 * keeper's dormant Hivemates into one DM. Activity (a DM turn or a check-in)
 * clears the dormancy flags, so a later quiet spell pages again.
 *
 * @param {{ client?: WebClient, thresholdDays?: number, nowSec?: number, logger?: any }} [opts]
 * @returns {Promise<{ threshold: number, flagged: number, paged: number, noKeeper: number, notified: string[] }>}
 */
export async function runSilenceScan({
  client: provided,
  thresholdDays,
  nowSec = Math.floor(Date.now() / 1000),
  logger = console,
} = {}) {
  const threshold = thresholdDays ?? (Number(kvGet('dormancy_threshold_days')) || 3);
  const client = getClient(provided);

  /** @type {Map<string, { userId: string, name: string, since: number }[]>} */
  const byKeeper = new Map();
  let flagged = 0;
  let noKeeper = 0;

  for (const hm of listActiveHivemates()) {
    const since = dormantSince(hm, threshold, nowSec);
    if (since == null) continue;
    flagged++;
    setDormantSince(hm.slack_user_id, since); // record/refresh the spell (idempotent)

    if (hm.dormancy_notified_at != null) continue; // already paged for this spell

    const keeperId = keeperFor(hm.cohort_key);
    if (!keeperId || keeperId === hm.slack_user_id) {
      noKeeper++;
      continue;
    }
    if (!byKeeper.has(keeperId)) byKeeper.set(keeperId, []);
    byKeeper.get(keeperId)?.push({ userId: hm.slack_user_id, name: displayName(hm), since });
  }

  /** @type {string[]} */
  const notified = [];
  for (const [keeperId, dormant] of byKeeper) {
    const sent = await sendDormancyDigest({ client, keeperId, dormant, nowSec, logger });
    if (sent) {
      for (const d of dormant) {
        setDormancyNotified(d.userId, nowSec); // gate: don't re-page this spell
        notified.push(d.userId);
      }
    }
  }

  logger.info?.(`[silence] threshold=${threshold}d flagged=${flagged} paged=${notified.length} noKeeper=${noKeeper}`);
  return { threshold, flagged, paged: notified.length, noKeeper, notified };
}
