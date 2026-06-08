import { recordCheckin } from '../../db/repos/checkins.js';

const CHECKIN_KINDS = ['meds', 'food', 'mood', 'text'];

/**
 * Build the check-in tool bound to a specific Hivemate. Exposed once onboarding
 * is complete so a Hivemate saying "took my meds 🍯" or "logged my walk" gets it
 * recorded and their Honey streak updated — the tool returns the new streak so
 * the bee can voice a fresh, streak-aware cheer.
 *
 * Factory pattern (like profile tools) so the user id is closed over and can't
 * be spoofed via tool args.
 *
 * @param {string} slackUserId
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeCheckinTools(slackUserId) {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'record_checkin',
          description:
            'Record a Hivemate check-in when they report doing their daily thing — taking meds, eating/logging food, a mood, or a general note. Do NOT call this for questions, small talk, or anything clinical.',
          parameters: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: CHECKIN_KINDS,
                description: 'The kind of check-in: meds, food, mood, or text (a general note).',
              },
              content: {
                type: 'string',
                description: "A short note in the Hivemate's own words about what they checked in.",
              },
            },
            required: ['kind'],
          },
        },
      },
      execute: ({ kind, content }) => {
        const k = CHECKIN_KINDS.includes(kind) ? kind : 'text';
        const { honey_streak } = recordCheckin(slackUserId, k, content ?? null);
        return {
          description: `Logged ${k} check-in 🍯`,
          kind: k,
          honey_streak,
        };
      },
      getTaskTitle: () => 'Logging your check-in 🍯...',
    },
  ];
}
