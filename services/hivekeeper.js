const SECONDS_PER_DAY = 86400;

/**
 * Human "N days ago" from a unix-second timestamp, relative to now.
 * @param {number} sinceSec
 * @param {number} nowSec
 * @returns {string}
 */
function quietFor(sinceSec, nowSec) {
  const days = Math.floor((nowSec - sinceSec) / SECONDS_PER_DAY);
  if (days <= 0) return 'less than a day';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * DM one Hive Keeper a single digest of the dormant Hivemates in their cohorts.
 * One line per Hivemate, name-mention only — NO health details (the cohort and
 * "quiet for N days" is all the keeper needs to reach out).
 *
 * @param {{
 *   client: import('@slack/web-api').WebClient,
 *   keeperId: string,
 *   dormant: { userId: string, name?: string, since: number }[],
 *   nowSec: number,
 *   logger?: { warn?: Function },
 * }} args
 * @returns {Promise<boolean>} whether the digest was sent
 */
export async function sendDormancyDigest({ client, keeperId, dormant, nowSec, logger = console }) {
  if (!dormant.length) return false;
  try {
    const dm = await client.conversations.open({ users: keeperId });
    const dmChannel = dm.channel?.id;
    if (!dmChannel) return false;

    const lines = dormant
      .map((d) => `• ${d.name || `<@${d.userId}>`} — quiet for ${quietFor(d.since, nowSec)}`)
      .join('\n');
    const header =
      dormant.length === 1
        ? '🐝 One of your Hivemates has gone quiet — a gentle hello might help:'
        : `🐝 ${dormant.length} of your Hivemates have gone quiet — a gentle hello might help:`;
    await client.chat.postMessage({ channel: dmChannel, text: `${header}\n${lines}` });
    return true;
  } catch (e) {
    logger.warn?.(`hivekeeper: digest to ${keeperId} failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
