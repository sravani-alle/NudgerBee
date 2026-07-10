# Day 7 — Silence detector (Phase E, reworked): how to test

> **Reworked.** The original design polled `conversations.history` of each cohort
> channel. The Phase C redesign removed cohort channels, so "activity" is now
> derived from what we already track per Hivemate: `last_active_at` (bumped on
> every DM turn) and `last_checkin_at` (a Honey check-in). The
> `services/activity.js` indirection is kept so a future real-time/search
> overlay can slot in later.

## What this phase delivers

An hourly scan that notices when a Hivemate has gone **dormant** (quiet for ≥ a
threshold, default 3 days) and DMs their **Hive Keeper** a single digest so the
keeper can reach out. Key behaviors:

- **Page once per spell.** A keeper is paged once per dormancy spell (gated by
  `dormancy_notified_at`); a second scan won't re-page.
- **One digest per keeper.** If several of a keeper's Hivemates are dormant, they
  get one DM listing all of them — name mention + "quiet for N days", **no health
  details**.
- **Reset on activity.** Any DM turn or check-in clears the dormancy flags, so a
  later quiet spell pages again.

New/changed pieces: `services/activity.js` (`lastActiveAt`, `dormantSince`),
`services/hivekeeper.js` (`sendDormancyDigest`), `scheduler/silence.js`
(`runSilenceScan`), an hourly job in `scheduler/index.js`, and dormancy helpers
in `db/repos/hivemates.js` (+ `touchActive`/`recordCheckin` now clear dormancy).

## Setup

1. Bot running; at least one completed Hivemate with a `cohort_key`.
2. Assign a Hive Keeper for that cohort (so there's someone to page):

   ```bash
   sqlite3 data/nudger-bee.db \
     "INSERT INTO app_kv (k,v,updated_at) VALUES ('keeper:general-wellness::single-parent','U_KEEPER_ID',strftime('%s','now'))
      ON CONFLICT(k) DO UPDATE SET v=excluded.v;"
   ```

   (Use the Hivemate's actual `cohort_key`. A workspace-wide fallback
   `default_keeper` also works if you'd rather not map per cohort.)
3. (Optional) tune the threshold: `app_kv.dormancy_threshold_days` (default 3).

## Test steps

### A. Backdate a Hivemate and scan once

1. Make a Hivemate look quiet for 5 days:

   ```bash
   sqlite3 data/nudger-bee.db \
     "UPDATE hivemates SET last_active_at = strftime('%s','now') - 5*86400, last_checkin_at = NULL
      WHERE slack_user_id = 'U_DORMANT_ID';"
   ```

2. Run the scan once (it builds its own Slack client from `SLACK_BOT_TOKEN`, so
   preload dotenv):

   ```bash
   node -r dotenv/config -e "import('./scheduler/silence.js').then(m=>m.runSilenceScan().then(console.log))"
   ```

   Expected: `{ threshold: 3, flagged: 1, paged: 1, noKeeper: 0, notified: ['U_DORMANT_ID'] }`,
   and the **keeper receives a DM** — *"🐝 One of your Hivemates has gone quiet…
   • @U_DORMANT — quiet for 5 days"*.

3. Confirm the gate was set:

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, datetime(dormant_since,'unixepoch') AS since, dormancy_notified_at FROM hivemates WHERE slack_user_id='U_DORMANT_ID';"
   ```

   Expected: `dormant_since` set, `dormancy_notified_at` non-null.

### B. Second scan does NOT re-page

```bash
node -r dotenv/config -e "import('./scheduler/silence.js').then(m=>m.runSilenceScan().then(console.log))"
```

Expected: `paged: 0` and the keeper gets **no** new DM.

### C. Activity clears dormancy (re-pageable later)

1. As the dormant Hivemate, DM the bee anything (or log a check-in). This calls
   `touchActive` / `recordCheckin`, which clears the dormancy flags.
2. Verify:

   ```bash
   sqlite3 data/nudger-bee.db "SELECT dormant_since, dormancy_notified_at FROM hivemates WHERE slack_user_id='U_DORMANT_ID';"
   ```

   Expected: both `NULL`. A scan now reports `flagged: 0` for them; if they go
   quiet again later, the next spell will page the keeper afresh.

## Expected results

- A Hivemate quiet ≥ threshold days is flagged `dormant_since` and their keeper
  is DMed exactly once per spell.
- Active Hivemates are never flagged; a Hivemate with no keeper (and no
  `default_keeper`) is flagged but counted under `noKeeper`, not paged.
- The keeper digest names Hivemates and "quiet for N days" only — no conditions,
  goals, or other profile data.
- A DM/check-in resets the flags so future dormancy pages again.

## Common failures and how to recover

1. **`paged: 0` when you expected 1.** Either no keeper is set for that cohort
   (set `keeper:{cohort_key}` or `default_keeper`), the Hivemate isn't quite at
   the threshold, or they were already notified this spell (clear with a DM /
   `UPDATE … SET dormancy_notified_at=NULL`).
2. **Keeper DM never arrives.** The bot needs `im:write`; the keeper id must be a
   real user the bot can DM. Check `slack run` logs for the `[silence]` line and
   any `hivekeeper:` warning.
3. **`invalid_auth`.** `SLACK_BOT_TOKEN` not loaded — use `node -r dotenv/config …`.
4. **A Hivemate flagged dormant right after onboarding.** Shouldn't happen —
   onboarding calls `touchActive`. If `last_active_at` is null, activity falls
   back to `joined_at`.

## 30-second smoke test

```bash
# Dormancy bookkeeping is sane
sqlite3 -header -column data/nudger-bee.db \
  "SELECT COUNT(*) AS dormant_flagged FROM hivemates WHERE dormant_since IS NOT NULL;"
```

```bash
# Pure dormancy rule (no Slack/DB): 5 days quiet at threshold 3 => dormant; 1 day => not
node -e "import('./services/activity.js').then(m=>{const D=86400,now=1800000000;
  const dormant=m.dormantSince({last_active_at:now-5*D, joined_at:now-9*D}, 3, now);
  const active =m.dormantSince({last_active_at:now-1*D, joined_at:now-9*D}, 3, now);
  console.log(dormant!==null && active===null ? 'DORMANCY OK' : 'BROKEN');})"
```
