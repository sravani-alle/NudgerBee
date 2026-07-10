/**
 * Nudger Bee — in-repo MCP "program server" (stdio).
 *
 * This is the challenge's required-tech centerpiece: a real Model Context
 * Protocol server the bee connects to as an MCP client. It represents the
 * community program's back office — the calendar of upcoming peer sessions and
 * a follow-up scheduler — things the bee shouldn't hardcode but should *ask a
 * system* for. When a Hivemate asks "when's the next diabetes circle?", the bee
 * calls `list_upcoming_sessions` over MCP; the resulting `task_update` chunk is
 * what makes the required tech visible on camera.
 *
 * Runs as a separate process spawned over stdio by `agent/mcp-client.js`. State
 * is in-memory and deterministic — fine for a demo; a production server would
 * back these with the program's real calendar/CRM.
 *
 * Run standalone (for the testing doc): `node mcp/program-server/index.js`
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

/**
 * Upcoming community sessions. Dates are ISO strings so the bee can reason
 * about them in the user's language/timezone. Kept deterministic for the demo.
 */
const SESSIONS = [
  {
    id: 'sess-diabetes-circle',
    title: 'Type 2 Diabetes Care Circle',
    when: '2026-07-14T18:00:00Z',
    cohort: 'type-2-diabetes::caregiver',
    host: 'Maria (Hive Keeper)',
    format: 'Video call, 45 min',
  },
  {
    id: 'sess-newparent-meetup',
    title: 'New Parent Connect',
    when: '2026-07-15T15:00:00Z',
    cohort: 'general-wellness::new-parent',
    host: 'Community Health team',
    format: 'Video call, 30 min',
  },
  {
    id: 'sess-mindful-mornings',
    title: 'Mindful Mornings (students)',
    when: '2026-07-16T13:00:00Z',
    cohort: 'anxiety::student',
    host: 'Peer facilitator',
    format: 'Audio room, 20 min',
  },
];

const server = new McpServer({ name: 'program-server', version: '0.1.0' });

server.registerTool(
  'list_upcoming_sessions',
  {
    title: 'List upcoming sessions',
    description:
      "List the community program's upcoming peer support sessions (title, date/time in UTC, which cohort, host, format). Call this whenever a Hivemate asks what's coming up, when the next session/circle/meetup is, or what they could join.",
    inputSchema: {
      cohort: z
        .string()
        .describe("Optional cohort key to filter by, e.g. 'type-2-diabetes::caregiver'. Omit to list all sessions.")
        .optional(),
    },
  },
  async ({ cohort }) => {
    const sessions = cohort ? SESSIONS.filter((s) => s.cohort === cohort) : SESSIONS;
    return { content: [{ type: 'text', text: JSON.stringify({ count: sessions.length, sessions }, null, 2) }] };
  },
);

server.registerTool(
  'schedule_followup',
  {
    title: 'Schedule a follow-up',
    description:
      'Schedule a follow-up touchpoint for a Hivemate with the program (e.g. a keeper call or a reminder to revisit a goal). Use when a Hivemate asks to be followed up with, or to book a next check-in at a specific time.',
    inputSchema: {
      hivemate_id: z.string().describe('The Slack user id of the Hivemate to follow up with, e.g. "U07ABC123".'),
      when: z
        .string()
        .describe(
          'When to follow up, in the Hivemate\'s words or ISO — e.g. "next Tuesday 10am" or "2026-07-18T14:00:00Z".',
        ),
      note: z.string().describe('Optional short reason/context for the follow-up.').optional(),
    },
  },
  async ({ hivemate_id, when, note }) => {
    // Deterministic confirmation id from the inputs (no clock/random — keeps the
    // demo reproducible and the server pure).
    const confirmation = `FU-${hivemate_id.slice(-4).toUpperCase()}-${when.replace(/[^0-9A-Za-z]/g, '').slice(0, 8) || 'TBD'}`;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              scheduled: true,
              confirmation,
              hivemate_id,
              when,
              note: note ?? null,
              message: `Follow-up booked for ${hivemate_id} at "${when}" (ref ${confirmation}).`,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// NB: no console.log here — stdout is the MCP transport; logging goes to stderr.
console.error('[program-server] MCP stdio server ready');
