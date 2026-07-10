import { getHivemate } from '../../db/repos/hivemates.js';
import { logNudge } from '../../db/repos/nudges.js';
import { keeperFor } from '../../services/keepers.js';

/**
 * Build the escalation tool bound to a specific Hivemate. This is the safety
 * backstop: whenever the bee must hand a clinical/urgent concern to a human, it
 * calls this to (1) DM the Hivemate's Hive Keeper and (2) write a visible
 * `nudge_log` row (`kind:'escalation'`) — so the safety story shows up in the
 * data, not just as a refusal string. The bee still replies to the Hivemate
 * with warmth (and, if urgent, points them to emergency services) itself; this
 * tool is the routing side, not the reply.
 *
 * Factory pattern so the Hivemate id is closed over (can't be spoofed via args)
 * and the Slack client is available to DM the keeper.
 *
 * @param {string} slackUserId
 * @param {{ client?: import('@slack/web-api').WebClient }} [opts]
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeSafetyTools(slackUserId, { client } = {}) {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'escalate_to_hive_keeper',
          description:
            'Route a Hivemate to a human when they report symptoms, a possible emergency, a medical/clinical question, or anything you must not answer yourself. Notifies their Hive Keeper and records the escalation. ALWAYS call this when you decline something clinical — do not just refuse silently. You still reply to the Hivemate warmly yourself; for anything urgent also tell them to contact their care provider or emergency services.',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description:
                  'A brief, non-clinical summary of why you\'re escalating, in your own words (e.g. "reported chest pain", "asked about changing their medication dose"). Do NOT give any medical interpretation.',
              },
              urgency: {
                type: 'string',
                enum: ['urgent', 'routine'],
                description:
                  "'urgent' for anything potentially dangerous or time-sensitive (possible emergency, severe symptoms); 'routine' for a non-urgent clinical question a keeper should follow up on.",
              },
            },
            required: ['reason', 'urgency'],
          },
        },
      },
      execute: async ({ reason, urgency }) => {
        const level = urgency === 'urgent' ? 'urgent' : 'routine';
        const summary = (reason || '').toString().trim() || 'a concern that needs a human';

        // Always record the escalation, even if we can't reach a keeper — the
        // row IS the safety trail (Day 9 verification checks kind='escalation').
        logNudge({
          userId: slackUserId,
          kind: 'escalation',
          message: `[${level}] ${summary}`,
        });

        const hivemate = getHivemate(slackUserId);
        const keeperId = keeperFor(hivemate?.cohort_key);

        if (!keeperId || !client) {
          return {
            description: 'Escalation recorded (no Hive Keeper reachable)',
            escalated: true,
            notified_keeper: false,
            urgency: level,
            note: 'No Hive Keeper is configured for this cohort. Make sure the Hivemate is told to contact their care provider or emergency services if this is urgent.',
          };
        }

        try {
          const dm = await client.conversations.open({ users: keeperId });
          const dmChannel = dm.channel?.id;
          if (!dmChannel) throw new Error('could not open keeper DM');
          const flag = level === 'urgent' ? '🚨 *URGENT*' : '🔔';
          await client.chat.postMessage({
            channel: dmChannel,
            text: `${flag} A Hivemate may need a human: <@${slackUserId}> — ${summary}.\nNudger Bee has stepped back (it doesn't give clinical advice). Please reach out${level === 'urgent' ? ' as soon as you can' : ''}.`,
          });
        } catch (e) {
          return {
            description: 'Escalation recorded (keeper DM failed)',
            escalated: true,
            notified_keeper: false,
            urgency: level,
            error: e instanceof Error ? e.message : String(e),
          };
        }

        return {
          description: `Escalated to a Hive Keeper (${level})`,
          escalated: true,
          notified_keeper: true,
          urgency: level,
        };
      },
      getTaskTitle: ({ urgency }) =>
        urgency === 'urgent' ? 'Alerting a Hive Keeper — urgent 🚨…' : 'Looping in a Hive Keeper 🔔…',
    },
  ];
}
