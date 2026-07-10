# Nudger Bee — MVP Implementation Plan

## Context

This repo is the submission for the **Slack Agent Builder Challenge** (Devpost, hard deadline 2026-07-13, *Slack Agent for Good* track). **Nudger Bee 🐝** is a Slack-based community-health agent that profiles new members ("Hivemates"), matches them with peers in a similar situation (a curated shortlist + bee-brokered warm 1:1 intros — not a shared channel), runs personality-filled accountability nudges, and helps overwhelmed Community Health Workers ("Hive Keepers") see who has gone quiet — replacing spreadsheets and WhatsApp groups.

Today (2026-06-01) the repo is the stock `bolt-js-assistant-template` with the LLM layer rewired to the OpenAI-compatible Chat Completions API: it runs free against local Ollama (`qwen2.5:14b`) for dev and swaps to `gpt-4o-mini` for submission by env-var only. `agent/system-prompt.js` already encodes the bee persona, Hive vocabulary, language handling (default EN, mirror user's language, never mix), and hard clinical-safety guardrails (coordinator, *never* clinician). What's missing: persistence, scheduler, generic DM handler, peer cohort logic, MCP, and silence detection.

The plan has **two layers**:

1. **A 14-day sprint** targeting an early Agent-for-Good submission by **2026-06-14**. Devpost allows submission edits until the 07-13 hard deadline, so an early submission acts as a backstop and a 4-week polish window remains. After 06-14, if everything is solid, pivot to the Organizations track as a sequel.
2. **The full-MVP design** preserved below as the implementation reference. Items cut from the sprint live in "Deferred / future possibilities" so we don't lose them.

User decisions in effect: full MVP planned; persistence on SQLite (`better-sqlite3`); onboarding is a conversational DM with tool-calling; centerpiece tech is **MCP** (sprint) + **RTS API** (deferred, with `conversations.history` as the sprint-time substitute). User is new to Slack app development → every sprint day must produce a step-by-step testing doc in `docs/testing/`.

## How Nudger Bee wins (strategy)

These are the levers; everything in the sprint serves them.

- **One narrative arc demo.** Maria the CHW with 80 patients → onboards a Hivemate → bee suggests a peer + makes a warm 1:1 intro → nudge → check-in → goes dormant → keeper digest → asks bee a scheduling question (visible MCP) → has a clinical question → escalation. Not a feature tour.
- **Lead the video with the human, not the tech.** First 30 seconds = the pain. Then bee.
- **Required tech VISIBLE on screen.** MCP `task_update` chunk must fire on camera. Silence digest must land in a keeper's DM on camera. If a judge has to read the README to know the tech is central, we lose the "tech central" judging line.
- **Safety story as differentiator.** The chest-pain → refusal → `escalate_to_hive_keeper` flow is a winning beat — most submissions in a health-adjacent track won't have it this clean. Show it.
- **A measurable-impact line.** Even an estimate: "Saves a CHW with 80 patients ~X hours/week of manual coordination." Judges reward a number.
- **Submit early, iterate via Devpost edits.** Submission on 06-14 is the backstop; the next four weeks are pure polish (better video, tighter narrative, RTS overlay if access lands).

## The 14-day sprint

Internal submission target: **2026-06-14 (Sat)**. Hard deadline: **2026-07-13 @ 5 PM PDT**.

Each row produces (a) the implementation and (b) a numbered testing doc in `docs/testing/`. Testing docs are written for a Slack-app-dev newcomer (the user) — see "Per-phase testing documentation" below for the required format.

| Day | Date | Scope | Test doc |
|-----|------|-------|----------|
| 1 | Mon 06/02 | Phase A (foundation) — deps, SQLite, schema, migrate, refactor `callLLM`, delete dice, manifest local + new scopes/events/interactivity, **provision Slack Developer Program sandbox and install bee** | `docs/testing/01-foundation.md` |
| 2 | Tue 06/03 | Phase B part 1 — `message_im` handler skeleton, `save_hivemate_profile_slot` tool, `member_joined` trigger, base onboarding prompt | `docs/testing/02-onboarding-dm.md` |
| 3 | Wed 06/04 | Phase B part 2 — `complete_onboarding` tool, franc language detection, full EN + ES flow end-to-end | `docs/testing/03-onboarding-complete.md` |
| 4 | Thu 06/05 | Phase C — cohort derivation, find-or-create private channel, invite Hivemate, post-onboarding trigger | `docs/testing/04-peer-matching.md` |
| 5 | Fri 06/06 | Phase D part 1 — `node-cron`, `generateMessage` helper, 8–12 nudge templates, template round-robin via `nudge_log.template_id` | `docs/testing/05-reminders.md` |
| 6 | Sat 06/07 | Phase D part 2 — `record_checkin` tool, Honey streak tracking, streak-aware nudges | `docs/testing/06-honey-streaks.md` |
| 7 | Sun 06/08 | Phase E (history-only) — `services/activity.js` history provider, hourly silence cron, keeper digest DM, `dormancy_notified_at` gating | `docs/testing/07-silence-detector.md` |
| 8 | Mon 06/09 | Phase F (lean) — `agent/mcp-client.js` with schema sanitization, in-repo `mcp/program-server` exposing `list_upcoming_sessions` + `schedule_followup` | `docs/testing/08-mcp.md` |
| 9 | Tue 06/10 | Safety + Keeper stats — `escalate_to_hive_keeper` tool with `nudge_log` `kind:'escalation'`, `hive_stats` tool gated by `keeper:*` `app_kv` | `docs/testing/09-safety-stats.md` |
| 10 | Wed 06/11 | `scripts/seed-demo.js` (4 fake Hivemates, varied `last_active_at`, populated `nudge_log`, keeper assignments) + delete remaining template scaffolding + full Ollama end-to-end run | `docs/testing/10-seed-and-eval.md` |
| 11 | Thu 06/12 | Swap `.env` to `LLM_MODEL=gpt-4o-mini` + real `OPENAI_API_KEY`; full re-test; write `README_FOR_JUDGES.md`; safety regression suite | `docs/testing/11-openai-dryrun.md` |
| 12 | Fri 06/13 | Record <3-minute demo video; build architecture diagram (PNG); invite `slackhack@salesforce.com` + `testing@devpost.com` to sandbox, landing channel, and one demo cohort | `docs/testing/12-demo-assets.md` |
| 13 | Sat 06/14 | **Submit on Devpost.** Track: Agent for Good. Description with impact statement, video link, architecture diagram, sandbox URL, judge emails verified. | `docs/testing/13-submission.md` (post-submission smoke test) |

Days 14–42 (06-15 → 07-13): polish iterations from the Deferred list against the still-editable submission. Pivot to the Organizations track plan once Agent for Good is solid.

### Progress log

- **Day 1+2 (done).** Foundation + conversational onboarding (slot-filling DM). See commit `f542ed8`.
- **Day 3 (done).** `complete_onboarding` tool (server-side slot validation, consolidates into `profile_json`, flips `onboarding_state='complete'`, exposes an `onComplete` hook for Day 4 matching), language resolution in `services/language.js`, full EN + ES flow. **Deviations:**
  - *Language:* `franc-min` is unreliable on short text (misreads "I prefer English please" as Spanish; English as Uzbek when unconstrained). So the **stated `language` slot is authoritative** (`languageNameToCode`), and franc is only a length-gated, whitelist-constrained (`HIVE_LANGUAGES`, default `eng,spa`) fallback before a preference is captured. This replaces the plan's "franc over recent turns" as the primary signal.
  - *DM routing:* the app has the Slack Assistant feature enabled, so DMs are routed through the Assistant container, not `message.im`. Onboarding was moved into `listeners/assistant/message.js` (+ `assistant_thread_started` welcome); shared logic extracted to `services/dm-turn.js` (`prepareHivemateTurn`), reused by `message_im.js` as a fallback. `member_joined.js` now posts a pointer nudge to avoid a double welcome. User chose to keep the Assistant pane (polished agent UI, task chunks for the MCP demo).
  - *Local-model robustness (`agent/llm-caller.js`):* qwen2.5:14b via Ollama leaks its `<tool_call>`/`<|im_start|>` tokens into message content and sometimes hallucinates slot values. Fixes: tool-enabled turns now run **non-streaming** (reliable tool parsing), a fallback recovers tool calls leaked as text, control tokens are stripped before display, and a recursion cap (`MAX_TOOL_ROUNDS=6`) stops tool-call loops. `save_hivemate_profile_slot` rejects echoed/placeholder values. These are local-dev hardening; gpt-4o-mini (Day 11) doesn't hit them.
  - Peer-cohort channel creation (the `onComplete` payoff) lands in Day 4 below.
- **Days 4–6 (done, built as one batch — to be tested together on gpt-4o-mini).**
  - *Day 4 (Phase C, peer matching):* `services/cohorts.js` (`derive`/`slugify`/`channelNameFor`, `::` separator), `db/repos/{channels,memberships,nudges}.js`, `services/channels.js` (find-or-create private channel with `name_taken` retry + invite), `services/matching.js` (`runMatching`: derive → channel → invite → **name-only** channel welcome → keeper DM from `app_kv["keeper:{cohort_key}"]`). Wired through `complete_onboarding`'s `onComplete` in both DM handlers; best-effort so a Slack hiccup never fails onboarding.
  - *Day 5 (Phase D pt1, reminders):* `agent/prompts/nudge.js` (10 round-robin templates + `buildNudgePrompt`, language- and streak-aware), `scheduler/reminders.js` (`runOnce`/`runForAll`, template_id = `countNudges % 10`, `generateMessage`, `nudge_target` kv = dm|channel default dm), `scheduler/index.js` (`startSchedulers` node-cron, `reminder_cron`/`default_timezone` from kv), wired into `app.js`.
  - *Day 6 (Phase D pt2, Honey):* `db/repos/checkins.js` (`recordCheckin` + pure `computeStreak`, UTC day boundaries), `agent/tools/checkin.js` (`record_checkin`), exposed to onboarded Hivemates via `prepareHivemateTurn`. Streak feeds the nudge prompt.
  - Verified offline against live Ollama with mock Slack clients: matching flow, reminder round-robin (10 distinct), and all streak branches. **Not yet exercised live in Slack** — that's the user's combined test pass. Requires restarting `slack run`.
  - *Deferred to keep batch focused:* per-Hivemate-timezone reminder rows (sprint uses one daily cron + workspace default tz); per-timezone streak day boundaries (UTC for now).
- **Phase C REDESIGN (done, supersedes the Day 4 entry above).** User rejected the cohort-channel model (sprawl; dead, intimidating rooms). New model: **peer suggestions + bee-brokered warm 1:1 intro, bee stays out of the chat**, and **`condition` made optional**. Changed: `onboarding.js`/`profile.js` (REQUIRED vs ALL slots; don't invent condition), `cohorts.js` (condition→`general-wellness`, dropped `channelNameFor`), NEW `services/peers.js` + `agent/tools/intro.js` + `db/repos/intros.js` + `intros` table, `matching.js` rewritten (no channel; returns `suggestions`), `complete_onboarding` surfaces `suggestions`, `dm-turn.js` exposes `[record_checkin, request_intro]` post-onboarding. **Deleted `services/channels.js`**; `channels`/`memberships` tables now unused. Verified offline (consent filtering, no-channel, intro heads-up, dup/bogus-id guards, condition-optional derive).
  - ⚠️ **Downstream implication for Day 7 (Phase E, silence detector):** it was designed to poll `conversations.history` of each **cohort channel** — which no longer exists. Day 7 must instead derive activity from DMs / `checkins` / `last_active_at` (touched on every DM turn) rather than cohort-channel history. Revisit `services/activity.js` design accordingly.
- **Day 7 (Phase E, silence detector — done, reworked per the note above).** Activity = `max(last_active_at, last_checkin_at, joined_at)` via `services/activity.js` (no cohort-channel history). `scheduler/silence.js` `runSilenceScan` flags Hivemates quiet ≥ threshold (default 3d), pages each cohort's Hive Keeper ONCE per spell (gated by `dormancy_notified_at`) with one grouped digest DM via `services/hivekeeper.js`; `touchActive`/`recordCheckin` clear dormancy so later spells re-page. Hourly cron added to `scheduler/index.js`; keeper resolved via `keeper:{cohort_key}` → `default_keeper`. Verified offline against the Day-7 acceptance scenario (backdate 5d → paged once; second scan no re-page; check-in clears → re-pageable). **Not yet exercised live in Slack.**
- **Demo harness (`scripts/seed-demo.js`, Day 10 pulled forward).** Seeds 4 Hivemates (Rosa dormant 5d, Marcus 5-day streak, Aisha, Devon) with varied cohorts, keeper assignments (`DEMO_KEEPER_ID` = the real keeper), and nudge history — all as DB state. Streaks built through the real `recordCheckin` path. Unblocks the "can't test in an empty sandbox" problem: combined with the injectable clock (`runSilenceScan({nowSec})`), silence digests / streaks / keeper overview are all demonstrable on demand. Verified headlessly (seed → silence scan pages Rosa once → gating → +5d fast-forward pages the rest).
- **Day 8 (Phase F, MCP — done).** In-repo stdio MCP server `mcp/program-server/index.js` (`McpServer` + zod) exposing `list_upcoming_sessions` (cohort-filterable) and `schedule_followup`. `agent/mcp-client.js` connects at startup (`connectMcp` in `app.js`, best-effort; `disconnectMcp` on SIGTERM/SIGINT), discovers tools, sanitizes their JSON Schema (`sanitizeSchema`: inline `$ref`, drop `format`/`$schema`, force `additionalProperties:false`), namespaces them `mcp__prog__*`, and adapts them to `BeeTool`s spliced into onboarded DMs via `dm-turn.js` `getMcpTools()`. Each call fires the existing `task_update` chunk (the on-camera required tech). Verified headlessly (real client↔server stdio round-trip: both tools discovered, called, error path surfaced as `{error}`, clean disconnect). **Not yet exercised live in Slack.**
- **Day 10 (cleanup — done; scaffolding removed).** Deleted the `'Wonder a few deep thoughts.'` template demo branch (dice/hamsters/acrobatics `task_update` show) from `listeners/assistant/message.js`, leaving only the real DM turn; dropped the now-unused `sleep` helper. Swapped the off-brand loading messages ("office goldfish") for on-brand bee-themed ones in `assistant/message.js` + `events/app_mention.js` (they show on camera). Removed stray tracked 0-byte `listeners/events/_perm_test{,_abs}` artifacts. `agent/tools/dice.js` was already gone. Verified: syntax + biome clean, listener modules import without throwing, no scaffolding strings remain. **Remaining Day 10 item — a full Ollama end-to-end run — is a live pass (folded into the Day 11 gpt-4o-mini test).** Seed harness (the other Day 10 deliverable) shipped earlier.
- **Day 9 (Safety + Keeper stats — done).** `agent/tools/safety.js` `escalate_to_hive_keeper` (args `reason`, `urgency`) — DMs the Hivemate's keeper and writes a `nudge_log` `kind:'escalation'` row; exposed on EVERY DM turn (onboarding + onboarded) via `dm-turn.js`. Base prompt now *requires* the escalate call whenever the bee declines a clinical concern. `agent/tools/keeper.js` `hive_stats` — keeper-gated overview (total/active/dormant/top-streaks); returns `[]` for non-keepers. New shared `services/keepers.js` (`keeperFor`/`cohortsForKeeper`/`isKeeper`/`statsForKeeper`) + `db/repos/kv.js` `kvEntriesWithPrefix`; `scheduler/silence.js` refactored to use the shared `keeperFor` (silence regression re-verified). Verified headlessly against the seed hive (urgent escalation → keeper DM + escalation row; gating: 1 tool for keeper, 0 for Hivemate; stats: 4 total / 1 dormant / streaks 5,2). **Not yet exercised live in Slack; safety regression suite (EN/ES) is Day 11.**

## Deferred / future possibilities

Kept here so we don't lose them. Pick up after 06-14 in priority order.

- **RTS API overlay** on top of `services/activity.js`. Once Slack RTS access is granted, add `RtsActivityProvider` so the silence story upgrades from "powered by Slack search (conversations.history)" to "real-time search." Requires verifying method name, scope, and bot-vs-user-token requirement; gate behind a real OAuth install if it needs a user token.
- **MCP discovery layer.** Multi-server connect via `MCP_SERVERS` env, lazy tool exposure, allowlist per server, full JSON-Schema sanitization for arbitrary servers. Sprint uses a single hardcoded in-repo MCP server with 2 tools.
- **Hive Keeper table.** Replace `app_kv["keeper:{cohort_key}"]` with a proper `hive_keepers` table once we have >1 keeper per cohort or want UI to manage them.
- **`/hive` slash command.** Surface stats / dormancy queries as a slash command for keepers. Sprint exposes the same via an LLM tool keepers invoke conversationally.
- **Richer cohort matching.** Multi-attribute scoring or embedding similarity vs. the sprint's `condition::role` slug. Add `profile_json` secondary attributes used only for intro ordering within a cohort.
- **Domain extensions** (from project memory): mental health, addiction recovery, new-parent support, cancer survivorship / long COVID, financial coaching, reentry programs. Each is a cohort schema + reminder pack on top of the sprint engine.
- **Organizations track + Slack Marketplace submission.** Separate plan after 06-14.

## Architecture overview

```
agent/
  llm-caller.js           refactor: callLLM(streamer, messages, {systemPrompt, tools})
  generate.js             NEW: non-streaming generateMessage(...) for scheduled jobs
  prompts/
    base.js               persona + safety + language (renamed from system-prompt.js)
    onboarding.js         onboarding-mode additions (missing-slots hint)
    nudge.js              nudge generation mode
    keeper.js             Hive Keeper mode (stats, dormancy summaries)
  tools/
    profile.js            save_hivemate_profile_slot, complete_onboarding
    safety.js             escalate_to_hive_keeper
    checkin.js            record_checkin (Honey streak)
    keeper.js             hive_stats
    DELETE dice.js
  mcp-client.js           connect, discover, schema-sanitize, result-flatten
db/
  index.js                better-sqlite3 connection
  schema.sql              DDL
  migrate.js              startup migration
  repos/                  hivemates, slots, channels, memberships, checkins,
                          nudges, kv
services/
  cohorts.js              cohort_key derivation (slugified, "::" separator)
  channels.js             find-or-create private cohort channel, invite
  activity.js             ActivityProvider interface (history default; RTS overlay deferred)
  hivekeeper.js           DM digests to keepers
  language.js             pre-LLM detection via franc-min (deterministic stickiness)
scheduler/
  index.js                node-cron registration
  reminders.js            daily check-in nudges (per Hivemate timezone)
  silence.js              hourly dormancy scan
listeners/
  events/
    app_mention.js        existing
    message_im.js         NEW: routes DMs through onboarding-aware callLLM
    member_joined.js      NEW: triggers onboarding DM
scripts/
  seed-demo.js            seed fake Hivemates / nudges / timestamps for the demo
data/                     gitignored: nudger-bee.db
mcp/program-server/       NEW: tiny in-repo MCP server used by the demo
docs/testing/             per-phase testing docs (newcomer-friendly)
docs/PLAN.md              checked-in copy of this plan (see "Save this plan into the repo")
README_FOR_JUDGES.md      one-pager for slackhack@/testing@ on how to test
```

Design pillars carried throughout:

- **Per-mode system prompt + tool list.** `callLLM` accepts `{systemPrompt, tools}` so onboarding, nudges, keeper mode, and the general assistant each scope their own. Fixes today's leak of the dice tool into every code path (`agent/llm-caller.js:36`).
- **Slot-filling onboarding** (deterministic loop, freeform prose). JS owns the slot list and the "what's missing" hint; the LLM owns the natural conversation and per-field tool calls. Reliable on `qwen2.5:14b`, clean on `gpt-4o-mini`.
- **Template-based nudges with LLM fill-ins.** 8–12 seed templates round-robined via `nudge_log.template_id`, then translated/voiced by the LLM. Guarantees structural diversity, costs nothing, survives a flaky local model.
- **`ActivityProvider` indirection for silence.** Default in sprint: `conversations.history` incremental polling per channel via `oldest` cursor stored in `app_kv`. RTS lives in Deferred.
- **MCP client with safe schema translation.** Namespaced tool names (`mcp__server__tool`), JSON-Schema sanitization, flattened tool results to a single string. Sprint connects exactly one server; multi-server discovery is in Deferred.
- **Safety stays first-class.** `escalate_to_hive_keeper` both DMs the keeper and writes a `nudge_log` row (`kind: 'escalation'`) so the safety story is *visible* in the demo, not just a refusal string.

## Implementation reference (detailed)

### Phase A — Foundation (Day 1)

- Add deps: `better-sqlite3`, `node-cron`, `@modelcontextprotocol/sdk`, `franc-min`. Pin `engines.node` in `package.json` (better-sqlite3 is a native module).
- `db/index.js` opens `data/nudger-bee.db` (create `data/` if missing; add to `.gitignore`).
- `db/schema.sql`: `hivemates` (with `language`, `timezone`, `onboarding_state`, `last_active_at`, `dormant_since`, `dormancy_notified_at`, `profile_json`), `hivemate_profile_slots`, `channels`, `memberships`, `checkins`, `nudge_log` (with `template_id`, `kind`), `reminders`, `app_kv`. No `hive_keepers` table for now — keeper-per-cohort lives in `app_kv` under `keeper:{cohort_key}`.
- `db/migrate.js` runs on startup before `app.start()` in `app.js`.
- Refactor `agent/llm-caller.js` to `callLLM(streamer, messages, {systemPrompt, tools = []})`. Default `systemPrompt` is the base persona. Existing call sites in `listeners/assistant/message.js` and `listeners/events/app_mention.js` pass `tools: []`. Delete `agent/tools/dice.js` and all references.
- `agent/generate.js`: non-streaming `generateMessage(messages, {systemPrompt, tools})` returning a string. Built on `openai.chat.completions.create({ ..., stream: false })`. Used by all scheduled jobs.
- **Manifest:** switch `.slack/config.json` to `manifest.source: local`. Add bot scopes `im:write`, `users:read`, `groups:write`, `channels:read`, `commands`. Add bot event `member_joined_channel`. Flip `interactivity.is_enabled: true` (also fixes the existing `feedbackBlock` handler which never fires today). Reinstall via `slack deploy` / `slack install`.
- **Sandbox provisioning** (Day 1): Provision a Slack Developer Program sandbox (the user joined the program already), install Nudger Bee there. This is where judges will test; setting it up now avoids a Day 12 surprise.

### Phase B — Onboarding (Days 2–3)

- `listeners/events/member_joined.js`: when a Hivemate joins the configured "hive landing" channel (id stored in `app_kv` under `landing_channel`), `conversations.open` → `chat.postMessage` to DM a warm welcome and mark `hivemates.onboarding_state = 'in_progress'`.
- `listeners/events/message_im.js` (`message.im`):
  - Load the Hivemate row + filled slots.
  - Compute `missing = REQUIRED_SLOTS - filled` in JS. **The slot list is the source of truth, never the LLM.**
  - Build messages with: system prompt = base persona + `prompts/onboarding.js` ("Slots still missing: [...]. Ask about ONE of these naturally. Use the tools for every confirmed field. When all slots are filled, call `complete_onboarding`."), recent DM turns from `conversations.history`, tools `[save_hivemate_profile_slot, complete_onboarding, escalate_to_hive_keeper]`.
  - Hand off to `callLLM` with onboarding-mode prompt+tools.
- `agent/tools/profile.js`:
  - `save_hivemate_profile_slot({slot, value})` — idempotent upsert into `hivemate_profile_slots`. Returns `{saved, remaining_slots}` so the LLM observes progress in the tool result.
  - `complete_onboarding()` — JS-validates `missing.length === 0`. On success: consolidate slots into `hivemates`, flip `onboarding_state='complete'`, trigger Phase C matching. On failure: return `{ok: false, remaining_slots}` so the LLM keeps asking.
- Required slots: `language`, `role`, `goals`, `consent`. `condition` is OPTIONAL (`ALL_SLOTS` includes it but `REQUIRED_SLOTS` does not) — saved only if the Hivemate volunteers a specific condition; never invented. Free-form prose stored in `profile_json`.
- Turn cap (~8); if still incomplete, escalate to a Hive Keeper to follow up manually.
- `services/language.js`: run `franc-min` over recent user turns; persist `hivemates.language`. Pre-LLM so language stickiness is deterministic.

### Phase C — Peer matching (Day 4) — REDESIGNED (see Progress log + [[memory] project_phase_c_redesign])

The original "one private channel per cohort, auto-invite everyone" model was dropped after user feedback (channel sprawl; dead, intimidating rooms of strangers). New model: **suggest a few real peers + bee-brokered warm intro; the bee stays out of the resulting 1:1.**

- `services/cohorts.js`: `derive(profile) → cohort_key = slugify(condition) + '::' + slugify(role)`. `condition` is OPTIONAL → falls back to `general-wellness`. The `::` separator avoids collisions when slug fields contain hyphens.
- `services/peers.js`: `suggestPeers(cohort_key, excludeUserId, limit=3)` — completed, **consenting** cohort members (minus self), ranked by `last_active_at`, with a **non-clinical** blurb from role/goals. `hasConsented()` is the consent gate.
- `services/matching.js`: `runMatching` derives + persists `cohort_key`, returns `{cohort_key, consented, suggestions}` (no channel). `complete_onboarding` surfaces `suggestions` in its tool result so the bee presents them as `<@user>` mentions and offers an intro. Cold-start: empty suggestions → "you're among the first" message. Keeper ping retained.
- `agent/tools/intro.js`: `request_intro({peer_user_id})` — server-validates the peer is a consenting same-cohort member, DMs the **peer** a heads-up (so it's not a cold message), records the directed intro in the `intros` table, and tells the requester to DM the peer directly. **The bee never joins their 1:1.** No channels, no group DM.
- Hive Keeper assignment: read `app_kv["keeper:{cohort_key}"]` and DM that user that the cohort has a new member.
- `channels`/`memberships` tables + `db/repos/channels.js` are now unused (left in place; `services/channels.js` deleted).

### Phase D — Reminder engine + Honey streaks (Days 5–6)

- `scheduler/index.js` registers cron jobs on startup, after DB migrate.
- `scheduler/reminders.js` per fire:
  1. Round-robin template: `template_id = (count_nudges_for_user) mod TEMPLATES.length`.
  2. `generateMessage` with `prompts/nudge.js`, the template skeleton, profile snippet, language.
  3. `chat.postMessage` into the cohort channel (or DM, configurable).
  4. Insert into `nudge_log` with `template_id`, `kind`, `message`, `ts`.
- Timezone-aware via per-job `timezone` option on `node-cron`. Default falls back to a workspace default in `app_kv` so we don't DM people at 3 AM.
- `agent/tools/checkin.js`: `record_checkin({user_id, kind, content})` — exposed in `message_im.js` mode. On a Hivemate posting "logged my meds 🍯", the bee records it, recomputes streak length in `hivemates`, replies with a fresh on-brand cheer.

### Phase E — Silence detector (Day 7) — REWORKED (DM/check-in activity, not cohort-channel history)

The Phase C redesign removed cohort channels, so the planned `HistoryActivityProvider` (per-cohort-channel `conversations.history`) no longer applies. Activity is derived instead from per-Hivemate signals we already track.

- `services/activity.js`: `lastActiveAt(hivemate)` = `max(last_active_at, last_checkin_at, joined_at)`; `dormantSince(hivemate, thresholdDays, nowSec)` returns the last-active ts if quiet ≥ threshold, else null. Indirection kept so a future RTS/search overlay can slot in (still Deferred).
- `last_active_at` is bumped on every DM turn (`touchActive`) and every check-in (`recordCheckin`); both also **clear** `dormant_since`/`dormancy_notified_at` so a later spell re-pages.
- `scheduler/silence.js` `runSilenceScan` (hourly cron in `scheduler/index.js`): walk completed Hivemates, set `dormant_since` when quiet ≥ threshold (default 3, `dormancy_threshold_days` kv), group newly-dormant (gated by null `dormancy_notified_at`) by keeper, and `services/hivekeeper.js` `sendDormancyDigest` DMs each keeper ONE digest (name + "quiet for N days", no health details). Keeper resolved via `keeper:{cohort_key}` then `default_keeper`. Sets `dormancy_notified_at` after paging.
- (RTS overlay is Deferred — see that section. The "powered by Slack search" required-tech angle now leans entirely on MCP + the activity story, not `conversations.history`.)

### Phase F — MCP, lean in sprint (Day 8)

- `agent/mcp-client.js`:
  - Sprint scope: connect a single hardcoded server (`prog:stdio:./mcp/program-server`). No env-driven multi-server discovery yet.
  - `discoverTools()` returns `[{name: 'mcp__prog__{tool}', description, parameters}]` after sanitizing the tool's JSON Schema (inline `$ref`, drop unsupported `format`, force `additionalProperties: false`, wrap optionals as `nullable: true`).
  - `callTool(name, args)` dispatches and flattens `CallToolResult.content[]` into a single string for the chat-completions `role:'tool'` message. On `isError` or thrown errors, return `JSON.stringify({error: '...'})` so the LLM can recover.
- `mcp/program-server/`: in-repo MCP server exposing two tools — `list_upcoming_sessions()` and `schedule_followup({hivemate_id, when})` — so the bee can answer scheduling questions during the demo. Visible MCP usage = "required tech central."

### Phase G — Polish, demo, submit (Days 9–13)

- Day 9: Safety tools wired everywhere they fire (`escalate_to_hive_keeper` in onboarding + message_im + assistant). Keeper stats tool gated by `keeper:*` membership.
- Day 10: `scripts/seed-demo.js` populates 4 fake Hivemates with varied profiles + `last_active_at` (one dormant) + populated `nudge_log` + `keeper:*` entries. Delete the template demo branches in `listeners/assistant/message.js` (~lines 39–133, the dice / "deep thoughts" scaffolding).
- Day 11: Switch `.env` to `LLM_MODEL=gpt-4o-mini` + real `OPENAI_API_KEY`. Full re-test on OpenAI. Write `README_FOR_JUDGES.md` (one page: how to start a session, exactly what to type for each demo beat, what to expect). Run the safety regression suite (chest pain EN/ES, metformin dose, encouragement, multilingual chest pain) — must still refuse + escalate + log.
  - **Clean up the local-LLM shims (added Day 3 for qwen2.5/Ollama).** Run `grep -rn "LOCAL-LLM-SHIM" agent/` to find them all. To remove: (1) in `agent/llm-caller.js`, collapse the non-streaming tool branch back into one streaming path and delete `stripControlTokens` / `scanBalancedJson` / `extractToolCallsFromText` + the text-recovery fallback; (2) in `agent/tools/profile.js`, drop (or relax) the echoed/placeholder value guard. **Keep** the `MAX_TOOL_ROUNDS` recursion cap — that's sound defensiveness regardless of model. Re-run the onboarding flow after removal to confirm gpt-4o-mini streams tool calls cleanly.
- Day 12: Record <3-minute demo video. Architecture diagram as a PNG (Slack events → Bolt listeners → SQLite + scheduler + LLM via Ollama/OpenAI → MCP server). Invite `slackhack@salesforce.com` and `testing@devpost.com` into the sandbox workspace, the landing channel, and one pre-seeded demo cohort.
- Day 13: Submit on Devpost. Track = Agent for Good. Description includes the impact statement. Video link, architecture diagram, sandbox URL. After submission, all artifacts remain editable until 07-13.

## Per-phase testing documentation (mandatory)

Every sprint day produces a `docs/testing/NN-name.md` file in the repo, committed alongside the code. Written for someone new to Slack app development — assume the reader is the user (now or three weeks from now) wanting to verify the day's feature works end-to-end. Each doc has these required sections:

1. **What this phase delivers** — one paragraph in plain English.
2. **Setup** — what to install, env vars to set, services to start (e.g. `ollama serve`, `npm start`, MCP server). Exact commands.
3. **Test steps** — numbered, with exact Slack actions ("In Slack, open `#hive-landing-test` and type `/invite @nudgerbee`, then press Enter") and exact CLI commands ("`sqlite3 data/nudger-bee.db 'SELECT * FROM hivemates;'`"). Tell the user what to observe at each step.
4. **Expected results** — explicit success criteria: DB rows, log lines, Slack messages, file outputs.
5. **Common failures** — the 3–4 most likely things to go wrong, with how to recover (e.g. "If the bot doesn't reply, check `npm start` logs for `socket_mode` errors; reinstall the app with `slack install` if scopes are missing").
6. **30-second smoke test** — a tiny check to re-run on later days to confirm this feature hasn't regressed. The smoke-test sections combine into the Day 11 full re-test on `gpt-4o-mini`.

Keep each doc under ~1.5 pages. Code examples in fenced blocks. Real channel/user names from the sandbox.

## Submission requirements (Slack Agent Builder Challenge)

Source: live Devpost rules at slackhack.devpost.com. Internal target: **2026-06-14**. Hard deadline: **2026-07-13 @ 5:00 PM PDT**. Track: **Slack Agent for Good**.

Required artifacts on the submission form:

- **Project track selection** ("Slack Agent for Good").
- **Text description** summarizing features and functionality. For this track: *"be sure to explain the impact your Project has!"* Include problem framing (CHWs drowning in coordination, evidence-backed peer support) and an impact statement (target users, expected reach, hours saved per CHW).
- **Demo video < 3 minutes**, hosted **publicly** on YouTube, Vimeo, Facebook Video, or Youku. Must show the project actually working. No third-party trademarks or unlicensed music.
- **Architecture diagram.** Rules require it but don't specify upload vs link — include as a PNG in the submission and as a section in the README.
- **Slack developer sandbox URL** with test access granted to **slackhack@salesforce.com** AND **testing@devpost.com**. Use the user's Slack Developer Program sandbox; invite both emails into the workspace, the configured "hive landing" channel, and one pre-seeded demo cohort so they can exercise the full flow without owner help.
- **Required-tech statement.** Judging explicitly checks for ≥1 of Slack AI / MCP / RTS. The sprint covers **MCP** (Phase F, demo-visible scheduling tool) and "**powered by Slack search**" via `conversations.history` (Phase E). Both must fire *visibly* in the demo video.

Eligibility: 18+, resident of a listed country (USA included). Teams up to four with one Representative.

### Optional: Slack Agents for Organizations track (after 06-14)

Rules permit multiple submissions "if unique and substantially different" but don't explicitly address the same project in multiple tracks. The Organizations track also requires Slack Marketplace submission (or significantly updating an existing Marketplace app) — a separate, heavier review process. **Recommendation:** plan as a sequel after Agent for Good is solid; ask the Devpost organizers directly before dual-submitting the same code.

## Critical files to modify (representative)

- `agent/llm-caller.js` — refactor signature to take `{systemPrompt, tools}`; remove dice import.
- `agent/system-prompt.js` → `agent/prompts/base.js` — keep persona+safety+language as-is; export as `BASE_SYSTEM_PROMPT`.
- `app.js` — run `db/migrate.js`, register `scheduler/index.js`, connect `agent/mcp-client.js` before `app.start()`; teardown on `SIGTERM`.
- `listeners/index.js` — register new `events/message_im.js` and `events/member_joined.js` handlers.
- `listeners/assistant/message.js`, `listeners/events/app_mention.js` — pass `tools: []` to refactored `callLLM`; trim dice scaffolding.
- `manifest.json` — scopes/events/interactivity per Phase A.
- `.slack/config.json` — flip `manifest.source` to `local`.
- `package.json` — add deps + `engines.node`.
- New directories (`db/`, `services/`, `scheduler/`, `mcp/program-server/`, `scripts/`, `docs/testing/`) follow the architecture overview layout.

## Reuse existing utilities (don't reinvent)

- `agent/llm-caller.js` `callLLM(streamer, messages, ...)` — single LLM entry point for streaming.
- `agent/generate.js` `generateMessage(messages, ...)` — single LLM entry point for scheduled (non-streaming) jobs.
- `client.assistant.threads.setStatus({channel_id, thread_ts, status, loading_messages})` — already used at `listeners/assistant/message.js:40` and `listeners/events/app_mention.js:21`. Reuse the loading-message pattern in any new LLM-fronting handler.
- `client.chatStream({channel, recipient_team_id, recipient_user_id, thread_ts, task_display_mode})` — already used at `listeners/assistant/message.js:147` and `listeners/events/app_mention.js:34`. Reuse for any new streaming surface.
- `feedbackBlock` from `listeners/views/feedback_block.js` — append via `streamer.stop({blocks:[feedbackBlock]})`; works once interactivity is enabled in Day 1.
- `client.chat.postEphemeral` — used in `listeners/actions/feedback.js:29`; reuse for keeper inline replies.

## Verification

Aside from the per-day testing docs, run a full end-to-end after each phase on Ollama, then once on `gpt-4o-mini` on Day 11 before submission.

- **Day 1 (Foundation).** `node app.js` boots, `data/nudger-bee.db` is created, @mention still replies (no dice tool loaded). Sandbox shows the bee installed with the new scopes.
- **Day 3 (Onboarding).** Join the landing channel as a test user → bee DMs you → DM through to completion → `hivemates` row has `onboarding_state='complete'`, slots populated, `language` set. Repeat in Spanish; `language='spa'`.
- **Day 4 (Matching).** Two test profiles → same derived `cohort_key` → both invited to one private channel; bee posts a name-only welcome.
- **Day 6 (Reminders + Honey).** Force-fire `scheduler/reminders.js` via `node -e "import('./scheduler/reminders.js').then(m=>m.runOnce(userId))"`. Message lands, `nudge_log` row written, 10 forced fires produce 10 structurally distinct messages. Logging a check-in increments the streak.
- **Day 7 (Silence).** Backdate one Hivemate's `last_active_at` 5 days. Run `scheduler/silence.js` once → keeper digest DM names them; `dormancy_notified_at` set; a second run doesn't re-page.
- **Day 8 (MCP).** Start the MCP server, restart the bee. DM "when's the next session?" → tool call visible as `task_update`; reply uses tool result. Kill server mid-call → graceful error, no crash.
- **Day 9 (Safety).** Chest-pain in EN and ES; metformin dose: refusals continue + `escalate_to_hive_keeper` fires + `nudge_log` row with `kind:'escalation'` exists; keeper receives a DM.
- **Day 11 (OpenAI dry-run).** Repeat the full demo script on `gpt-4o-mini`. Confirm safety still holds.

## Save this plan into the repo

After exiting plan mode, copy `/Users/sravani/.claude/plans/unified-beaming-tome.md` to `docs/PLAN.md` in the repo so it's version-controlled alongside the code. Update it as the sprint progresses (mark days done, log deviations, prune Deferred when an item moves into scope).
