import { BASE_SYSTEM_PROMPT } from './base.js';

/**
 * The slots we collect to match a Hivemate into a peer cohort.
 * JS owns this list — never the LLM.
 */
export const REQUIRED_SLOTS = ['language', 'condition', 'role', 'goals', 'consent'];

/** @type {Record<string, string>} */
const SLOT_GUIDANCE = {
  language: 'The language they prefer to chat in (e.g. "English", "Spanish"). Ask about this first if missing.',
  condition:
    'The main health condition or program they\'re part of (e.g. "Type 2 diabetes", "postpartum recovery", "addiction recovery"). One short phrase.',
  role: 'Their life context most relevant to peer matching (e.g. "single parent", "student", "caregiver for elderly parent", "newly diagnosed"). One short phrase.',
  goals:
    'What they hope to get from the Hive in their own words (e.g. "stay accountable to my meds", "find others managing this").',
  consent:
    'Their explicit yes/no to be matched with a small peer Hivemate group. Save as "yes", "no", or "declined" if they ask to skip.',
};

/**
 * Build the system prompt for the conversational onboarding flow.
 * Wraps the base persona with task-specific instructions and the current slot state.
 *
 * @param {{ filledSlots: Record<string,string>, missingSlots: string[] }} state
 * @returns {string}
 */
export function buildOnboardingPrompt({ filledSlots, missingSlots }) {
  const filledLines = Object.keys(filledSlots).length
    ? Object.entries(filledSlots)
        .map(([s, v]) => `- ${s}: ${v}`)
        .join('\n')
    : '(none yet)';

  const missingLines = missingSlots.length
    ? missingSlots.map((s) => `- ${s}: ${SLOT_GUIDANCE[s] ?? ''}`).join('\n')
    : '(all required slots filled — thank them warmly; a Hive Keeper or peer cohort will be in touch shortly)';

  return `${BASE_SYSTEM_PROMPT}

---

ONBOARDING MODE

You are walking a brand-new Hivemate through a short profiling conversation in their DM with you. Keep the warmth and brevity from the base persona; do NOT turn this into a form.

What we already know about them (from earlier turns):
${filledLines}

Still needed:
${missingLines}

How to behave during onboarding:
- Ask about ONE missing thing per turn. Never pepper them with multiple questions at once.
- The MOMENT they share something concrete that maps to a slot, call save_hivemate_profile_slot with that slot name and their answer paraphrased to a short phrase. Do not wait for a yes/no confirmation.
- If they decline a slot or say "skip", save the slot with value "declined". For 'consent' specifically, if they say no, save "no" and gently note that peer matching can't start until they consent.
- Acknowledge each saved field briefly ("Got it, thanks!") before moving on.
- Never invent a value. Only save what they actually said.
- If they ask a clinical question or report symptoms, follow the base safety rules: refuse clinical advice and route them to their Hive Keeper or care provider. Do not save anything to a slot in that case.`;
}
