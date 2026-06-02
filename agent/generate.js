import { OpenAI } from 'openai';
import { BASE_SYSTEM_PROMPT } from './prompts/base.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'ollama',
  baseURL: process.env.LLM_BASE_URL || undefined,
});

const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

const MAX_TOOL_LOOPS = 5;

/**
 * Non-streaming generation for scheduled jobs (reminders, keeper digests).
 * Mirrors callLLM's tool-calling loop but returns a single string.
 *
 * @param {any[]} messages
 * @param {{systemPrompt?: string, tools?: import('./llm-caller.js').BeeTool[]}} [options]
 * @returns {Promise<string>}
 */
export async function generateMessage(messages, { systemPrompt = BASE_SYSTEM_PROMPT, tools = [] } = {}) {
  if (messages[0]?.role !== 'system') {
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  const toolDefinitions = tools.map((t) => t.definition);
  const toolMap = new Map(tools.map((t) => [t.definition.function.name, t]));

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      ...(toolDefinitions.length > 0 ? { tools: toolDefinitions, tool_choice: 'auto' } : {}),
      stream: false,
    });

    const msg = response.choices[0]?.message;
    if (!msg) return '';

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });
      for (const tc of msg.tool_calls) {
        const tool = toolMap.get(tc.function.name);
        let args = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch (_e) {
          args = {};
        }
        let result;
        if (!tool) {
          result = { error: `Unknown tool: ${tc.function.name}` };
        } else {
          try {
            result = await tool.execute(args);
          } catch (e) {
            result = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      continue;
    }

    return msg.content ?? '';
  }
  return '';
}
