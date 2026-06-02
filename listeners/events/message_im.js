import { callLLM } from '../../agent/llm-caller.js';
import { buildOnboardingPrompt, REQUIRED_SLOTS } from '../../agent/prompts/onboarding.js';
import { makeProfileTools } from '../../agent/tools/profile.js';
import { getHivemate, setOnboardingState, touchActive, upsertHivemate } from '../../db/repos/hivemates.js';
import { kvGet } from '../../db/repos/kv.js';
import { getMissingSlots, listSlots } from '../../db/repos/slots.js';
import { feedbackBlock } from '../views/feedback_block.js';

/**
 * Handles direct messages to the bot (`message.im` events).
 * Routes the Hivemate through onboarding while `onboarding_state !== 'complete'`.
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
    const teamId = event.team || event.team_id || '';
    if (!teamId) {
      logger.warn(`message.im without team id for user ${userId}; skipping`);
      return;
    }

    upsertHivemate({ userId, teamId });
    const hivemate = getHivemate(userId);
    if (!hivemate) {
      logger.error(`upsertHivemate produced no row for ${userId}`);
      return;
    }
    if (hivemate.onboarding_state === 'new') {
      setOnboardingState(userId, 'in_progress');
    }
    touchActive(userId);

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

    const messages = history
      .filter((m) => !m.subtype)
      .map((m) => ({
        role: m.bot_id || (botUserId && m.user === botUserId) ? 'assistant' : 'user',
        content: m.text || '',
      }))
      .filter((m) => m.content.length > 0);

    // Onboarding mode while incomplete; otherwise use the base persona with no tools.
    const isComplete = hivemate.onboarding_state === 'complete';
    let systemPrompt;
    /** @type {import('../../agent/llm-caller.js').BeeTool[]} */
    let tools;
    if (isComplete) {
      systemPrompt = undefined;
      tools = [];
    } else {
      const filledSlots = listSlots(userId);
      const missingSlots = getMissingSlots(userId, REQUIRED_SLOTS);
      systemPrompt = buildOnboardingPrompt({ filledSlots, missingSlots });
      tools = makeProfileTools(userId);
    }

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
