import { callLLM } from '../../agent/llm-caller.js';
import { kvGet } from '../../db/repos/kv.js';
import { prepareHivemateTurn, toChatMessages } from '../../services/dm-turn.js';
import { runMatching } from '../../services/matching.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Handles plain direct messages to the bot (`message.im` events).
 *
 * NOTE: with the Assistant feature enabled, Hivemate DMs are routed through the
 * Assistant container and handled in `listeners/assistant/message.js` — that is
 * the primary onboarding surface. This handler is the fallback for any DM that
 * arrives as a plain `message.im` (no assistant thread) and shares the same
 * onboarding logic via `prepareHivemateTurn`.
 *
 * @param {Object} params
 * @param {any} params.event
 * @param {import('@slack/web-api').WebClient} params.client
 * @param {import('@slack/logger').Logger} params.logger
 */
export const messageImCallback = async ({ event, client, logger }) => {
  try {
    if (event.channel_type !== 'im') return;
    // Skip non-user messages: edits, deletes, joins, file shares, bot replies
    if (event.subtype || event.bot_id || !event.user) return;
    // The Assistant container intercepts its own thread messages — don't double-handle.
    if (event.assistant_thread) return;

    const botUserId = kvGet('bot_user_id');
    if (botUserId && event.user === botUserId) return;

    const userId = event.user;
    const channel = event.channel;
    const teamId = event.team || event.team_id || kvGet('team_id') || '';
    if (!teamId) {
      logger.warn(`message.im without team id for user ${userId}; skipping`);
      return;
    }

    // Load recent DM history so the LLM has context across turns.
    /** @type {any[]} */
    let history = [];
    try {
      const resp = await client.conversations.history({ channel, limit: 12, inclusive: true });
      history = (resp.messages ?? []).slice().reverse();
    } catch (e) {
      logger.warn(`conversations.history failed (${e}); using current message only`);
      history = [{ user: userId, text: event.text || '', ts: event.ts }];
    }

    const messages = toChatMessages(history, { botUserId });
    const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);

    // Ensure the row exists, advance state, detect language, and pick the
    // onboarding prompt + tools — shared with the Assistant surface.
    const { systemPrompt, tools } = prepareHivemateTurn({
      userId,
      teamId,
      recentUserTexts: userTexts,
      client,
      onComplete: () => runMatching({ client, userId, teamId, logger }),
    });

    const streamer = client.chatStream({
      channel,
      recipient_team_id: teamId,
      recipient_user_id: userId,
      thread_ts: event.thread_ts || event.ts,
    });

    await callLLM(streamer, messages, systemPrompt ? { systemPrompt, tools } : { tools });
    await streamer.stop({ blocks: [feedbackBlock] });
  } catch (e) {
    logger.error(`message.im handler error: ${e instanceof Error ? e.message : String(e)}`);
  }
};
