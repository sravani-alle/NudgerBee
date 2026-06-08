import { callLLM } from '../../agent/llm-caller.js';
import { kvGet } from '../../db/repos/kv.js';
import { prepareHivemateTurn, toChatMessages } from '../../services/dm-turn.js';
import { runMatching } from '../../services/matching.js';
import { feedbackBlock } from '../views/feedback_block.js';

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handles when users send messages or select a prompt in an assistant thread
 * and generate AI responses.
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
   * Messages sent to the Assistant can have a specific message subtype.
   *
   * Here we check that the message has "text" and was sent to a thread to
   * skip unexpected message subtypes.
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

    // The first example shows a message with thinking steps that has different chunks to construct and update a plan alongside text outputs.
    if (message.text === 'Wonder a few deep thoughts.') {
      await setStatus({
        status: 'thinking...',
        loading_messages: [
          'Teaching the hamsters to type faster…',
          'Untangling the internet cables…',
          'Consulting the office goldfish…',
          'Polishing up the response just for you…',
          'Convincing the AI to stop overthinking…',
        ],
      });

      await sleep(4000);

      const streamer = client.chatStream({
        channel: channel,
        recipient_team_id: teamId,
        recipient_user_id: userId,
        thread_ts: thread_ts,
        task_display_mode: 'plan',
      });

      await streamer.append({
        chunks: [
          {
            type: 'markdown_text',
            text: 'Hello.\nI have received the task. ',
          },
          {
            type: 'markdown_text',
            text: 'This task appears manageable.\nThat is good.',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'in_progress',
            details: '- Identifying the goal\n- Identifying constraints',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'pending',
          },
        ],
      });

      await sleep(4000);

      await streamer.append({
        chunks: [
          {
            type: 'plan_update',
            title: 'Adding the final pieces...',
          },
          {
            type: 'task_update',
            id: '001',
            title: 'Understanding the task...',
            status: 'complete',
            details: '\n- Pretending this was obvious',
            output: "We'll continue to ramble now",
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'in_progress',
          },
        ],
      });

      await sleep(4000);

      await streamer.stop({
        chunks: [
          {
            type: 'plan_update',
            title: 'Decided to put on a show',
          },
          {
            type: 'task_update',
            id: '002',
            title: 'Performing acrobatics...',
            status: 'complete',
            details: '- Jumped atop ropes\n- Juggled bowling pins\n- Rode a single wheel too',
          },
          {
            type: 'markdown_text',
            text: 'The crowd appears to be astounded and applauds :popcorn:',
          },
        ],
        blocks: [feedbackBlock],
      });
    } else {
      // Real DM turn. This is the primary onboarding surface: with the Assistant
      // feature enabled, Hivemate DMs land in this handler (not message.im).
      await setStatus({
        status: 'thinking...',
        loading_messages: [
          'Teaching the hamsters to type faster…',
          'Untangling the internet cables…',
          'Consulting the office goldfish…',
          'Polishing up the response just for you…',
          'Convincing the AI to stop overthinking…',
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
    }
  } catch (e) {
    logger.error(`Failed to handle a user message event: ${e}`);
    await say(`:warning: Something went wrong! (${e})`);
  }
};
