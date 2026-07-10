/**
 * scripts/seed-demo.js — demo/test data harness.
 *
 * WHY THIS EXISTS: a Slack sandbox has no real members and no elapsed time, so
 * the silence detector, Honey streaks, and the keeper's hive overview can't be
 * seen the way a real user would experience them. This script fabricates that
 * world as database state: four Hivemates with varied cohorts, streaks, and
 * activity ages (one already dormant), plus keeper assignments and nudge
 * history. Combined with the injectable-clock hooks in the schedulers
 * (`runSilenceScan({nowSec})`, `recordCheckin(..., nowSec)`), every
 * time-dependent feature becomes demonstrable on demand — no waiting, no crowd.
 *
 * The ONE real Slack user in the demo is the Hive Keeper (you). Set their id so
 * digests/escalations land in a DM you can screen-record:
 *
 *   DEMO_KEEPER_ID=U0123ABCD node scripts/seed-demo.js
 *
 * Point it at a throwaway DB to rehearse without touching real data:
 *
 *   NUDGER_BEE_DB=/tmp/seed-demo.db DEMO_KEEPER_ID=U0123ABCD node scripts/seed-demo.js
 *
 * Re-running is safe: it deletes prior demo rows (slack_user_id LIKE 'UDEMO%')
 * first, so the seeded world is deterministic every time.
 */

import 'dotenv/config';
import { db } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { derive } from '../services/cohorts.js';

// The repo modules prepare statements against tables at import time, so the
// schema must exist first. Migrate up front, THEN pull them in dynamically.
migrate();
const { recordCheckin } = await import('../db/repos/checkins.js');
const { kvSet } = await import('../db/repos/kv.js');
const { logNudge } = await import('../db/repos/nudges.js');
const { upsertSlot } = await import('../db/repos/slots.js');

const DAY = 86400;
const now = Math.floor(Date.now() / 1000);

const KEEPER_ID = process.env.DEMO_KEEPER_ID || 'UKEEPERDEMO';
const TEAM_ID = process.env.DEMO_TEAM_ID || 'TDEMO';

if (KEEPER_ID === 'UKEEPERDEMO') {
  console.warn(
    '\n⚠️  DEMO_KEEPER_ID not set — using placeholder "UKEEPERDEMO".\n' +
      '    Keeper DMs (silence digest, escalations) will NOT reach a real person.\n' +
      '    For a live/video run, set it to YOUR Slack member id:\n' +
      '      DEMO_KEEPER_ID=U0123ABCD node scripts/seed-demo.js\n',
  );
}

/**
 * Each seeded Hivemate. `activeDaysAgo` sets last_active_at; `streakDays` drives
 * backdated check-ins so the Honey streak computes naturally through the real
 * `recordCheckin` path (not a hand-written number).
 */
const MEMBERS = [
  {
    userId: 'UDEMOROSA',
    name: 'Rosa',
    profile: {
      condition: 'Type 2 Diabetes',
      role: 'caregiver',
      goals: 'check my blood sugar daily',
      consent: 'yes',
      language: 'English',
    },
    blurb: 'Caregiver managing Type 2, wants a daily blood-sugar habit',
    activeDaysAgo: 5, // ⬅ DORMANT: the silence-detector target
    streakDays: 0,
  },
  {
    userId: 'UDEMOMARCUS',
    name: 'Marcus',
    profile: {
      condition: 'Type 2 Diabetes',
      role: 'caregiver',
      goals: 'walk 20 min after dinner',
      consent: 'yes',
      language: 'English',
    },
    blurb: 'Caregiver, 5-day walking streak — a natural peer for Rosa',
    activeDaysAgo: 0,
    streakDays: 5, // ⬅ HOT STREAK: the Honey demo
  },
  {
    userId: 'UDEMOAISHA',
    name: 'Aisha',
    profile: {
      condition: 'anxiety',
      role: 'student',
      goals: 'log my mood each morning',
      consent: 'yes',
      language: 'English',
    },
    blurb: 'Student tracking mood, building a check-in habit',
    activeDaysAgo: 1,
    streakDays: 2,
  },
  {
    userId: 'UDEMODEVON',
    name: 'Devon',
    profile: { role: 'new parent', goals: 'stay connected, avoid isolation', consent: 'yes', language: 'English' },
    blurb: 'New parent here for general wellness and connection',
    activeDaysAgo: 0,
    streakDays: 0,
  },
];

