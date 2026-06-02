import { setOnboardingState, upsertHivemate } from '../../db/repos/hivemates.js';
import { kvGet } from '../../db/repos/kv.js';

/**
 * Triggered when any user (or the bot itself) joins a channel the bot is in.
 * Only acts when a NEW Hivemate joins the configured "hive landing" channel —
 * opens a DM and posts a warm welcome to kick off onboarding.
 *
 * The landing channel id lives in `app_kv["landing_channel"]`. See the testing
 * doc for how to set it via sqlite3.
 *
 * @param {Object} params
 * @param {any} params.event
 * @param {import('@slack/web-api').WebClient} params.client
 * @param {import('@slack/logger').Logger} params.logger
 */
export const memberJoinedCallback = async ({ event, client, logger }) => {
  try {
    const userId = event.user;
    const channel = event.channel;
    const teamId = event.team || '';

    if (!userId || !channel) return;

    const botUserId = kvGet('bot_user_id');
    if (botUserId && userId === botUserId) return; // bot joined a channel itself

    const landingChannel = kvGet('landing_channel');
    if (!landingChannel || landingChannel !== channel) return;

    const dm = await client.conversations.open({ users: userId });
    const dmChannel = dm.channel?.id;
    if (!dmChannel) {
      logger.warn(`conversations.open returned no channel for ${userId}`);
      return;
    }

    upsertHivemate({ userId, teamId });
    setOnboardingState(userId, 'in_progress');

    await client.chat.postMessage({
      channel: dmChannel,
      text: "Hi! Nudger Bee 🐝 here — welcome to the Hive! I'd love to learn a little about you so I can match you with Hivemates in similar situations. To start: what language would you like us to chat in? (English is the default, but pick whatever feels comfortable.)",
    });
  } catch (e) {
    logger.error(`member_joined handler error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
