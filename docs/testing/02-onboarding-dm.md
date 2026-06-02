# Day 2 — Onboarding part 1: how to test

## What this phase delivers

The bot can now hold a **conversational onboarding DM** with a new Hivemate. JS owns the slot list (`language`, `condition`, `role`, `goals`, `consent`); the LLM is told what's missing and asks one question at a time, then calls a tool to save each answer. The DB fills in as you chat.

New pieces:

- `agent/prompts/onboarding.js` — onboarding-mode system prompt that wraps the base persona with a "what's filled / what's missing" hint.
- `agent/tools/profile.js` — `save_hivemate_profile_slot` tool (per-slot upsert, returns `remaining_slots` so the LLM can see progress).
- `db/repos/{hivemates,slots,kv}.js` — prepared-statement repos.
- `listeners/events/message_im.js` — handles direct messages to the bot, routes through `callLLM` in onboarding mode while `onboarding_state !== 'complete'`.
- `listeners/events/member_joined.js` — when someone joins the configured **landing channel**, the bot opens a DM with them and posts the welcome that kicks off onboarding.
- `app.js` now caches `bot_user_id` in `app_kv` on startup so handlers can recognize self-messages.

**Day 2 does NOT yet** mark the profile as "complete." It just collects slots. Day 3 adds `complete_onboarding` plus language detection via `franc-min` and triggers cohort matching.

## Setup

Pick a channel in your sandbox to be the "hive landing" channel. People who join this channel get the welcome DM. Examples: `#hive-landing` or just reuse `#general`.

1. **Invite the bot to that channel.** In the channel: `/invite @Nudger Bee (local)`.
2. **Get the channel id.** Click the channel name at the top → **About** → at the bottom you'll see a channel id like `C09XXXXX`. Copy it.
3. **Tell the bot which channel is the landing.** Stop `slack run` (Ctrl-C), then:

   ```bash
   sqlite3 data/nudger-bee.db \
     "INSERT INTO app_kv (k, v, updated_at) VALUES ('landing_channel', 'C09XXXXX', strftime('%s','now')) \
      ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at;"
   ```

   Replace `C09XXXXX` with the actual channel id. Verify:

   ```bash
   sqlite3 data/nudger-bee.db "SELECT * FROM app_kv WHERE k='landing_channel';"
   ```

4. **Start the bot.**

   ```bash
   slack run
   ```

   You should see a new log line like `⚡️ Bolt app is running as Nudger Bee (U09XXXXX)!` — that means `bot_user_id` was cached.

## Test steps

### A. The DM handler works on existing users (no channel-join needed)

1. In the sandbox, click on **Nudger Bee** in the sidebar (or open a DM with the bot via the message composer).
2. Send a plain message: `hi`.

   Expected: the bee asks about your **language** preference (because no slots are filled yet). Reply naturally:

3. Reply: `English is great, thanks!`

   Expected: you'll see the `Saving language...` task chunk fire, then the bee acknowledges and asks the next missing field (likely `condition`).

4. Keep going. Try varied phrasing — the bee should keep asking one missing field per turn until it stops asking (Day 3 will close the loop with `complete_onboarding`).

### B. The member_joined trigger DMs new arrivals

1. In your sandbox, invite a second user (or use the workspace's "Add people" flow) into the landing channel you configured. Or, if you're the only user: leave the channel and rejoin.
2. The moment you join, you should receive a DM from the bot starting with *"Hi! Nudger Bee 🐝 here — welcome to the Hive!..."*. Reply in the DM to continue onboarding.

### C. Verify the DB is filling in

After a few onboarding turns, run:

```bash
sqlite3 -header -column data/nudger-bee.db \
  "SELECT slack_user_id, onboarding_state, language FROM hivemates;"
```

Expected: at least one row, your user id, `onboarding_state = 'in_progress'`.

```bash
sqlite3 -header -column data/nudger-bee.db \
  "SELECT slack_user_id, slot_name, value FROM hivemate_profile_slots ORDER BY slot_name;"
```

Expected: one row per slot you've actually answered (`language`, then `condition`, etc.).

## Expected results

- DM-ing the bot triggers a one-question-at-a-time onboarding flow.
- Each confirmed answer produces a `Saving <slot>...` task chunk in Slack, and a row in `hivemate_profile_slots`.
- A new user joining the configured landing channel receives a welcome DM within a few seconds.
- The `hivemates` row's `onboarding_state` flips from `new` → `in_progress` on the first DM or join.
- The bee never gives medical advice, even if you bait it (chest pain, dosing, etc.). It routes to a Hive Keeper / professional.

## Common failures and how to recover

1. **No welcome DM after joining the landing channel.**
   - Did you set `landing_channel` in `app_kv`? `sqlite3 data/nudger-bee.db "SELECT v FROM app_kv WHERE k='landing_channel';"` should return the channel id.
   - Did you reinstall the app after Day 1's manifest update? Otherwise `member_joined_channel` events won't fire. Re-run `slack install`.
   - Is the bot a member of that channel? Bots only get `member_joined_channel` for channels they're in. `/invite @Nudger Bee (local)` in the landing channel.

2. **The bee responds to a DM but never calls `save_hivemate_profile_slot`.**
   - The local `qwen2.5:14b` is small and can be flaky with structured tool-calling. Try a more explicit answer: instead of "english would be nice" try "Language: English." If still flaky, swap to `gpt-4o-mini` (Day 11 dry-run does this) to confirm the wiring is right.
   - Check `slack run` logs for a `Saving language...` task chunk being emitted but no DB row — would point at the tool's `execute` throwing. The `Common failures` log lines will show.

3. **DM handler fires twice for the same message.** Slack's Assistant container and generic `message` events can both fire if the user opens the AI Assistant pane and sends from there. The handler filters via `event.assistant_thread`, but if you still see double replies, the Assistant container is firing too — close the assistant pane and DM through the regular messages tab.

4. **`Unknown tool: save_hivemate_profile_slot` in the tool result.** That means the tool wasn't passed into `callLLM`. Confirm the file `agent/tools/profile.js` exists and `listeners/events/message_im.js` imports `makeProfileTools`.

## 30-second smoke test

```bash
# 1) Slots are accumulating for at least one user
sqlite3 -header -column data/nudger-bee.db \
  "SELECT COUNT(DISTINCT slot_name) AS slots_filled FROM hivemate_profile_slots;"
# Expect: ≥1 after one round of onboarding.

# 2) bot_user_id is cached
sqlite3 data/nudger-bee.db "SELECT v FROM app_kv WHERE k='bot_user_id';"
# Expect: a U... user id (not empty).
```

If both pass, Day 2's plumbing is intact.