const insertHivemate = db.prepare(
  `INSERT INTO hivemates
     (slack_user_id, slack_team_id, language, timezone, onboarding_state, cohort_key,
      profile_json, last_active_at, honey_streak, last_checkin_at, joined_at, updated_at)
   VALUES
     (@slack_user_id, @slack_team_id, 'eng', 'America/New_York', 'complete', @cohort_key,
      @profile_json, @last_active_at, 0, NULL, @joined_at, @updated_at)`,
);

function wipePriorDemo() {
  const ids = MEMBERS.map((m) => m.userId);
  const placeholders = ids.map(() => '?').join(',');
  const tables = [
    ['checkins', 'slack_user_id'],
    ['nudge_log', 'slack_user_id'],
    ['hivemate_profile_slots', 'slack_user_id'],
    ['intros', 'requester_user_id'],
    ['intros', 'peer_user_id'],
    ['hivemates', 'slack_user_id'],
  ];
  const tx = db.transaction(() => {
    for (const [table, col] of tables) {
      db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${placeholders})`).run(...ids);
    }
  });
  tx();
}

function seed() {
  wipePriorDemo();

  const seeded = [];
  for (const m of MEMBERS) {
    const cohortKey = derive(m.profile);
    const lastActive = now - m.activeDaysAgo * DAY;

    insertHivemate.run({
      slack_user_id: m.userId,
      slack_team_id: TEAM_ID,
      cohort_key: cohortKey,
      // `name` lets keeper digests / suggestions render "Rosa" instead of an
      // unresolvable <@fake-id> mention (seeded ids aren't real Slack users).
      profile_json: JSON.stringify({ ...m.profile, name: m.name, blurb: m.blurb }),
      last_active_at: lastActive,
      joined_at: now - 14 * DAY,
      updated_at: now,
    });

    // Write the profile SLOTS too, not just the consolidated JSON. suggestPeers
    // and the consent gate read hivemate_profile_slots — without these rows the
    // seeded peers look non-consenting and every peer suggestion comes back empty.
    for (const [slot, value] of Object.entries(m.profile)) {
      if (value) upsertSlot(m.userId, slot, value);
    }

    // Build the Honey streak through the real check-in path, one backdated day
    // at a time, so honey_streak/last_checkin_at are computed exactly as prod.
    let finalStreak = 0;
    for (let d = m.streakDays - 1; d >= 0; d--) {
      const { honey_streak } = recordCheckin(m.userId, 'meds', `demo check-in (${d}d ago)`, now - d * DAY);
      finalStreak = honey_streak;
    }

    // Keeper covers every cohort in the demo → digests reach one screen-recordable DM.
    kvSet(`keeper:${cohortKey}`, KEEPER_ID);

    // A little nudge history so the keeper's hive overview isn't empty.
    if (m.activeDaysAgo <= 1) {
      logNudge({
        userId: m.userId,
        kind: 'reminder',
        templateId: 0,
        message: `Hi ${m.name}! Time for your daily check-in 🐝`,
      });
    }

    seeded.push({ name: m.name, cohortKey, lastActiveDaysAgo: m.activeDaysAgo, streak: finalStreak });
  }

  kvSet('default_keeper', KEEPER_ID);
  kvSet('dormancy_threshold_days', '3');

  return seeded;
}

const seeded = seed();

console.log('\n🐝 Seeded demo hive\n');
console.log(`   Keeper (real user): ${KEEPER_ID}${KEEPER_ID === 'UKEEPERDEMO' ? '  (placeholder!)' : ''}`);
console.table(seeded);
console.log('\nNext:');
console.log('  • Silence digest (dormant = Rosa):');
console.log('      node -e "import(\'./scheduler/silence.js\').then(m=>m.runSilenceScan().then(r=>console.log(r)))"');
console.log('  • Fast-forward 5 days without editing data (flags more as dormant):');
console.log(
  '      node -e "import(\'./scheduler/silence.js\').then(m=>m.runSilenceScan({nowSec: Math.floor(Date.now()/1000)+5*86400}).then(console.log))"',
);
console.log('');
