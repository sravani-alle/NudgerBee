import { languageName } from '../../services/language.js';
import { BASE_SYSTEM_PROMPT } from './base.js';

/**
 * Structural skeletons for daily check-in nudges. JS round-robins through these
 * (via `nudge_log.template_id`) so the *shape* of the nudge varies every day;
 * the LLM then voices each one warmly in the Hivemate's language. This keeps
 * nudges diverse and on-brand even on a flaky local model, and costs nothing.
 *
 * Each entry describes the ANGLE of the nudge, not literal text to send.
 */
export const NUDGE_TEMPLATES = [
  'A warm good-morning check-in: ask how they are feeling today.',
  'Gently invite them to log their daily check-in (their Honey 🍯).',
  'Celebrate showing up and ask them to name one small win from yesterday.',
  'A light, encouraging nudge tying back to the goal they shared at onboarding.',
  'Ask an open, caring question about how things are going this week.',
  'Remind them their Hivemates are rooting for them; invite a quick hello.',
  'A playful, bee-themed nudge to keep their streak buzzing.',
  'Offer a tiny, doable next step and ask if they are up for it today.',
  'Acknowledge that some days are hard and invite them to check in anyway.',
  'A short cheer focused on consistency over perfection.',
];

/**
 * Build the system prompt for generating one nudge.
 *
 * @param {{
 *   template: string,
 *   profile?: Record<string, string>,
 *   language?: string,        // ISO 639-3 (e.g. 'eng', 'spa')
 *   streak?: number,          // current Honey streak in days
 * }} args
 * @returns {string}
 */
export function buildNudgePrompt({ template, profile = {}, language = 'eng', streak = 0 }) {
  const profileLines =
    Object.keys(profile).length > 0
      ? Object.entries(profile)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join('\n')
      : '(no profile details)';

  const streakLine =
    streak > 0
      ? `They currently have a ${streak}-day Honey streak 🍯 — you may acknowledge it if it fits naturally.`
      : 'They do not have an active streak right now — gently encourage a fresh start without guilt-tripping.';

  return `${BASE_SYSTEM_PROMPT}

---

NUDGE MODE

You are composing ONE short check-in nudge to send to a Hivemate. Output ONLY the message itself — no preamble, no quotes, no explanation.

Today's nudge angle (follow this shape, in your own words):
${template}

About this Hivemate (for personalization — do NOT repeat their health details verbatim or in a way that would feel clinical):
${profileLines}

${streakLine}

Rules for this nudge:
- Write in ${languageName(language)}. Use only that one language.
- Keep it to 1–2 short sentences. Warm, specific, a little playful. Skimmable in Slack.
- Never give medical or clinical advice, interpret symptoms, or mention medications/dosing. You are a coordinator and cheerleader.
- Vary your wording; never sound like a template. No greetings like "Dear" — this is Slack.`;
}
