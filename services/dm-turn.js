import { getMcpTools } from '../agent/mcp-client.js';
import { buildOnboardingPrompt, REQUIRED_SLOTS } from '../agent/prompts/onboarding.js';
import { makeCheckinTools } from '../agent/tools/checkin.js';
import { makeIntroTools } from '../agent/tools/intro.js';
import { makeKeeperTools } from '../agent/tools/keeper.js';
import { makeProfileTools } from '../agent/tools/profile.js';
import { makeSafetyTools } from '../agent/tools/safety.js';
import { getHivemate, setLanguage, setOnboardingState, touchActive, upsertHivemate } from '../db/repos/hivemates.js';
import { getMissingSlots, listSlots } from '../db/repos/slots.js';
import { languageNameToCode, maybeUpdateLanguage } from './language.js';

/**
 * Prepare one DM turn for a Hivemate, independent of which Slack surface the
 * message arrived on. DMs to an Assistant-enabled app are routed through the
 * Assistant container (`listeners/assistant/message.js`); a plain `message.im`
 * is the fallback. Both call this so onboarding behaves identically either way.
 *
 * Side effects: ensures the hivemates row exists, advances 'new' → 'in_progress',
 * records activity, and persists the detected language (pre-LLM, deterministic).
 *
 * @param {{ userId: string, teamId: string, recentUserTexts: string[], onComplete?: (profile: Record<string,string>) => unknown | Promise<unknown>, client?: import('@slack/web-api').WebClient }} args
 *   onComplete fires when `complete_onboarding` succeeds — the caller passes a
 *   matching trigger (it has the Slack client); see the DM handlers. `client` is
 *   threaded so the post-onboarding intro tool can DM a peer.
 * @returns {{ systemPrompt: string | undefined, tools: import('../agent/llm-caller.js').BeeTool[], isComplete: boolean }}
 *   systemPrompt is undefined when onboarding is complete (caller falls back to
 *   the base persona).
 */
export function prepareHivemateTurn({ userId, teamId, recentUserTexts, onComplete, client }) {
  upsertHivemate({ userId, teamId });

  const existing = getHivemate(userId);
  if (existing?.onboarding_state === 'new') {
    setOnboardingState(userId, 'in_progress');
  }
  touchActive(userId);

  const filledSlots = listSlots(userId);
  // Language priority: the stated `language` slot is authoritative; only fall
  // back to franc over recent turns before a preference has been captured.
  const stated = languageNameToCode(filledSlots.language);
  if (stated) {
    setLanguage(userId, stated);
  } else {
    maybeUpdateLanguage(userId, recentUserTexts);
  }

  // Safety escalation is available on EVERY turn — a clinical concern can surface
  // mid-onboarding just as easily as after it (keeper tools are keeper-gated).
  const safetyTools = makeSafetyTools(userId, { client });

  const hivemate = getHivemate(userId);
  if (hivemate?.onboarding_state === 'complete') {
    // Onboarded Hivemates chat with the base persona, plus the check-in tool
    // ("took my meds 🍯" → streak), the intro tool (connect me to a peer), the
    // MCP program-server tools (upcoming sessions / schedule a follow-up),
    // escalation, and — for Hive Keepers only — the hive overview.
    return {
      systemPrompt: undefined,
      tools: [
        ...makeCheckinTools(userId),
        ...makeIntroTools(userId, { client }),
        ...getMcpTools(),
        ...safetyTools,
        ...makeKeeperTools(userId),
      ],
      isComplete: true,
    };
  }

  const missingSlots = getMissingSlots(userId, REQUIRED_SLOTS);
  return {
    systemPrompt: buildOnboardingPrompt({ filledSlots, missingSlots }),
    tools: [...makeProfileTools(userId, { onComplete }), ...safetyTools],
    isComplete: false,
  };
}

/**
 * Map Slack message history (from conversations.history / .replies) into
 * Chat Completions messages, classifying the bot's own messages as 'assistant'.
 *
 * @param {any[]} slackMessages - newest-first or oldest-first; caller orders them
 * @param {{ botUserId: string | null }} ctx
 * @returns {{ role: 'user'|'assistant', content: string }[]}
 */
export function toChatMessages(slackMessages, { botUserId }) {
  return slackMessages
    .filter((m) => !m.subtype)
    .map((m) => ({
      role: /** @type {'user'|'assistant'} */ (m.bot_id || (botUserId && m.user === botUserId) ? 'assistant' : 'user'),
      content: m.text || '',
    }))
    .filter((m) => m.content.length > 0);
}
