import { getHivemate } from '../../db/repos/hivemates.js';

/**
 * The `assistant_thread_started` event is sent when a user opens the Assistant container.
 * This can happen via DM with the app or as a side-container within a channel.
 *
 * @param {Object} params
 * @param {import("@slack/types").AssistantThreadStartedEvent} params.event - The assistant thread started event.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.saveThreadContext - Function to save thread context.
 *
 * @see {@link https://docs.slack.dev/reference/events/assistant_thread_started}
 */
export const assistantThreadStarted = async ({ event, logger, say, saveThreadContext }) => {
  const { user_id: userId } = event.assistant_thread;

  try {
    /**
     * The opening message also seeds the thread's context metadata behind the
     * scenes (via `say`), so we keep it whether onboarding is done or not.
     *
     * If the Hivemate hasn't finished onboarding, this is where the profiling
     * conversation begins — we ask the first slot (language) warmly. The actual
     * slot-filling happens turn-by-turn in `message.js` via `prepareHivemateTurn`.
     */
    const hivemate = userId ? getHivemate(userId) : null;
    if (hivemate?.onboarding_state === 'complete') {
      await say('Welcome back to the Hive! 🐝 How can I help?');
    } else {
      await say(
        "Hi! Nudger Bee 🐝 here — welcome to the Hive! I'd love to learn a little about you so I can match you with Hivemates in similar situations. To start: what language would you like us to chat in? (English is the default — pick whatever feels most comfortable.)",
      );
    }

    await saveThreadContext();
  } catch (e) {
    logger.error(e);
  }
};
