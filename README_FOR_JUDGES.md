# Nudger Bee 🐝 — Judge's Guide

**Slack Agent Builder Challenge · Track: Slack Agent for Good**

**Sandbox:** https://nudgerbee101.slack.com · **Repo:** https://github.com/sravz3/NudgerBee

---

## What it is (30 seconds)

Community Health Workers (CHWs) supporting chronic-illness patients drown in
manual coordination — spreadsheets of who to check on, WhatsApp groups, "who's
gone quiet?" run from memory. A CHW with ~80 patients can lose **6–8 hours a
week** to it.

**Nudger Bee** is a Slack agent that takes that load off. It profiles new
community members ("Hivemates"), warmly introduces them to a peer in a similar
situation, runs personality-filled accountability nudges and tracks check-in
streaks ("Honey" 🍯), and — the part CHWs feel most — quietly watches for people
who go silent and hands their **Hive Keeper** (the CHW) a single "reach out to
these folks" digest. And it stays firmly in its lane: **a coordinator, never a
clinician** — anything clinical is refused and escalated to a human.

**Required tech (central & visible):** the bee is an **MCP client**. It connects
to an in-repo **Model Context Protocol** server for the program's session
calendar and follow-up scheduling. You'll watch the MCP call happen on screen in
Beat 4 below (the `task_update` step).

---

## Before you start (host pre-flight — already done for this sandbox)

You (the judge) don't need to run anything. The bee is deployed and running 24/7,
and the workspace is pre-seeded with a small demo hive (four Hivemates, one
already gone quiet) so the Hive Keeper view has data.

**To talk to the bee:** in the sandbox **https://nudgerbee101.slack.com**, click
**Nudger Bee** in the left sidebar (or under Apps). This opens its **assistant
pane** — that's where you chat with it. Everything below is typed there.

> Note: the bee runs on a free host that sleeps when idle. If your very first
> message seems ignored, wait ~1 minute and resend — the host was waking up.

---

## The demo, beat by beat (≈2 minutes)

Type each line to the bee and watch for the result. Natural phrasing works — you
don't need exact wording.

### Beat 1 — Onboarding (a warm, conversational profile)
> **You type:** `hi` → then answer its questions naturally, e.g.
> `I speak English`, `I'm a caregiver for my mom`, `I want to check her blood sugar daily`, `yes, happy to be matched with peers`

**Expect:** the bee greets you as a new Hivemate and asks one thing at a time
(language, your role, your goal, consent to peer-matching). It's genuinely
conversational, not a form. When it has what it needs it wraps up and moves to
matching. *(It asks about a health condition only if you volunteer one — never
invents it.)*

### Beat 2 — Peer suggestion + warm 1:1 intro
**Expect:** right after onboarding, the bee suggests a real peer from the same
cohort (shown as an `@mention`) with a short, non-clinical blurb, and offers to
introduce you.
> **You type:** `yes, please introduce me`

**Expect:** the bee sends *that peer* a private heads-up so they aren't
cold-messaged, then tells you to DM them directly. **The bee does not join your
1:1** — it brokers the connection and steps out. (No dead group channels.)

### Beat 3 — Check-in + Honey streak 🍯
> **You type:** `logged mom's blood sugar today ✅`

**Expect:** the bee records the check-in and cheers you on with your **Honey
streak** count — and its phrasing varies each time (no repeated nudges).

### Beat 4 — Scheduling question ⚙️ **(MCP — required tech, visible)**
> **You type:** `when's the next session for my group?`

**Expect:** a **task step appears on screen** — *"Asking the program server
(MCP): list upcoming sessions…"* — then the bee answers with the real session
(title, date, host) it fetched **over MCP**. This is the required-tech moment.
> **Optional:** `can you book me a follow-up next Tuesday?` → a second MCP tool
> (`schedule_followup`) fires and returns a confirmation reference.

### Beat 5 — Safety 🚑 **(the differentiator)**
> **You type:** `I've been having chest pain, what should I do?`

**Expect:** the bee **does not give medical advice**. It responds with warmth,
tells you to contact your care provider / emergency services, and **escalates to
a human** — a task step *"Alerting a Hive Keeper — urgent 🚨"* fires, the Hive
Keeper gets a DM, and the escalation is logged. Try it in Spanish too —
`me duele el pecho` — the guardrail holds in every language. Also try a
medication question (`should I double my metformin?`): declined + escalated as
routine.

### Beat 6 — The Hive Keeper's view 👀 *(silence detection + overview)*
This is what saves the CHW their week. It's **keeper-gated**, so it's shown from
the Hive Keeper account (**@Maria (Keeper)**) in the demo video — a regular
Hivemate account doesn't get these tools. What it does:
- **Overview:** the keeper asks `how are my Hivemates doing? who's gone quiet?`
  → the bee calls `hive_stats` and summarizes totals, who's **dormant** and for
  how long, and the top Honey streaks.
- **The digest:** the bee's hourly silence scan DMs the keeper a single grouped
  "these people have gone quiet — a gentle hello might help" digest, paging each
  person only once per quiet spell.

*Want to try the keeper view live? Ask the owner to add your account as a Hive
Keeper (`app_kv` `default_keeper`) and it works from your account too.*

---

## Under the hood (for the "is the tech central?" line)

```
Slack (Assistant pane, events, DMs)
   │
Bolt listeners ── services/dm-turn ──▶ agent/llm-caller (tool-calling loop)
   │                                        │
   │                        native tools ◀──┤──▶ MCP client ──stdio──▶ program-server (MCP)
   │                     (onboarding,        │                          • list_upcoming_sessions
   │                      check-in, intro,   │                          • schedule_followup
   │                      escalate, stats)   │
SQLite (better-sqlite3) ◀───────────────────┘
node-cron: daily nudges + hourly silence scan
LLM: OpenAI-compatible (gpt-4o-mini for submission; local Ollama for dev)
```

- **MCP** is a real client↔server link over stdio; every call renders a visible
  `task_update` step in Slack.
- **Safety** isn't just a refusal string — each escalation writes a `nudge_log`
  row (`kind:'escalation'`) and DMs a real person, so the safety story is in the
  data.

---

## If something misbehaves

- **First message is slow (~1 min):** the bee is hosted on a free tier that
  sleeps when idle. If your very first message seems ignored, wait ~1 minute and
  send it again — the host was waking up. It stays responsive after that.
- **Bee doesn't reply:** make sure you're typing in the **Nudger Bee assistant
  pane** (sidebar), not a random channel. Give it a second — it streams.
- **No peer suggestion after onboarding:** you may be the first in your cohort
  ("you're among the first" is expected); the pre-seeded hive has peers for the
  caregiver cohort.
- **A tool step shows an error:** the bee is built to recover — it'll tell you in
  plain language rather than crash.

**Questions / access:** Sravani (Nudger Bee) · Repo:
https://github.com/sravz3/NudgerBee · Sandbox: https://nudgerbee101.slack.com
_(add your preferred contact email here before submitting)_
