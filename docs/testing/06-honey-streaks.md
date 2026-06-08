# Day 6 — Check-ins + Honey streaks (Phase D part 2): how to test

## What this phase delivers

Once a Hivemate has finished onboarding, the bee can **record check-ins** and
track their **Honey streak 🍯** (consecutive days they've checked in). When they
DM something like "took my meds today" or "logged my walk", the bee records it,
updates the streak, and cheers them on in a fresh, streak-aware way.

New pieces:

- `db/repos/checkins.js` — `recordCheckin(userId, kind, content)` inserts the
  check-in and recomputes the streak atomically. `computeStreak` is a pure,
  unit-tested rule: same-day repeats don't inflate the streak; a consecutive day
  adds one; a missed day resets to 1. (Day boundaries are UTC for now.)
- `agent/tools/checkin.js` — `record_checkin({kind, content})` tool; returns the
  new `honey_streak` so the bee can voice the right cheer.
- The tool is exposed to **onboarded** Hivemates (via `prepareHivemateTurn`), so
  it's available in normal DM chat — not during onboarding.
- Nudges are already streak-aware (Day 5): the daily nudge prompt includes the
  current streak.

## Setup

1. Bot running; a Hivemate at `onboarding_state='complete'` (Days 3–4).
2. Nothing else to configure — check-ins happen in the normal DM with the bee.

## Test steps

### A. A check-in is recorded and the streak starts

1. DM the bee (as an onboarded Hivemate): `Just took my meds 🍯`.
2. Expected: a `Logging your check-in 🍯...` task chunk, then a warm reply that
   acknowledges the check-in and your streak (e.g. "Day 1 of your Honey streak!").
3. Verify:

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, kind, content, datetime(created_at,'unixepoch') AS at FROM checkins ORDER BY created_at DESC LIMIT 3;"
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, honey_streak, datetime(last_checkin_at,'unixepoch') AS last FROM hivemates WHERE honey_streak > 0;"
   ```

   Expected: a `checkins` row for your message; `honey_streak = 1`.

### B. Same-day repeat does NOT inflate the streak

1. Immediately DM another check-in: `also logged a short walk`.
2. Expected: it's recorded (a new `checkins` row), but `honey_streak` stays the
   same (still 1) — you don't farm streak by checking in twice in one day.

### C. Streak math across days (deterministic, no waiting)

The streak rule is a pure function, so verify all branches without waiting days:

```bash
node -e "import('./db/repos/checkins.js').then(m=>{
  const D=86400;
  console.log('first      ', m.computeStreak(0,null,100));        // 1
  console.log('same day   ', m.computeStreak(3,5*D+10,5*D+900));  // 3
  console.log('next day   ', m.computeStreak(3,5*D,6*D));         // 4
  console.log('missed day ', m.computeStreak(3,5*D,8*D));         // 1
})"
```

Expected: `1, 3, 4, 1`.

### D. Streak-aware nudges (ties Day 5 + Day 6 together)

1. With a Hivemate on a multi-day streak, force a nudge:

   ```bash
   node -r dotenv/config -e "import('./scheduler/reminders.js').then(m=>m.runOnce('U_YOUR_ID').then(r=>console.log(r.message)))"
   ```

2. Expected: the nudge may reference the streak ("keep that Honey buzzing 🍯").
   With `honey_streak = 0`, the nudge gently encourages a fresh start instead.

## Expected results

- Reporting a daily action in DM creates a `checkins` row and sets/updates
  `hivemates.honey_streak` + `last_checkin_at`.
- Same-day check-ins are recorded but don't increment the streak.
- A check-in on the next day increments; a missed day resets to 1.
- The bee's reply reflects the streak; the daily nudge does too.
- The bee never treats a check-in as a clinical event — it celebrates, it
  doesn't advise.

## Common failures and how to recover

1. **Bee chats but never calls `record_checkin`.** The tool is only attached
   once `onboarding_state='complete'`. Confirm with
   `sqlite3 data/nudger-bee.db "SELECT onboarding_state FROM hivemates WHERE slack_user_id='U…';"`.
   On local qwen the model may also just not call it — say it plainly ("log my
   meds") or test on gpt-4o-mini.
2. **Streak jumped by more than 1 in a day.** Shouldn't happen — same-day
   check-ins are no-ops for the streak. If it did, check the `computeStreak`
   branches above; a wrong `last_checkin_at` is the usual cause.
3. **Streak reset unexpectedly.** Day boundaries are UTC. A check-in late at
   night local time can land on the "next" UTC day; that's a known sprint
   simplification (per-timezone boundaries are deferred).

## 30-second smoke test

```bash
# Check-ins recorded and a streak exists
sqlite3 -header -column data/nudger-bee.db \
  "SELECT (SELECT COUNT(*) FROM checkins) AS checkins,
          (SELECT MAX(honey_streak) FROM hivemates) AS max_streak;"
# Expect: checkins >= 1, max_streak >= 1
```

```bash
# Pure streak rule is correct (no Slack/DB needed)
node -e "import('./db/repos/checkins.js').then(m=>{const D=86400;
  const ok = m.computeStreak(0,null,1)===1 && m.computeStreak(3,5*D,6*D)===4 && m.computeStreak(3,5*D,8*D)===1;
  console.log(ok?'STREAK OK':'STREAK BROKEN');})"
```
