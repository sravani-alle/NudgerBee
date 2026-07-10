import { OpenAI } from 'openai';
import { resolveDemoMentions } from '../db/repos/hivemates.js';
import { BASE_SYSTEM_PROMPT } from './prompts/base.js';

// LLM client. Defaults to OpenAI; point LLM_BASE_URL at a local Ollama
// (http://localhost:11434/v1) and set LLM_MODEL to run a local model for free.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'ollama',
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

/**
 * @typedef {import('openai/resources/chat/completions').ChatCompletionFunctionTool} ChatCompletionFunctionTool
 *
 * @typedef {Object} BeeTool
 * @property {ChatCompletionFunctionTool} definition - OpenAI Chat Completions tool definition ({ type: 'function', function: {...} })
 * @property {(args: any) => any | Promise<any>} execute - Runs when the LLM calls the tool. Return a value (object or string); errors are caught and surfaced to the LLM.
 * @property {(args: any) => string} [getTaskTitle] - Optional human-readable in-progress title for the Slack task_update chunk.
 */

// LOCAL-LLM-SHIM (remove after the gpt-4o-mini migration — see docs/PLAN.md Day 11).
// Local models (Ollama + qwen2.5) emit their tool calls in a Hermes-style
// `<tool_call>{...}</tool_call>` envelope and surround turns with control
// tokens like `<|im_start|>`. When the OpenAI-compatible endpoint fails to
// parse those out (notably while streaming), they leak into message content.
// These helpers keep that noise off the user's screen and recover tool calls
// the endpoint dropped. Cloud models (gpt-4o-mini) never hit these paths.

/**
 * Remove model control tokens and stray tool-call tags from display text.
 * @param {string} text
 */
function stripControlTokens(text) {
  return (text || '').replace(/<\|[^|]*\|>/g, '').replace(/<\/?tool_call>/g, '');
}

/**
 * Scan for balanced top-level `{...}` JSON objects in free text.
 * @param {string} text
 */
function scanBalancedJson(text) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

/**
 * Recover tool calls that a local model leaked into message content as text,
 * either wrapped in `<tool_call>...</tool_call>` or as bare JSON objects with
 * `name` + `arguments`.
 * @param {string} text
 * @returns {{ id: string, name: string, arguments: string }[]}
 */
function extractToolCallsFromText(text) {
  /** @type {{ id: string, name: string, arguments: string }[]} */
  const calls = [];
  if (!text) return calls;
  const wrapped = [...text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)].map((m) => m[1]);
  const candidates = wrapped.length > 0 ? wrapped : scanBalancedJson(text);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj.name === 'string' && obj.arguments !== undefined) {
        calls.push({
          id: `call_${calls.length}`,
          name: obj.name,
          arguments: typeof obj.arguments === 'string' ? obj.arguments : JSON.stringify(obj.arguments),
        });
      }
    } catch (_e) {
      // not a tool call; ignore
    }
  }
  return calls;
}

/**
 * Run an LLM turn and stream the response to Slack. Recurses after tool calls
 * until the model produces a plain text turn.
 *
 * Tool-enabled turns are run NON-streaming: local models only return reliable
 * structured `tool_calls` that way (streaming leaks the raw `<tool_call>` text).
 * Plain turns (no tools) stream for a nicer typing effect.
 *
 * @param {import("@slack/web-api").ChatStreamer} streamer
 * @param {any[]} messages - Chat Completions messages (mutated: system prompt prepended, tool turns appended)
 * @param {{systemPrompt?: string, tools?: BeeTool[], _depth?: number}} [options]
 *
 * @see {@link https://docs.slack.dev/tools/bolt-js/web#sending-streaming-messages}
 * @see {@link https://platform.openai.com/docs/guides/function-calling}
 */
export async function callLLM(streamer, messages, { systemPrompt = BASE_SYSTEM_PROMPT, tools = [], _depth = 0 } = {}) {
  // Backstop against a flaky model looping on tool calls (e.g. repeatedly
  // calling complete_onboarding). After this many tool rounds, stop recursing.
  const MAX_TOOL_ROUNDS = 6;
  // One system prompt per conversation. The recursive tool-call pass reuses
  // the same array, so this guard avoids duplicating it.
  if (messages[0]?.role !== 'system') {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  const toolDefinitions = tools.map((t) => t.definition);
  const toolMap = new Map(tools.map((t) => [t.definition.function.name, t]));

  let assistantContent = '';
  /** @type {{ id: string, name: string, arguments: string }[]} */
  let toolCalls = [];

  if (toolDefinitions.length > 0) {
    // LOCAL-LLM-SHIM (Day 11): tool turns run non-streaming so the endpoint
    // fully parses tool calls. On gpt-4o-mini, streaming tool calls are reliable
    // — this branch can be collapsed back into a single streaming path.
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      stream: false,
    });
    const msg = completion.choices[0]?.message;
    assistantContent = msg?.content || '';
    toolCalls = (msg?.tool_calls ?? [])
      .filter((tc) => tc.type === 'function')
      .map((tc, i) => ({
        id: tc.id || `call_${i}`,
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '',
      }));

    // LOCAL-LLM-SHIM (Day 11): recover tool calls the endpoint left embedded in
    // the text. gpt-4o-mini never leaks them, so this block can be dropped.
    if (toolCalls.length === 0) {
      const recovered = extractToolCallsFromText(assistantContent);
      if (recovered.length > 0) {
        toolCalls = recovered;
        assistantContent = ''; // the "content" was just tool-call noise
      }
    }

    const display = resolveDemoMentions(stripControlTokens(assistantContent).trim());
    if (display) await streamer.append({ markdown_text: display });
  } else {
    // No tools: stream plain text for the typing effect.
    const stream = await openai.chat.completions.create({ model: MODEL, messages, stream: true });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        assistantContent += delta.content;
        const display = resolveDemoMentions(stripControlTokens(delta.content));
        if (display) await streamer.append({ markdown_text: display });
      }
    }
  }

  if (toolCalls.length === 0) return;

  if (_depth >= MAX_TOOL_ROUNDS) {
    await streamer.append({
      markdown_text: '\n\n_(One sec — let me catch my breath. 🐝 Go ahead and tell me the next thing!)_',
    });
    return;
  }

  messages.push({
    role: 'assistant',
    content: assistantContent || null,
    tool_calls: toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    })),
  });

  for (const call of toolCalls) {
    const tool = toolMap.get(call.name);
    let args = {};
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch (_e) {
      args = {};
    }

    const title = tool?.getTaskTitle ? tool.getTaskTitle(args) : `Running ${call.name}...`;
    await streamer.append({
      chunks: [{ type: 'task_update', id: call.id, title, status: 'in_progress' }],
    });

    let result;
    if (!tool) {
      result = { error: `Unknown tool: ${call.name}` };
    } else {
      try {
        result = await tool.execute(args);
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    messages.push({ role: 'tool', tool_call_id: call.id, content: resultStr });

    const isError = result && typeof result === 'object' && result.error != null;
    const doneTitle = isError
      ? String(result.error)
      : (typeof result === 'object' && result?.description) || 'Completed';
    await streamer.append({
      chunks: [{ type: 'task_update', id: call.id, title: doneTitle, status: isError ? 'error' : 'complete' }],
    });
  }

  // Continue the conversation now that tool outputs are available
  await callLLM(streamer, messages, { systemPrompt, tools, _depth: _depth + 1 });
}
