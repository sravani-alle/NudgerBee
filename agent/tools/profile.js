import { getMissingSlots, listSlots, upsertSlot } from '../../db/repos/slots.js';
import { REQUIRED_SLOTS } from '../prompts/onboarding.js';

/**
 * Build the set of profile-related tools bound to a specific Hivemate.
 * Factory pattern so the user id is closed over and not part of the tool args
 * (otherwise the LLM could "save another user's slot").
 *
 * @param {string} slackUserId
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeProfileTools(slackUserId) {
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
                enum: REQUIRED_SLOTS,
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
        if (!REQUIRED_SLOTS.includes(slot)) {
          return { error: `Unknown slot "${slot}". Valid slots: ${REQUIRED_SLOTS.join(', ')}` };
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
          return { error: 'value must be a non-empty string' };
        }
        upsertSlot(slackUserId, slot, value.trim());
        const filled = listSlots(slackUserId);
        const remaining = getMissingSlots(slackUserId, REQUIRED_SLOTS);
        return {
          description: `Saved ${slot}`,
          saved: { slot, value: value.trim() },
          filled_slots: filled,
          remaining_slots: remaining,
        };
      },
      getTaskTitle: ({ slot }) => `Saving ${slot}...`,
    },
  ];
}
