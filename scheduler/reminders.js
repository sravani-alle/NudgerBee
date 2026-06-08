import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { generateMessage } from '../agent/generate.js';
import { buildNudgePrompt, NUDGE_TEMPLATES } from '../agent/prompts/nudge.js';
import { getChannelByCohort } from '../db/repos/channels.js';
import { getHivemate, listActiveHivemates } from '../db/repos/hivemates.js';
import { kvGet } from '../db/repos/kv.js';
import { countNudges, logNudge } from '../db/repos/nudges.js';

/**
 * Lazily-created Slack client for standalone runs (CLI / cron). When the app is
 * running it passes its own `client` in; a `node -e "... runOnce(id)"` call has
 * none, so we build one from the bot token (dotenv is loaded above).
 * @type {WebClient | undefined}
 */
let fallbackClient;

/** @param {WebClient} [provided] */
function getClient(provided) {
  if (provided) return provided;
  if (!fallbackClient) fallbackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  return fallbackClient;
}

/**
 * Decide where a Hivemate's nudge should land. `nudge_target` in app_kv is
 * 'dm' (default — so the check-in reply flows to the DM where record_checkin
 * lives) or 'channel' (post into the peer cohort channel).
 *
 * @param {WebClient} client
 * @param {import('../db/repos/hivemates.js').HivemateRow} hivemate
 * @returns {Promise<string | null>} channel id to post into
 */
async function resolveTarget(client, hivemate) {
  const mode = kvGet('nudge_target') || 'dm';
  if (mode === 'channel' && hivemate.cohort_key) {
    const ch = getChannelByCohort(hivemate.cohort_key);
    if (ch) return ch.slack_channel_id;
  }
  const dm = await client.conversations.open({ users: hivemate.slack_user_id });
  return dm.channel?.id ?? null;
}

/**
 * Generate and send one check-in nudge to a Hivemate. Round-robins the template
 * via the count of prior reminders, voices it in their language with their
 * streak in mind, posts it, and logs it.
 *
 * @param {string} userId
 * @param {{ client?: WebClient }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, templateId?: number, channelId?: string|null, message?: string }>}
 */
export async function runOnce(userId, { client: provided } = {}) {
  const hivemate = getHivemate(userId);
  if (!hivemate) return { ok: false, reason: 'no such hivemate' };
  if (hivemate.onboarding_state !== 'complete') return { ok: false, reason: 'not onboarded' };

  const client = getClient(provided);

  // Round-robin: pick the next template after however many reminders they've had.
  const templateId = countNudges(userId, 'reminder') % NUDGE_TEMPLATES.length;
  const template = NUDGE_TEMPLATES[templateId];

  /** @type {Record<string, string>} */
  let profile = {};
  try {
    profile = JSON.parse(hivemate.profile_json || '{}');
  } catch (_e) {
    profile = {};
  }

  const systemPrompt = buildNudgePrompt({
    template,
    profile,
    language: hivemate.language,
    streak: hivemate.honey_streak,
  });
  const message = (await generateMessage([{ role: 'user', content: 'Write the nudge now.' }], { systemPrompt })).trim();
  if (!message) return { ok: false, reason: 'empty generation' };

  const channelId = await resolveTarget(client, hivemate);
  if (!channelId) return { ok: false, reason: 'no target channel' };

  await client.chat.postMessage({ channel: channelId, text: message });
  logNudge({ userId, channelId, kind: 'reminder', templateId, message });
  return { ok: true, templateId, channelId, message };
}

/**
 * Send a nudge to every Hivemate who has finished onboarding. Used by the cron
 * job. Per-user failures are captured, not thrown, so one bad send can't stop
 * the rest.
 *
 * @param {{ client?: WebClient }} [opts]
 */
export async function runForAll(opts = {}) {
  const users = listActiveHivemates();
  const results = [];
  for (const u of users) {
    try {
      results.push(await runOnce(u.slack_user_id, opts));
    } catch (e) {
      results.push({ ok: false, userId: u.slack_user_id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
