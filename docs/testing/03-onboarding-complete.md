# Day 3 — Onboarding part 2: completion + language detection: how to test

## What this phase delivers

Onboarding now **finishes**. Once the bee has saved every required slot
(`language`, `condition`, `role`, `goals`, `consent`), it calls a new
`complete_onboarding` tool that validates the profile server-side, consolidates
the slots into the Hivemate's row, and flips `onboarding_state` to `complete`.
After that, the bee drops out of onboarding mode for that person.

It also speaks the **right language deterministically**. Before the model ever
runs, JS detects the language of the Hivemate's own recent messages with
`franc-min` and stores the ISO 639-3 code on `hivemates.language`. Language is
never the model's job — it's sticky and visible in the DB, ready for the nudges
and keeper digests built in later days.

New / changed pieces:

- `agent/tools/profile.js` — adds `complete_onboarding`. It re-checks the slot
  list (the slot list is the source of truth, **not** the LLM); if anything is
  missing it returns `{ok: false, remaining_slots}` so the bee keeps asking.
- `db/repos/hivemates.js` — `completeOnboarding(userId, profile)` consolidates
  the slots into `profile_json` and sets `onboarding_state='complete'`.
- `services/language.js` — language resolution: the stated `language` slot is
  authoritative (`languageNameToCode`), with `franc-min` as a fallback before a
  preference is captured (constrained to the supported languages, length-gated).
- `services/dm-turn.js` — shared `prepareHivemateTurn` used by **both** DM
  surfaces so onboarding behaves identically.
- `agent/prompts/onboarding.js` — instructs the bee to call `complete_onboarding`
  once all slots are filled.

**DM-routing fix (important).** This app has the Slack **Assistant** feature
enabled, so Hivemate DMs are routed through the Assistant container, handled by
`listeners/assistant/message.js` — **not** `message_im.js`. Day 3 moved the
onboarding logic there (and made `assistant_thread_started` post the welcome +
first language question). `member_joined.js` now posts only a short "open our
chat" pointer so the language question isn't asked twice. If you onboarded
before this fix and the bee chatted but never saved a slot, that's why.

**Day 3 does NOT yet** create the peer cohort channel. `complete_onboarding`
exposes an `onComplete` hook, but wiring it to channel creation is Day 4
(Phase C). For now, completion just finalizes the profile.

## Setup

Same as Day 2 — you need the landing channel configured and the bot running.

1. Make sure `ollama serve` is running and `qwen2.5:14b` is pulled (or set
   `LLM_MODEL=gpt-4o-mini` + `OPENAI_API_KEY` for a more reliable run).
2. Confirm the landing channel is set (from Day 2):

   ```bash
   sqlite3 data/nudger-bee.db "SELECT v FROM app_kv WHERE k='landing_channel';"
   ```

3. **Supported languages.** The detector is locked to English + Spanish by
   default — this is deliberate, because `franc-min` will otherwise misread a
   short English sentence as something exotic. To widen it, set
   `HIVE_LANGUAGES` (comma-separated ISO 639-3 codes) before starting:

   ```bash
   export HIVE_LANGUAGES="eng,spa,por"   # optional; default is "eng,spa"
   ```

   Keep the set tight — every extra language is a fresh chance for a
   near-neighbor misdetection on short messages.

4. Start the bot:

   ```bash
   slack run
   ```

## Test steps

### A. Full English onboarding to completion

1. In the sandbox, click **Nudger Bee** in the sidebar to open the chat. The
   Assistant pane opens and the bee welcomes you and asks about your **language**
   (this comes from `assistant_thread_started`). If you joined via the landing
   channel you'll also see a short "open our chat" pointer above it.
2. Reply: `English works great for me, thanks!`
   - In Slack you'll see a `Saving language...` task chunk.
3. Continue answering one field at a time. Suggested answers:
   - condition → `Type 2 diabetes`
   - role → `single parent`
   - goals → `stay accountable about taking my meds`
   - consent → `yes, match me with a small group`
