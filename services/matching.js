import { setCohortKey } from '../db/repos/hivemates.js';
import { kvGet } from '../db/repos/kv.js';
import { listSlots } from '../db/repos/slots.js';
import { derive } from './cohorts.js';
import { hasConsented, suggestPeers } from './peers.js';

/**
 * Phase C — peer matching. Runs right after a Hivemate completes onboarding
 * (wired through `complete_onboarding`'s onComplete hook). Instead of dropping
 * them into a shared channel, it derives their cohort and returns a short list
 * of peers they could reach out to. The result is surfaced in the
 * complete_onboarding tool output so the bee can warmly present the peers and
 * offer to introduce them (see `request_intro`).
 *
 * Side effects are limited to persisting the cohort key and an optional Hive
 * Keeper ping; the actual peer connection is initiated by the Hivemate via the
 * intro tool, and the bee never inserts itself into that 1:1 conversation.
 *
 * @param {{ client: import('@slack/web-api').WebClient, userId: string, teamId: string, logger?: { info?: Function, warn?: Function, error?: Function } }} args
 * @returns {Promise<{ cohortKey: string, consented: boolean, suggestions: { user_id: string, blurb: string }[] }>}
 */
export async function runMatching({ client, userId, logger = console }) {
  const profile = listSlots(userId);
  const cohortKey = derive(profile);
  setCohortKey(userId, cohortKey);

  // Respect the Hivemate's own choice: if they didn't consent to matching, we
  // neither suggest peers to them nor expose them to others.
  const consented = hasConsented(profile.consent);
  const suggestions = consented ? suggestPeers(cohortKey, userId, 3) : [];

  // Ping the cohort's Hive Keeper, if one is configured. Best-effort.
  try {
    const keeperId = kvGet(`keeper:${cohortKey}`);
    if (keeperId && keeperId !== userId) {
      const dm = await client.conversations.open({ users: keeperId });
      const dmChannel = dm.channel?.id;
      if (dmChannel) {
        await client.chat.postMessage({
          channel: dmChannel,
          text: `🐝 A new Hivemate just joined your *${cohortKey}* cohort. They might appreciate a warm hello when you have a moment.`,
        });
      }
    }
  } catch (e) {
    logger.warn?.(`matching: keeper ping failed for cohort ${cohortKey}: ${e instanceof Error ? e.message : e}`);
  }

  logger.info?.(
    `matching: ${userId} → cohort ${cohortKey} (${suggestions.length} suggestion(s), consented=${consented})`,
  );
  return { cohortKey, consented, suggestions };
}
