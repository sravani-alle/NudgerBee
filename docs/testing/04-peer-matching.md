# Day 4 — Peer matching (Phase C): how to test

> **Redesigned.** Matching no longer creates a channel per cohort and dumps
> everyone in. Instead it hands the newcomer a **short list of peers** in a
> similar situation, and the bee can make a **warm 1:1 introduction** — sending
> the peer a heads-up so it isn't a cold message, then letting the two talk in
> their own private DM. **The bee never joins that conversation.**

## What this phase delivers

When a Hivemate finishes onboarding (`complete_onboarding` succeeds), the bee:

1. Derives a `cohort_key` from their profile — `slugify(condition)::slugify(role)`.
   `condition` is optional now; without one it's `general-wellness` (so a
   "single parent focused on staying healthy" lands in
   `general-wellness::single-parent`).
2. Builds a **shortlist** (≤3) of *consenting*, onboarded peers in that cohort,
   ranked by most-recently-active, each with a **non-clinical** one-line blurb
   (from role/goals — never their condition).
3. Returns those in the `complete_onboarding` tool result so the bee warmly
   presents them (as `<@user>` mentions) and offers to introduce one.
4. Pings the cohort's Hive Keeper (if `app_kv["keeper:{cohort_key}"]` is set).

Then, in normal DM chat, the Hivemate can say "introduce me to @maria" and the
bee calls **`request_intro`**: it validates @maria is a consenting cohort peer,
DMs *her* a heads-up, records the intro, and tells the newcomer they can DM her
directly. No channels, no group DM, bee not in the loop.

New/changed pieces: `services/cohorts.js` (condition optional), `services/peers.js`
(`suggestPeers`, `hasConsented`, blurbs), `services/matching.js` (rewritten —
returns suggestions, no channel), `agent/tools/intro.js` (`request_intro`),
`db/repos/intros.js` + `intros` table. `services/channels.js` was removed.

## Setup

1. Bot running; you'll need **two** test users so there's someone to suggest.
2. Both users should onboard with the **same role** (e.g. "single parent") so
   they land in the same cohort, and both must **consent** ("yes") when asked
   about being matched.
3. (Optional) assign a Hive Keeper to see the keeper ping — set
   `app_kv["keeper:{cohort_key}"]` to a user id (derive the key first, step C).

## Test steps

### A. First Hivemate — cold start (no peers yet)

1. Onboard user #1 to completion (consent = yes).
2. The bee should finish onboarding and say something like *"You're among the
   first here — I'll connect you as soon as a good match joins."* (No channel is
   created.)
3. Verify the cohort was set and no channel exists:

   ```bash
   sqlite3 -header -column data/nudger-bee.db "SELECT slack_user_id, cohort_key FROM hivemates WHERE onboarding_state='complete';"
   sqlite3 -header -column data/nudger-bee.db "SELECT COUNT(*) AS channels FROM channels;"
   ```

   Expected: user #1 has a `cohort_key`; `channels = 0`.

### B. Second Hivemate — gets a suggestion

1. Onboard user #2 with the **same role** and consent = yes.
2. On completion, the bee should present user #1 as a suggested peer — e.g.
   *"You're not alone! @user1 is also a single parent working on staying
   healthy. Want me to introduce you?"*

### C. Warm introduction (the key flow)

1. As user #2, reply: `Yes, please introduce me to @user1`.
2. Expected: a `Making a warm introduction 🐝...` task chunk, then the bee
   confirms — *"Heads-up sent! You can DM @user1 whenever you're ready."*
3. **User #1 receives a heads-up DM** from the bee: *"A fellow Hivemate, @user2
   (also a single parent…), is in a similar situation and would love to
   connect…"*. The bee is **not** in any shared conversation.
4. Verify:

   ```bash
   sqlite3 -header -column data/nudger-bee.db "SELECT requester_user_id, peer_user_id, cohort_key FROM intros;"
   ```

   Expected: one row, user #2 → user #1.

### D. Guardrails

- Ask to be introduced to someone who **didn't consent** (or isn't in your
  cohort): the bee declines gracefully — nothing is sent, no `intros` row.
- Ask for the **same** intro twice: the second time the bee says you're already
  connected (no duplicate heads-up, no second `intros` row).

## Expected results

- Completing onboarding sets `cohort_key`, creates **no channel**, and surfaces
  a peer shortlist (or a kind cold-start message when alone).
- Only **consenting** peers are ever suggested or introduced; blurbs and the
  heads-up contain **no health details**.
- `request_intro` sends exactly one heads-up DM to the peer and writes one
  `intros` row; the two Hivemates converse privately with the bee absent.
- A configured Hive Keeper gets a DM that a new member joined.

## Common failures and how to recover

1. **No suggestions on completion.** Either you're the first in the cohort
   (expected — cold start), the other peer didn't **consent**, or they're in a
   different cohort (different role/condition). Check:
   `sqlite3 data/nudger-bee.db "SELECT slack_user_id, cohort_key FROM hivemates;"`
   and their consent slot in `hivemate_profile_slots`.
2. **Intro "isn't an available match".** The target isn't a consenting,
   completed member of your cohort (or the model passed a wrong id). This is the
   server-side guard doing its job — pick someone from the suggested list.
3. **Bee tries to give medical advice / saves a condition you didn't state.**
   Condition is optional now and the prompt forbids inventing one; on local qwen
   it can still slip — verify on gpt-4o-mini.
4. **`request_intro` did nothing.** The intro tool needs the Slack client; it's
   only attached in live DM handling (not in offline scripts).

## 30-second smoke test

```bash
# Matching wired, no channels, intros recorded
sqlite3 -header -column data/nudger-bee.db \
  "SELECT (SELECT COUNT(*) FROM hivemates WHERE cohort_key IS NOT NULL) AS matched,
          (SELECT COUNT(*) FROM channels) AS channels,
          (SELECT COUNT(*) FROM intros) AS intros;"
# Expect: matched >= 1, channels = 0 (no new ones), intros >= 1 after a test intro
```

```bash
# Cohort derivation handles a missing condition (no Slack needed)
node -e "import('./services/cohorts.js').then(m=>console.log(m.derive({role:'single parent'})))"
# Expect: general-wellness::single-parent
```
