# Nudger Bee — Architecture

Render this to a PNG for the submission (see instructions at the bottom).

```mermaid
flowchart TB
    subgraph Slack["🟣 Slack (Sandbox Workspace)"]
        U["Hivemate / Hive Keeper<br/>(Assistant pane · DMs · @mentions)"]
    end

    subgraph App["🐝 Nudger Bee (Bolt · Socket Mode)"]
        direction TB
        L["Listeners<br/>assistant/message · app_mention<br/>member_joined · feedback"]
        DT["services/dm-turn<br/><i>prepareHivemateTurn</i><br/>routes: onboarding · Hivemate · Keeper"]
        LLM["agent/llm-caller<br/><i>callLLM tool loop</i><br/>+ output guard (mention → name)"]

        subgraph Tools["Agent Tools"]
            direction LR
            T1["profile<br/>(onboarding)"]
            T2["checkin<br/>(Honey streak)"]
            T3["intro<br/>(warm peer intro)"]
            T4["safety<br/>(escalate)"]
            T5["keeper<br/>(hive_stats)"]
        end

        subgraph Sched["scheduler (node-cron)"]
            direction LR
            R["reminders<br/>(daily nudges)"]
            S["silence<br/>(hourly dormancy scan)"]
        end
    end

    subgraph MCP["⚙️ MCP Program Server (stdio) — required tech"]
        M1["list_upcoming_sessions"]
        M2["schedule_followup"]
    end

    DB[("SQLite · better-sqlite3<br/>hivemates · slots · checkins<br/>nudge_log · intros · app_kv")]
    AI["LLM (OpenAI-compatible)<br/>gpt-4o-mini · local Ollama for dev"]

    U <-->|events / streamed replies| L
    L --> DT
    DT --> LLM
    LLM <--> Tools
    LLM <-->|chat + tool calls| AI
    LLM <-->|mcp__prog__* tools<br/>task_update on screen| MCP
    Tools <--> DB
    Sched --> DB
    S -->|dormancy digest DM| U
    R -->|nudge DM| U
    T4 -->|escalation DM| U

    classDef req fill:#ffe9b3,stroke:#d99b00,stroke-width:2px;
    class MCP,M1,M2 req;
```

## What the judges should notice
- **MCP is a real client↔server link** (stdio). Every call renders a visible `task_update` step in Slack — the required-tech moment.
- **Safety is first-class**: `escalate_to_hive_keeper` DMs a human *and* writes a `nudge_log` row (`kind:'escalation'`), so the safety story lives in the data.
- **The bee stays a coordinator, never a clinician** — clinical questions are refused + escalated in any language.

## How to export this to a PNG
1. Open <https://mermaid.live>.
2. Paste everything between the ```` ```mermaid ```` fences above.
3. **Actions → PNG** (or SVG) → save as `docs/architecture.png`.
4. Attach that PNG to the Devpost submission and drop it in the README.

(GitHub also renders this diagram inline in the repo automatically.)
