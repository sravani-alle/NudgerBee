import { isKeeper, statsForKeeper } from '../../services/keepers.js';

/**
 * Build the keeper-stats tool — but ONLY for users who are actually a Hive
 * Keeper. Returns an empty array for everyone else, so a regular Hivemate never
 * even sees `hive_stats` as an option (the overview is scoped, not secret, but
 * there's no reason to expose it). Gating is by the `keeper:{cohort_key}` /
 * `default_keeper` conventions in `app_kv` (see services/keepers.js).
 *
 * @param {string} slackUserId
 * @returns {import('../llm-caller.js').BeeTool[]}
 */
export function makeKeeperTools(slackUserId) {
  if (!isKeeper(slackUserId)) return [];

  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'hive_stats',
          description:
            "Give this Hive Keeper an overview of their hive: how many Hivemates they keep, how many are active vs. dormant (quiet past the threshold), who has gone quiet and for how long, and the top Honey streaks. Use when a keeper asks how their hive/people are doing, who's gone quiet, or for a summary. Refer to each Hivemate by the `name` field in the result. Do NOT include any health details — only cohort and activity.",
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      execute: () => {
        const stats = statsForKeeper(slackUserId);
        if (!stats.isKeeper) {
          return { error: "You don't keep any Hivemates yet." };
        }
        // Hand the model PRE-FORMATTED lines with the name baked into each
        // string. Structured {name, streak} objects let the model echo the
        // number and drop the name; a whole sentence per Hivemate can't be
        // half-rendered. (Fake seeded ids are omitted entirely — unused here.)
        const result = {
          description: `Hive overview: ${stats.total} Hivemates, ${stats.dormant.length} dormant`,
          total_hivemates: stats.total,
          active: stats.activeCount,
          dormant: stats.dormant.map((d) => `${d.name} — quiet for ${d.daysQuiet} day${d.daysQuiet === 1 ? '' : 's'}`),
          top_streaks: stats.topStreaks.map((t) => `${t.name} — ${t.streak}-day Honey streak 🍯`),
        };
        // TEMP DIAGNOSTIC — remove after we confirm the live tool output.
        console.log('🔎 hive_stats returning →', JSON.stringify(result));
        return result;
      },
      getTaskTitle: () => 'Pulling your hive overview 🐝…',
    },
  ];
}