4. After the **last** slot, watch for a `Finalizing your Hive profile...` task
   chunk, then a warm wrap-up message (something like *"You're all set — a peer
   cohort will be in touch soon! 🐝"*). The bee should stop asking questions.
5. Verify in the DB:

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, onboarding_state, language FROM hivemates;"
   ```

   Expected: `onboarding_state = complete`, `language = eng`.

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, json_extract(profile_json,'\$.condition') AS condition,
             json_extract(profile_json,'\$.consent') AS consent
      FROM hivemates WHERE onboarding_state='complete';"
   ```

   Expected: `profile_json` holds all five slots (so `condition` and `consent`
   come back non-empty).

6. **Post-completion check:** DM the bot again, e.g. `thanks!`. It should reply
   in normal assistant voice and **not** re-ask onboarding questions, because
   `onboarding_state` is now `complete`.

### B. Full Spanish onboarding (language detection)

Use a **second** test user for a clean run (or reset the first — see below).

1. Open the bee chat as the Spanish test user and reply in Spanish:
   `Hola, prefiero que hablemos en español` (a full sentence — franc needs ~24+
   characters of real signal, and short phrases just keep the English default
   until you confirm the language slot).
2. The bee should reply **in Spanish** and walk the same five slots in Spanish.
   Answer in Spanish (`Diabetes tipo 2`, `madre soltera`, `sí`, etc.). When you
   answer the language question (e.g. `Español`), that stated preference is what
   pins `language = spa` — it doesn't rely on guessing from your prose.
3. After the last slot it calls `complete_onboarding` and wraps up in Spanish.
4. Verify the language was detected and stored:

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slack_user_id, onboarding_state, language FROM hivemates;"
   ```

   Expected: the Spanish user's row shows `language = spa`,
   `onboarding_state = complete`.

> Note: the `language` **slot** stores the human phrase the user said
> (e.g. `Español`), while the `language` **column** stores the ISO code (`spa`)
> from the detector. They are intentionally different things.

### C. Completion can't be faked (server-side validation)

This proves JS owns the slot list. Reset a user to mid-onboarding:

```bash
sqlite3 data/nudger-bee.db \
  "UPDATE hivemates SET onboarding_state='in_progress', profile_json='{}' WHERE slack_user_id='Uxxxx';
   DELETE FROM hivemate_profile_slots WHERE slack_user_id='Uxxxx' AND slot_name IN ('goals','consent');"
```

(Replace `Uxxxx` with your user id.) Now DM the bot `are we done?`. Even if the
model tries to wrap up, `complete_onboarding` will return `remaining_slots`, the
task chunk shows an error like *"Not done yet — still missing: goals, consent"*,
and the bee goes back to asking. `onboarding_state` stays `in_progress`.

## Expected results

- Completing all five slots produces a `Finalizing your Hive profile...` chunk
  and flips `hivemates.onboarding_state` to `complete`.
- `profile_json` contains all five slot values as JSON.
- An English conversation stores `language = eng`; a Spanish one stores `spa`.
- Calling `complete_onboarding` with missing slots fails and the bee resumes
  asking — it cannot be talked into finishing early.
- After completion, further DMs are handled in normal assistant mode (no
  onboarding questions).
- The safety guardrails still hold in both languages (chest pain, dosing, etc.
  → no clinical advice, route to a human).

## Common failures and how to recover

1. **Language stored as the wrong code.**
   The stated `language` slot is what pins the language, so make sure the bee
   actually saved it (check `hivemate_profile_slots`). The franc fallback only
   runs before that slot exists and is deliberately conservative — short or
   ambiguous messages keep the English default rather than risk a wrong flip
   (franc misreads short English as Spanish). Widening `HIVE_LANGUAGES` too far
   also hurts accuracy; keep it tight.

2. **Bee finishes the questions but never calls `complete_onboarding`.**
   The local `qwen2.5:14b` can skip the final tool call. Nudge it: `I think
   that's everything — am I all set?`. If it still won't, switch to
   `gpt-4o-mini` to confirm the wiring (the Day 11 dry-run does this anyway).

3. **`onboarding_state` won't flip to `complete`.**
   Check `slack run` logs for the `complete_onboarding` tool result. If it shows
   `remaining_slots`, a slot genuinely isn't saved — inspect:

   ```bash
   sqlite3 -header -column data/nudger-bee.db \
     "SELECT slot_name, value FROM hivemate_profile_slots WHERE slack_user_id='Uxxxx';"
   ```

4. **Bee keeps re-onboarding a finished user.** Confirm the row really is
   `complete` (step A.5). If it is and the bee still asks, the DM handler isn't
   reading the latest state — restart `slack run`.

## 30-second smoke test

```bash
# 1) At least one Hivemate has fully completed onboarding
sqlite3 data/nudger-bee.db \
  "SELECT COUNT(*) FROM hivemates WHERE onboarding_state='complete';"
# Expect: >= 1

# 2) Completed rows carry a real language code and a populated profile
sqlite3 -header -column data/nudger-bee.db \
  "SELECT slack_user_id, language, length(profile_json) AS profile_len
   FROM hivemates WHERE onboarding_state='complete';"
# Expect: language is 'eng'/'spa' (not the default placeholder) and profile_len > 2
```

```bash
# 3) The language detector itself is sane (no Slack needed)
node -e "import('./services/language.js').then(m=>{
  console.log(m.detectLanguage('I want to stay accountable with my meds'));  // eng
  console.log(m.detectLanguage('Quiero mantenerme responsable con mi diabetes')); // spa
  console.log(m.detectLanguage('hi')); // null
})"
```

If these pass, Day 3's completion + language detection is intact.
