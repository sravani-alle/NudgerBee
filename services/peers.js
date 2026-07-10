import { displayName, listByCohort } from '../db/repos/hivemates.js';
import { listSlots } from '../db/repos/slots.js';

/**
 * Does a saved `consent` slot value mean "yes, match me"? The model saves a
 * short paraphrase ("yes", "sí", "sure", or "no"/"declined"). We treat anything
 * clearly negative as no and a small positive set as yes; ambiguous → no
 * (privacy-safe default: never suggest someone unless they clearly opted in).
 *
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function hasConsented(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/^(n|no|decline|declined|not|never)\b/.test(v)) return false;
  return /\b(yes|yeah|yep|sure|ok|okay|agree|agreed|happy|claro|s[ií])\b/.test(v) || /^y/.test(v);
}

/**
 * Build a short, NON-clinical blurb for a peer from their role/goals slots.
 * Never includes their condition. Kept brief for a one-line suggestion.
 *
 * @param {Record<string,string>} slots
 * @returns {string}
 */
export function blurbFor(slots) {
  const role = (slots.role || '').trim();
  const goal = (slots.goals || '').trim();
  if (role && goal) return `also a ${role}, working on ${goal}`;
  if (role) return `also a ${role}`;
  if (goal) return `also working on ${goal}`;
  return 'in a similar situation';
}

/**
 * Suggest peers for a Hivemate: completed, consenting members of the same
 * cohort, excluding the requester, ranked by most-recently-active, capped.
 *
 * @param {string} cohortKey
 * @param {string} excludeUserId
 * @param {number} [limit]
 * @returns {{ user_id: string, name: string, blurb: string }[]}
 */
export function suggestPeers(cohortKey, excludeUserId, limit = 3) {
  if (!cohortKey) return [];
  return listByCohort(cohortKey)
    .filter((p) => p.slack_user_id !== excludeUserId)
    .filter((p) => hasConsented(listSlots(p.slack_user_id).consent))
    .sort((a, b) => (b.last_active_at ?? 0) - (a.last_active_at ?? 0))
    .slice(0, limit)
    .map((p) => ({ user_id: p.slack_user_id, name: displayName(p), blurb: blurbFor(listSlots(p.slack_user_id)) }));
}
