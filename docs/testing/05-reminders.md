# Day 5 — Reminder engine (Phase D part 1): how to test

## What this phase delivers

The bee can send **daily check-in nudges** — short, warm, on-brand messages that
vary every day and speak the Hivemate's language.

How it stays varied without sounding robotic or costing anything:

- `agent/prompts/nudge.js` holds **10 structural templates** (angles, not literal
  text). JS round-robins them via `nudge_log.template_id = (# prior reminders) %
  10`, so the *shape* changes daily; the LLM voices each one.
- Nudges are **streak-aware**: the prompt includes the Hivemate's Honey streak.
- `scheduler/reminders.js` — `runOnce(userId)` (one Hivemate) and `runForAll()`
  (everyone onboarded). Picks the template, generates via `generateMessage`
  (non-streaming), posts, and logs to `nudge_log`.
- `scheduler/index.js` — registers a daily cron (`startSchedulers`), wired into
  `app.js` after startup. Schedule + timezone come from `app_kv`
  (`reminder_cron`, `default_timezone`) so they're tunable without a code change.

Where nudges land is configurable via `app_kv.nudge_target`:
- `dm` (default) — DMs the Hivemate, so their check-in reply reaches the DM where
  `record_checkin` will live (Day 6).
- `channel` — posts into the peer cohort channel.

## Setup

1. Bot running, at least one Hivemate at `onboarding_state='complete'` (Day 3/4).
2. (Optional) choose where nudges go:

   ```bash
   sqlite3 data/nudger-bee.db \
     "INSERT INTO app_kv (k,v,updated_at) VALUES ('nudge_target','dm',strftime('%s','now'))
      ON CONFLICT(k) DO UPDATE SET v=excluded.v;"
   ```

3. (Optional) set a safe daily time + timezone so the live cron never fires at
   3am:

   ```bash
   sqlite3 data/nudger-bee.db \
     "INSERT INTO app_kv (k,v,updated_at) VALUES ('default_timezone','America/New_York',strftime('%s','now'))
      ON CONFLICT(k) DO UPDATE SET v=excluded.v;"
   ```

## Test steps

### A. Force-fire a single nudge (no waiting for cron)

`runOnce` builds its own Slack client from `SLACK_BOT_TOKEN`, so preload dotenv:

```bash
node -r dotenv/config -e "import('./scheduler/reminders.js').then(m=>m.runOnce('U_YOUR_ID').then(r=>console.log(r)))"
```

Expected: `{ ok: true, templateId: 0, channelId: 'D…', message: '…' }`, and the
Hivemate receives a short nudge (DM or cohort channel per `nudge_target`).

### B. Confirm round-robin variety (the anti-repetition guarantee)

Fire it ~10 times for the same user:

```bash
for i in $(seq 1 10); do
  node -r dotenv/config -e "import('./scheduler/reminders.js').then(m=>m.runOnce('U_YOUR_ID').then(r=>console.log(r.templateId, '|', r.message)))"
done
```

Then inspect the log:

```bash
sqlite3 -header -column data/nudger-bee.db \
  "SELECT template_id, substr(message,1,60) AS preview FROM nudge_log WHERE kind='reminder' ORDER BY created_at;"
```

Expected: `template_id` walks `0,1,2,…,9` (then wraps), and the 10 messages are
structurally distinct (different openings/angles), not the same line reworded.

### C. The cron is registered

Start the app and watch the logs:

```bash
slack run
```

Expected log line: `[scheduler] daily reminders scheduled '0 9 * * *' (America/New_York)`.
You don't need to wait for 9am — `runOnce`/`runForAll` are the test surface. To
prove the whole-Hive path, force it:

```bash
node -r dotenv/config -e "import('./scheduler/reminders.js').then(m=>m.runForAll().then(r=>console.log(r)))"
```

Expected: one result per completed Hivemate, each `{ ok: true, … }`.

## Expected results

- A forced nudge lands in Slack and writes a `nudge_log` row with `kind='reminder'`
  and the right `template_id`.
- Ten consecutive fires for one user produce ten structurally different messages
  and `template_id` values `0..9`.
- Messages are in the Hivemate's language and reference their Honey streak when
  they have one.
- `slack run` logs the scheduled job at startup; `runForAll` nudges every
  completed Hivemate without one failure stopping the others.

## Common failures and how to recover

1. **`runOnce` returns `{ ok:false, reason:'not onboarded' }`.** That user hasn't
   completed onboarding — finish Day 3 first.
2. **`reason:'no target channel'`.** With `nudge_target='channel'`, the user has
   no cohort channel yet (Day 4 didn't run). Switch to `dm` or complete matching.
3. **Empty/odd message on local qwen.** The local model sometimes adds a preamble
   despite "output only the message." This is a `LOCAL-LLM-SHIM`-class issue —
   gpt-4o-mini obeys it. Re-run, or test on gpt-4o-mini.
4. **`invalid_auth` from `runOnce`.** `SLACK_BOT_TOKEN` isn't loaded — use
   `node -r dotenv/config …` as shown.

## 30-second smoke test

```bash
# Reminders logged with rotating templates
sqlite3 -header -column data/nudger-bee.db \
  "SELECT COUNT(*) AS reminders, COUNT(DISTINCT template_id) AS distinct_templates
   FROM nudge_log WHERE kind='reminder';"
# After 10 fires: reminders >= 10, distinct_templates = 10
```

```bash
# Template set is intact and unique (no Slack needed)
node -e "import('./agent/prompts/nudge.js').then(m=>{
  console.log('count', m.NUDGE_TEMPLATES.length, 'unique', new Set(m.NUDGE_TEMPLATES).size);
})"
# Expect: count 10 unique 10
```
