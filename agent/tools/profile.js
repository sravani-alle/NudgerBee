import { completeOnboarding } from '../../db/repos/hivemates.js';
import { getMissingSlots, listSlots, upsertSlot } from '../../db/repos/slots.js';
import { ALL_SLOTS, REQUIRED_SLOTS } from '../prompts/onboarding.js';

/**
 * Build the set of profile-related tools bound to a specific Hivemate.
 * Factory pattern so the user id is closed over and not part of the tool args
 * (otherwise the LLM could "save another user's slot").
 *
 * @param {string} slackUserId
 * @param {{ onComplete?: (profile: Record<string,string>) => unknown | Promise<unknown> }} [opts]
 *   onComplete fires after a successful `complete_onboarding`. Day 4 hangs peer
 *   matching off this hook; in Day 3 it is left unset.
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeProfileTools(slackUserId, { onComplete } = {}) {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'save_hivemate_profile_slot',
          description:
            "Save one field of the Hivemate's profile. Call this every time the Hivemate confirms a value for a missing slot. Idempotent — calling again overwrites the previous value for the same slot.",
          parameters: {
            type: 'object',
            properties: {
              slot: {
                type: 'string',
                enum: ALL_SLOTS,
                description: 'Which profile field this value belongs to.',
              },
              value: {
                type: 'string',
                description:
                  'The value the Hivemate gave, paraphrased to a short phrase (or "declined" if they explicitly opted out).',
              },
            },
            required: ['slot', 'value'],
          },
        },
      },
      execute: ({ slot, value }) => {
        if (!ALL_SLOTS.includes(slot)) {
          return { error: `Unknown slot "${slot}". Valid slots: ${ALL_SLOTS.join(', ')}` };
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
          return { error: 'value must be a non-empty string' };
        }
        // LOCAL-LLM-SHIM (remove/relax after gpt-4o-mini migration — docs/PLAN.md Day 11).
        // Guard against a weak model hallucinating a slot the Hivemate never
        // answered — it tends to echo the field name or a placeholder. Reject
        // those so we never persist a value the user didn't actually give.
        const v = value.trim();
        if (v.toLowerCase() === slot.toLowerCase() || /^(unknown|n\/a|none|tbd|placeholder)$/i.test(v)) {
          return {
            error: `That doesn't look like a real answer for "${slot}". Ask the Hivemate about it instead of saving "${v}".`,
            remaining_slots: getMissingSlots(slackUserId, REQUIRED_SLOTS),
          };
        }
        upsertSlot(slackUserId, slot, v);
        const filled = listSlots(slackUserId);
        const remaining = getMissingSlots(slackUserId, REQUIRED_SLOTS);
        return {
          description: `Saved ${slot}`,
          saved: { slot, value: v },
          filled_slots: filled,
          remaining_slots: remaining,
        };
      },
      getTaskTitle: ({ slot }) => `Saving ${slot}...`,
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'complete_onboarding',
          description:
            "Finalize the Hivemate's profile. Call this ONLY once every required slot has been saved. It validates server-side: if anything is still missing it fails and tells you what remains, so keep asking. On success the Hivemate is ready to be matched into a peer cohort.",
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      execute: async () => {
        const remaining = getMissingSlots(slackUserId, REQUIRED_SLOTS);
        if (remaining.length > 0) {
          // The slot list is the source of truth — the LLM does not get to
          // declare onboarding done while fields are still missing.
          return {
            ok: false,
            error: `Not done yet — still missing: ${remaining.join(', ')}`,
            remaining_slots: remaining,
          };
        }
        const profile = listSlots(slackUserId);
        completeOnboarding(slackUserId, profile);

        // onComplete runs matching and returns the suggested peers. Surface them
        // in the tool result so the model can present them and offer an intro.
        // Best-effort: a matching failure must not make completion look failed.
        /** @type {any} */
        let matching = null;
        if (onComplete) {
          try {
            matching = await onComplete(profile);
          } catch (_e) {
            matching = null;
          }
        }
        return {
          ok: true,
          description: 'Onboarding complete',
          profile,
          suggestions: matching?.suggestions ?? [],
        };
      },
      getTaskTitle: () => 'Finalizing your Hive profile...',
    },
  ];
}
