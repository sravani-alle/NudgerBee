/**
 * MCP client — connects the bee to the in-repo program server over stdio,
 * discovers its tools, and adapts them into `BeeTool`s the LLM loop can call
 * exactly like a native tool. When the model calls one, `callLLM` emits a
 * `task_update` chunk (agent/llm-caller.js) — that's the required tech, visible.
 *
 * Sprint scope (see docs/PLAN.md Phase F): exactly ONE hardcoded server. The
 * multi-server / env-driven discovery layer is Deferred. The design pillars we
 * DO keep: namespaced tool names (`mcp__prog__{tool}`), JSON-Schema
 * sanitization for the chat-completions API, and flattened tool results.
 *
 * Connection is best-effort: if the server can't start, `getMcpTools()` returns
 * [] and the bee runs without MCP rather than crashing.
 */

import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '..', 'mcp', 'program-server', 'index.js');
const NAMESPACE = 'prog';

/** @type {Client | null} */
let client = null;
/** @type {import('./llm-caller.js').BeeTool[]} */
let cachedTools = [];

/**
 * Flatten an MCP `CallToolResult.content[]` into a single string for the
 * chat-completions `role:'tool'` message (which takes plain text, not parts).
 * @param {Array<{ type: string, text?: string }>} content
 * @returns {string}
 */
function flattenContent(content) {
  return (content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join('\n')
    .trim();
}

/**
 * Sanitize a tool's JSON Schema into the conservative subset the Chat
 * Completions function-calling API accepts. Best-effort and defensive so an
 * arbitrary server's schema can't break a turn:
 *   - inline local `$ref`s against `$defs`/`definitions`
 *   - drop unsupported keywords (`format`, `$schema`, `$id`)
 *   - force `additionalProperties: false` on objects
 *
 * @param {any} schema - the server-provided inputSchema (may be undefined)
 * @returns {any} a chat-completions-safe JSON Schema object
 */
export function sanitizeSchema(schema) {
  const root = schema && typeof schema === 'object' ? schema : { type: 'object', properties: {} };
  const defs = root.$defs || root.definitions || {};

  const seen = new WeakSet();
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    if (seen.has(node)) return node;
    seen.add(node);

    // Inline a local $ref, e.g. "#/$defs/Foo".
    if (typeof node.$ref === 'string') {
      const key = node.$ref.split('/').pop();
      if (key && defs[key]) return walk({ ...defs[key] });
    }

    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'format' || k === '$schema' || k === '$id' || k === '$defs' || k === 'definitions') continue;
      out[k] = walk(v);
    }
    if (out.type === 'object' || out.properties) {
      out.type = out.type || 'object';
      out.properties = out.properties || {};
      out.additionalProperties = false;
    }
    return out;
  };

  const clean = walk(root);
  clean.type = clean.type || 'object';
  clean.properties = clean.properties || {};
  clean.additionalProperties = false;
  return clean;
}

/**
 * Adapt one discovered MCP tool into a BeeTool. The LLM sees the namespaced
 * name; `execute` dispatches back to the real tool name over MCP and flattens
 * the result. Errors (transport, `isError`) come back as `{error}` so the model
 * can recover conversationally instead of the turn throwing.
 *
 * @param {{ name: string, description?: string, inputSchema?: any }} tool
 * @returns {import('./llm-caller.js').BeeTool}
 */
function toBeeTool(tool) {
  const namespaced = `mcp__${NAMESPACE}__${tool.name}`;
  const pretty = tool.name.replace(/_/g, ' ');
  return {
    definition: {
      type: 'function',
      function: {
        name: namespaced,
        description: `[program server] ${tool.description ?? tool.name}`,
        parameters: sanitizeSchema(tool.inputSchema),
      },
    },
    execute: async (args) => {
      if (!client) return { error: 'The program server is unavailable right now.' };
      try {
        const res = await client.callTool({ name: tool.name, arguments: args ?? {} });
        const text = flattenContent(/** @type {any} */ (res).content);
        if (/** @type {any} */ (res).isError) return { error: text || `${tool.name} failed.` };
        return { description: `Checked the program server (MCP): ${pretty}`, result: text };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    getTaskTitle: () => `Asking the program server (MCP): ${pretty}…`,
  };
}

/**
 * Connect to the in-repo program server and cache its tools as BeeTools.
 * Idempotent and best-effort. Call once at startup (app.js).
 *
 * @param {{ logger?: { info?: Function, warn?: Function } }} [opts]
 * @returns {Promise<import('./llm-caller.js').BeeTool[]>}
 */
export async function connectMcp({ logger = console } = {}) {
  if (client) return cachedTools;
  try {
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH] });
    client = new Client({ name: 'nudger-bee', version: '0.1.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    cachedTools = tools.map(toBeeTool);
    logger.info?.(
      `[mcp] connected to program-server — ${cachedTools.length} tools: ${tools.map((t) => t.name).join(', ')}`,
    );
  } catch (e) {
    logger.warn?.(`[mcp] connect failed, continuing without MCP: ${e instanceof Error ? e.message : e}`);
    client = null;
    cachedTools = [];
  }
  return cachedTools;
}

/**
 * The connected MCP tools as BeeTools (empty until/unless connected). Synchronous
 * so per-turn tool assembly (services/dm-turn.js) can splice them in.
 * @returns {import('./llm-caller.js').BeeTool[]}
 */
export function getMcpTools() {
  return cachedTools;
}

/** Tear down the MCP connection (SIGTERM). */
export async function disconnectMcp() {
  try {
    await client?.close();
  } catch {
    // ignore teardown errors
  }
  client = null;
  cachedTools = [];
}
