import { getHivemate } from '../../db/repos/hivemates.js';
import { addIntro, hasIntro } from '../../db/repos/intros.js';
import { listSlots } from '../../db/repos/slots.js';
import { blurbFor, hasConsented } from '../../services/peers.js';

/**
 * Build the warm-intro tool bound to a specific Hivemate. Exposed once
 * onboarding is complete so a Hivemate who has been shown peer suggestions can
 * ask the bee to connect them with one.
 *
 * Crucially, the bee is a BROKER, not a participant: it sends the *peer* a
 * heads-up DM (so the peer isn't cold-messaged) and then tells the requester
 * they can DM the peer directly. The two talk in their own private 1:1 — the
 * bee never joins that conversation.
 *
 * @param {string} slackUserId - the requester (closed over; not a tool arg)
 * @param {{ client?: import('@slack/web-api').WebClient }} [opts]
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeIntroTools(slackUserId, { client } = {}) {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'request_intro',
          description:
            'Connect this Hivemate with one suggested peer they chose. Pass the peer_user_id from the suggestions (the id inside a <@...> mention). The bee privately gives the peer a heads-up; it does NOT join their conversation. Only use this when the Hivemate clearly wants to be introduced to a specific peer.',
          parameters: {
            type: 'object',
            properties: {
              peer_user_id: {
                type: 'string',
                description: 'The Slack user id of the peer to introduce, e.g. "U07ABC123".',
              },
            },
            required: ['peer_user_id'],
          },
        },
      },
      execute: async ({ peer_user_id }) => {
        if (!client) return { error: 'Introductions are unavailable right now.' };
        const peerId = (peer_user_id || '').trim();
        if (!peerId || peerId === slackUserId) {
          return { error: 'That is not a valid peer to introduce.' };
        }

        // Server-side validation — never trust an id the model produced. The
        // peer must be a consenting, onboarded member of the SAME cohort, and
        // the requester must themselves have consented to matching.
        const requester = getHivemate(slackUserId);
        const peer = getHivemate(peerId);
        const sameCohort = requester?.cohort_key && peer?.cohort_key && requester.cohort_key === peer.cohort_key;
        const eligible =
          peer &&
          peer.onboarding_state === 'complete' &&
          sameCohort &&
          hasConsented(listSlots(peerId).consent) &&
          hasConsented(listSlots(slackUserId).consent);
        if (!eligible) {
          return { error: "That person isn't an available match to introduce right now." };
        }

        if (hasIntro(slackUserId, peerId)) {
          return {
            ok: true,
            already: true,
            peer_user_id: peerId,
            description: 'Already introduced',
            note: `You've already been connected with <@${peerId}> — feel free to DM them anytime.`,
          };
        }

        // Heads-up to the PEER (both sides consented, so sharing name + a
        // non-clinical blurb is within consent). No health details.
        const blurb = blurbFor(listSlots(slackUserId));
        try {
          const dm = await client.conversations.open({ users: peerId });
          const dmChannel = dm.channel?.id;
          if (!dmChannel) return { error: 'Could not reach that peer to introduce you.' };
          await client.chat.postMessage({
            channel: dmChannel,
            text: `👋 Hi! A fellow Hivemate, <@${slackUserId}>${blurb ? ` (${blurb})` : ''}, is in a similar situation and would love to connect. They may reach out soon — no pressure at all! 🐝`,
          });
        } catch (e) {
          return { error: `Could not send the introduction: ${e instanceof Error ? e.message : String(e)}` };
        }

        addIntro(slackUserId, peerId, requester?.cohort_key ?? null);
        return {
          ok: true,
          peer_user_id: peerId,
          description: 'Introduced 🐝',
          note: `Heads-up sent to <@${peerId}>. Tell the Hivemate they can DM <@${peerId}> directly whenever they're ready.`,
        };
      },
      getTaskTitle: () => 'Making a warm introduction 🐝...',
    },
  ];
}
