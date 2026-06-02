# Day 1 — Foundation: how to test

## What this phase delivers

The plumbing the rest of the sprint sits on top of:

- A local **SQLite database** at `data/nudger-bee.db` with 8 empty tables. Migrated on every app boot.
- A refactored **LLM layer** (`agent/llm-caller.js`) that accepts `{systemPrompt, tools}` so each future feature can supply its own prompt and tool set without the dice scaffolding leaking in.
- A new **non-streaming generation helper** (`agent/generate.js`) used by scheduled jobs (Day 5+).
- The persona moved to `agent/prompts/base.js` and exported as `BASE_SYSTEM_PROMPT`.
- The dice tool deleted entirely.
- A **manifest switch from remote → local**, with new bot scopes (`im:write`, `users:read`, `groups:write`, `channels:read`, `commands`), the new event `member_joined_channel`, and `interactivity.is_enabled: true`.

At the end of Day 1 the bot still does what it did yesterday (responds to `@mentions` in your sandbox), but the foundation is ready for the onboarding flow on Day 2.

## Setup

You need:

- Node ≥ 22 (we pinned `engines.node` in `package.json`). Check: `node --version` → should print `v22.x` or higher.
- The `slack` CLI (you already have `.slack/` in the repo). Check: `slack --version`.
- The Ollama-backed local env you already have working from earlier (`LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=qwen2.5:14b`, `ollama serve` running with `qwen2.5:14b` pulled).
- A **Slack Developer Program sandbox workspace** (you said you have one). If you haven't provisioned it yet:
  1. Go to <https://api.slack.com/developer-program> and follow the "Provision sandbox" flow.
  2. Open the sandbox workspace in your Slack client.

## Test steps

### Code-side (no Slack needed)

```bash
# From the repo root
npm run lint
npm run check
```

Both should print exit-clean ("Checked 14 files… No fixes applied" and the tsc command finishing without errors).

```bash
# Verify the migrator runs and creates the DB
rm -f data/nudger-bee.db   # start clean if you want
node -e "import('./db/migrate.js').then(m => { m.migrate(); console.log('migration OK'); })"
```

Expected output:

```
[db] migrated schema at /…/nudger-bee/data/nudger-bee.db
migration OK
```

Confirm tables exist:

```bash
sqlite3 data/nudger-bee.db ".tables"
```

Expected output (8 tables, in any order):

```
app_kv  channels  checkins  hivemates  hivemate_profile_slots  memberships  nudge_log  reminders
```

Peek at one schema if you're curious:

```bash
sqlite3 data/nudger-bee.db ".schema hivemates"
```

### Slack-side: push the new manifest, reinstall, then chat with the bee

This is the one-time switch from a remote-managed manifest to a local one. After this, the manifest is `manifest.json` in this repo and you can PR-review scope changes like any other code.

1. **Stop your running bot.** If `npm start` is running in another terminal, hit `Ctrl-C` there.

2. **Push the local manifest to your sandbox app.**

   ```bash
   slack install
   ```

   (`slack deploy` is **only** for Slack-hosted (Deno) apps. Our bee is a self-hosted Bolt-JS app running via `npm start` and socket mode, so we use `slack install` — it pushes the local manifest *and* re-installs the app with the new scopes in one go. If the CLI prompts for an environment, pick the sandbox workspace where the bee is already running. Accept the reinstall prompt when it asks about new scopes.)

   **If `slack install` also fails**, the reliable fallback is the web UI:
   1. Open <https://api.slack.com/apps> → pick **Nudger Bee**.
   2. Left sidebar → **App Manifest** → click **Edit** → paste the contents of `manifest.json` from this repo → **Save changes**.
   3. Left sidebar → **Install App** → click **Reinstall to (workspace name)** and accept the new scope grant.

3. **Confirm scopes landed.** In your browser, open <https://api.slack.com/apps>, pick the Nudger Bee app, and check **OAuth & Permissions → Bot Token Scopes**. You should see all 12 scopes: `app_mentions:read, assistant:write, channels:history, channels:join, channels:read, chat:write, commands, groups:history, groups:write, im:history, im:write, users:read`.

4. **Confirm events landed.** Open **Event Subscriptions** for the app. Bot Events list should include `member_joined_channel` alongside the four existing events.

5. **Confirm interactivity is on.** Open **Interactivity & Shortcuts**. The toggle at the top should be **On**.

6. **Restart the bot.** Now that the manifest source is local, the Slack CLI manages a separate "(local)" app and its tokens. Use `slack run` instead of `npm start` from here on — it boots the same Node process but injects the right `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` for the local app.

   ```bash
   slack run
   ```

   Pick the same sandbox workspace if it prompts. You should see (somewhere in the output):
   ```
   [db] migrated schema at /…/data/nudger-bee.db
   ⚡️ Bolt app is running!
   ```

   (If you prefer `npm start`, grab the bot/app tokens for "Nudger Bee (local)" from <https://api.slack.com/apps> → app → OAuth & Permissions + Basic Information → App-Level Tokens, drop them into `.env`, then `npm start` works too. But `slack run` is less fuss.)

7. **Smoke-test the bee in Slack.** In the sandbox workspace, in any channel where Nudger Bee is a member, type:

   ```
   @Nudger Bee say hi as the bee
   ```

   Expected: the bee streams back a short, on-brand reply (Hive vocabulary, no clinical advice). The reply should arrive within ~30 seconds (qwen2.5:14b may take a beat to warm up).

## Expected results

- `npm run lint` and `npm run check` exit clean.
- `data/nudger-bee.db` exists and has 8 tables.
- `slack deploy` finishes without errors; the app in the api.slack.com console shows the 12 bot scopes, `member_joined_channel` event, and interactivity on.
- `npm start` boots without errors and prints both the migration line and "Bolt app is running."
- @mentioning the bee in the sandbox produces an on-brand reply (no garbled output, no error in the `npm start` terminal).

## Common failures and how to recover

1. **`node-cron`, `better-sqlite3`, or another dep fails to install.** Most common cause is a missing build toolchain (better-sqlite3 is a native module). Run `xcode-select --install` if you're on macOS and haven't installed CLT, then `rm -rf node_modules package-lock.json && npm install`.

2. **`npm run check` reports a missing type module for `better-sqlite3`.** We added `@types/better-sqlite3` already. If you still see the error, run `npm i -D @types/better-sqlite3` again.

3. **`slack deploy` says "manifest source is remote" or refuses to push.** Double-check `.slack/config.json` — it must read `"source": "local"`. If you cloned a fresh copy that's still on remote, change it and try again.

4. **`npm start` boots but @mention produces no reply.** Two likely causes:
   - The bot isn't a member of the channel you @mentioned it in. Run `/invite @Nudger Bee` in that channel.
   - Socket mode auth failed (wrong `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` in `.env`). Look at the `npm start` log for `socket_mode` errors. If you reinstalled, the bot token may have rotated — run `slack install` again to refresh.

5. **The bee replies in Chinese or with garbled text.** Local `qwen2.5:14b` quirk for some languages — expected. For the gpt-4o-mini submission later, this disappears. To verify the language-handling logic alone, ask in English explicitly.

## 30-second smoke test (run on later days to confirm Day 1 still holds)

```bash
# 1) Lint, check, schema
npm run lint && npm run check
sqlite3 data/nudger-bee.db ".tables" | tr ' ' '\n' | sort -u
# Expect 8 unique table names.

# 2) Bot still responds
# In Slack sandbox: @Nudger Bee one-line check
# Expect: a streamed on-brand reply within 30s.
```

If those two pass on any future day, Day 1's foundation is intact.
