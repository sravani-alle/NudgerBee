import { callLLM } from '../../agent/llm-caller.js';
import { kvGet } from '../../db/repos/kv.js';
import { prepareHivemateTurn, toChatMessages } from '../../services/dm-turn.js';
import { runMatching } from '../../services/matching.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Handles when a Hivemate sends a message in an assistant thread and generates
 * the bee's response. With the Assistant feature enabled, Hivemate DMs land in
 * this handler (not `message.im`), so this is the primary onboarding + chat
 * surface: it pulls the thread so far, prepares the mode-appropriate prompt and
 * tools (onboarding vs. onboarded), and streams the bee's reply.
 *
 * @param {Object} params
 * @param {import("@slack/web-api").WebClient} params.client - Slack web client.
 * @param {import("@slack/bolt").Context} params.context - Event context.
 * @param {import("@slack/logger").Logger} params.logger - Logger instance.
 * @param {import("@slack/types").MessageEvent} params.message - The incoming message.
 * @param {import("@slack/bolt").SayFn} params.say - Function to send messages.
 * @param {Function} params.setStatus - Function to set assistant status.
 *
 * @see {@link https://docs.slack.dev/reference/events/message}
 */
export const message = async ({ client, context, logger, message, say, setStatus }) => {
  /**
   * Messages sent to the Assistant can have a specific message subtype. Require
   * "text" sent to a thread and skip unexpected subtypes.
   *
   * @see {@link https://docs.slack.dev/reference/events/message#subtypes}
   */
  if (!('text' in message) || !('thread_ts' in message) || !message.text || !message.thread_ts) {
    return;
  }

  try {
    const { channel, thread_ts } = message;
    const { userId, teamId } = context;
    if (!channel || !userId) return;

    await setStatus({
      status: 'thinking...',
      loading_messages: [
        'Buzzing over to the Hive…',
        'Checking the honey stores…',
        'Gathering the latest from the Hive…',
        'Finding just the right words…',
      ],
    });

    const effectiveTeamId = teamId || kvGet('team_id') || '';
    if (!effectiveTeamId) {
      logger.warn('assistant message without a resolvable team id; skipping');
      return;
    }
    const botUserId = kvGet('bot_user_id');

    // Pull the assistant thread so the LLM has the conversation so far.
    /** @type {any[]} */
    let history = [];
    try {
      const resp = await client.conversations.replies({ channel, ts: thread_ts, limit: 20 });
      history = resp.messages ?? [];
    } catch (e) {
      logger.warn(`conversations.replies failed (${e}); using current message only`);
      history = [{ user: userId, text: message.text, ts: thread_ts }];
    }

    const messages = toChatMessages(history, { botUserId });
    const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const { systemPrompt, tools } = prepareHivemateTurn({
      userId,
      teamId: effectiveTeamId,
      recentUserTexts: userTexts,
      client,
      onComplete: () => runMatching({ client, userId, teamId: effectiveTeamId, logger }),
    });

    const streamer = client.chatStream({
      channel: channel,
      recipient_team_id: effectiveTeamId,
      recipient_user_id: userId,
      thread_ts: thread_ts,
      task_display_mode: 'timeline',
    });

    await callLLM(streamer, messages, systemPrompt ? { systemPrompt, tools } : { tools });
    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error(`Failed to handle a user message event: ${e}`);
    await say(`:warning: Something went wrong! (${e})`);
  }
};
