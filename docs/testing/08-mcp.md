# Day 8 — MCP (program server) testing

## What this phase delivers

The bee now connects to a real **Model Context Protocol** server as an MCP
client — the challenge's required-tech centerpiece. The in-repo *program server*
(`mcp/program-server/index.js`) represents the community program's back office
and exposes two tools: `list_upcoming_sessions` (the calendar of peer sessions)
and `schedule_followup` (book a follow-up touchpoint). At startup the bee spawns
the server over stdio, discovers its tools, sanitizes their JSON Schema for the
Chat Completions API, and namespaces them as `mcp__prog__*`. When an onboarded
Hivemate asks "when's the next diabetes circle?", the model calls the MCP tool
and a **`task_update` chunk fires on screen** — that's the visible required tech.
If the server can't start, the bee logs a warning and runs without MCP (no crash).

## Setup

No new dependencies (`@modelcontextprotocol/sdk` + `zod` were already installed).

```bash
# From the repo root:
ollama serve                 # or set LLM_MODEL=gpt-4o-mini + OPENAI_API_KEY
npm start                    # app.js connects the MCP server automatically
```

You do NOT start the MCP server yourself — `app.js` spawns it. To run it
standalone for inspection: `node mcp/program-server/index.js` (it prints
`[program-server] MCP stdio server ready` to **stderr** and then waits on stdin).

## Test steps

1. **Headless round-trip (no Slack, no LLM)** — proves the client↔server link:
   ```bash
   node --input-type=module -e '
   import { connectMcp, getMcpTools, disconnectMcp } from "./agent/mcp-client.js";
   await connectMcp();
   for (const t of getMcpTools()) console.log(t.definition.function.name);
   const call = getMcpTools().find(t => t.definition.function.name === "mcp__prog__list_upcoming_sessions");
   console.log(await call.execute({ cohort: "type-2-diabetes::caregiver" }));
   await disconnectMcp();
   '
   ```
2. **Startup log** — run `npm start` and watch for:
   `[mcp] connected to program-server — 2 tools: list_upcoming_sessions, schedule_followup`
3. **Live in Slack (after onboarding)** — DM the bee as an onboarded Hivemate:
   `when's the next session for my group?` → the bee should call
   `mcp__prog__list_upcoming_sessions` and answer with the real session details.
4. **Schedule beat** — DM: `can you set a follow-up for me next Tuesday?` → the
   bee calls `mcp__prog__schedule_followup` and reports the confirmation ref.
5. **Failure grace** — while the bee is running, it owns the child process; to
   see the recovery path, temporarily rename the server file and restart: the
   startup log shows `[mcp] connect failed, continuing without MCP: …` and the
   bee still answers normally (just without session data).

## Expected results

- Round-trip (step 1) prints both `mcp__prog__*` tool names and a JSON payload
  with the `Type 2 Diabetes Care Circle` session.
- Slack: a **`task_update`** chunk titled *"Asking the program server (MCP): list
  upcoming sessions…"* appears, then flips to *"Checked the program server
  (MCP): list upcoming sessions"* — this is the on-camera required-tech moment.
- `schedule_followup` returns a deterministic ref like `FU-ROSA-20260718`.
- Invalid args come back to the model as `{ "error": "MCP error -32602 …" }`
  (the model apologizes / re-asks) — the turn never throws.

## Common failures

- **`[mcp] connect failed …` at startup** — the server file couldn't be spawned.
  Check `node mcp/program-server/index.js` runs standalone; confirm `process.execPath`
  is a Node ≥22. The bee still runs, just without MCP tools.
- **Tools discovered but the model never calls them** — a weak local model may
  not pick the tool. Ask more explicitly ("use the program server to…") or test
  on `gpt-4o-mini`. Tool-enabled turns already run non-streaming (Day 3 shim).
- **`task_update` chunk not visible** — interactivity/Assistant surface must be
  enabled (Day 1). The chunk renders in the Assistant pane, not a plain DM.
- **Stray server text corrupts output** — never `console.log` in the server;
  stdout IS the MCP transport. Logs must go to stderr (`console.error`).

## 30-second smoke test

```bash
node --input-type=module -e '
import { connectMcp, getMcpTools, disconnectMcp } from "./agent/mcp-client.js";
const t = await connectMcp();
console.log(t.length === 2 ? "✅ 2 MCP tools" : "❌ expected 2 tools, got " + t.length);
await disconnectMcp();
'
```
Expect `✅ 2 MCP tools`. This confirms the server spawns, the handshake completes,
and both tools are discovered — the whole MCP path in one line.
