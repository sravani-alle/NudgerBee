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
        // Hand the model a name-first shape and DROP the internal user ids —
        // otherwise it tends to echo a streak number without the person's name.
        // With `name` as the only identifier, every line has to name someone.
        return {
          description: `Hive overview: ${stats.total} Hivemates, ${stats.dormant.length} dormant`,
          total_hivemates: stats.total,
          active: stats.activeCount,
          dormant: stats.dormant.map((d) => ({ name: d.name, days_quiet: d.daysQuiet })),
          top_streaks: stats.topStreaks.map((t) => ({ name: t.name, honey_streak_days: t.streak })),
        };
      },
      getTaskTitle: () => 'Pulling your hive overview 🐝…',
    },
  ];
}
