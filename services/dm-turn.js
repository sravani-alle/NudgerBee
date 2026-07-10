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

  // Tools available on EVERY turn, ADDITIVELY, regardless of onboarding state:
  //  - escalation (a clinical concern can surface any time),
  //  - the MCP program-server tools (upcoming sessions / schedule a follow-up) —
  //    a keeper or a mid-onboarding Hivemate can ask "when's the next session?",
  //  - and, if this user is a Hive Keeper, the hive overview (keeper-gated, so []
  //    for regular Hivemates).
  // Additive (not a separate keeper "mode") so one account can be BOTH a Hivemate
  // (onboard, check in) AND a Keeper (hive_stats), which a solo demo needs.
  const alwaysTools = [...getMcpTools(), ...makeSafetyTools(userId, { client }), ...makeKeeperTools(userId)];

  const hivemate = getHivemate(userId);
  if (hivemate?.onboarding_state === 'complete') {
    // Onboarded Hivemates also get the check-in tool ("took my meds 🍯" → streak)
    // and the intro tool (connect me to a peer).
    return {
      systemPrompt: undefined,
      tools: [...makeCheckinTools(userId), ...makeIntroTools(userId, { client }), ...alwaysTools],
      isComplete: true,
    };
  }

  const missingSlots = getMissingSlots(userId, REQUIRED_SLOTS);
  return {
    systemPrompt: buildOnboardingPrompt({ filledSlots, missingSlots }),
    tools: [...makeProfileTools(userId, { onComplete }), ...alwaysTools],
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
