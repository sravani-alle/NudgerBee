import { OpenAI } from 'openai';
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

/**
 * Stream an LLM response to Slack. Recurses after tool calls until the model
 * produces a plain text turn.
 *
 * @param {import("@slack/web-api").ChatStreamer} streamer
 * @param {any[]} messages - Chat Completions messages (mutated: system prompt prepended, tool turns appended)
 * @param {{systemPrompt?: string, tools?: BeeTool[]}} [options]
 *
 * @see {@link https://docs.slack.dev/tools/bolt-js/web#sending-streaming-messages}
 * @see {@link https://platform.openai.com/docs/guides/function-calling}
 */
export async function callLLM(streamer, messages, { systemPrompt = BASE_SYSTEM_PROMPT, tools = [] } = {}) {
  // One system prompt per conversation. The recursive tool-call pass reuses
  // the same array, so this guard avoids duplicating it.
  if (messages[0]?.role !== 'system') {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  const toolDefinitions = tools.map((t) => t.definition);
  const toolMap = new Map(tools.map((t) => [t.definition.function.name, t]));

  const stream = await openai.chat.completions.create({
    model: MODEL,
    messages,
    ...(toolDefinitions.length > 0 ? { tools: toolDefinitions, tool_choice: 'auto' } : {}),
    stream: true,
  });

  /** @type {Record<number, { id: string, name: string, arguments: string }>} */
  const toolCallsByIndex = {};
  let assistantContent = '';

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      assistantContent += delta.content;
      await streamer.append({ markdown_text: delta.content });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsByIndex[idx]) {
          toolCallsByIndex[idx] = { id: tc.id ?? '', name: '', arguments: '' };
        }
        const acc = toolCallsByIndex[idx];
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }
  }

  const toolCalls = Object.values(toolCallsByIndex);
  if (toolCalls.length === 0) return;

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
  await callLLM(streamer, messages, { systemPrompt, tools });
}
