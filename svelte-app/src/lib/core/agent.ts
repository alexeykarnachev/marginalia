// Marginalia — agentic loop
// Calls LLM, detects tool_calls, executes tools, feeds results back, repeats.
// Includes intra-turn context compression and token budget enforcement.

import type { ChatMessage, AgentCallbacks } from '../types';
import { getToolDefinitions, executeTool } from './tools';
import {
  MAX_AGENT_ITERATIONS,
  MAX_INPUT_TOKENS_PER_TURN,
  OPENROUTER_URL,
  SIMPLE_LLM_TIMEOUT_MS,
  TOOL_RESULT_MIN_COMPRESS_LENGTH,
  SEARCH_RESULT_BLOCKS_TO_KEEP,
  GENERIC_COMPRESS_CHARS,
} from './constants';

// --- Intra-turn tool result compression ---
// After the agent processes tool results, older results are compressed to stubs.
// The most recent round of tool results is always kept in full.

function _compressOldToolResults(messages: ChatMessage[]): void {
  // Find the index of the last assistant message (marks the boundary between
  // "already processed" and "fresh" tool results)
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return;

  for (let i = 0; i < lastAssistantIdx; i++) {
    const msg = messages[i];
    if (msg.role !== 'tool' || msg._compressed) continue;
    if (msg.content.length < TOOL_RESULT_MIN_COMPRESS_LENGTH) continue;

    msg.content = _compressToolContent(msg.content);
    msg._compressed = true;
  }
}

function _compressToolContent(content: string): string {
  // Page read: keep header, drop body
  const pageHeader = content.match(/^\[.+?, p\.\d+[^\]]*\]/);
  if (pageHeader) {
    const bodyLen = content.length - pageHeader[0].length;
    return `${pageHeader[0]}\n[previously read — ${bodyLen} chars]`;
  }

  // Multi-page read: keep header
  const pagesHeader = content.match(/^\[.+?, p\.\d+-\d+[^\]]*\]/);
  if (pagesHeader) {
    const bodyLen = content.length - pagesHeader[0].length;
    return `${pagesHeader[0]}\n[previously read — ${bodyLen} chars]`;
  }

  // Search: keep header + first 3 results
  const searchHeader = content.match(/^.+?grep .+/);
  if (searchHeader) {
    const blocks = content.split('\n\n');
    const kept = blocks.slice(0, SEARCH_RESULT_BLOCKS_TO_KEEP);
    const dropped = blocks.length - kept.length;
    if (dropped > 0) {
      return kept.join('\n\n') + `\n\n[${dropped} more results omitted]`;
    }
    return content;
  }

  // Generic: keep first N chars
  return content.slice(0, GENERIC_COMPRESS_CHARS) + `\n[truncated — was ${content.length} chars]`;
}

// --- API helpers ---

function _apiHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

// --- Types for streaming response ---

interface ToolCallChunk {
  id: string;
  function: { name: string; arguments: string };
}

interface LLMResult {
  content: string;
  toolCalls: ToolCallChunk[];
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  model: string;
  finishReason: string;
}

interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

interface AgentResult {
  content: string;
  messages: ChatMessage[];
}

// --- LLM call with streaming ---

export async function llmCall(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools: ReturnType<typeof getToolDefinitions> | null,
  onDelta?: (delta: string, full: string) => void
): Promise<LLMResult> {
  // Strip internal flags before serializing
  const cleanMessages = messages.map((m) => {
    if (m._compressed) {
      const { _compressed, ...clean } = m;
      return clean;
    }
    return m;
  });
  const body: Record<string, unknown> = { model, messages: cleanMessages, stream: true };
  if (tools && tools.length) body.tools = tools;

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: _apiHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      throw new Error(data.error?.message || `API error ${res.status}`);
    }
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    throw new Error(data.error?.message || 'Unknown API error');
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls: ToolCallChunk[] = [];
  let usage: LLMResult['usage'] = null;
  let resultModel = '';
  let finishReason = '';

  while (true) {
    let done: boolean;
    let value: Uint8Array;
    try {
      ({ done, value } = await reader.read() as { done: boolean; value: Uint8Array });
    } catch (e) {
      throw new Error('Connection lost: ' + ((e as Error).message || 'network error'));
    }
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);

        // Handle error events in the stream
        if (chunk.error) {
          throw new Error(chunk.error.message || chunk.error || 'Stream error');
        }

        const choice = chunk.choices?.[0];

        const delta = choice?.delta?.content;
        if (delta) {
          content += delta;
          if (onDelta) onDelta(delta, content);
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (tc.index !== undefined) {
              while (toolCalls.length <= tc.index) {
                toolCalls.push({ id: '', function: { name: '', arguments: '' } });
              }
              const slot = toolCalls[tc.index];
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.function.name += tc.function.name;
              if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
            }
          }
        }

        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.model) resultModel = chunk.model;
      } catch (e) {
        if ((e as Error).message && (e as Error).message !== 'Stream error') {
          // JSON parse error — skip this chunk
        } else {
          throw e; // Re-throw stream errors
        }
      }
    }
  }

  return { content, toolCalls, usage, model: resultModel, finishReason };
}

// --- Agentic loop ---

export async function agentLoop(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  callbacks: AgentCallbacks
): Promise<AgentResult> {
  const tools = getToolDefinitions();
  let totalInputTokens = 0;

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    // Compress old tool results from previous iterations (keeps latest round full)
    if (i > 0) _compressOldToolResults(messages);

    // Token budget check
    if (i > 0 && totalInputTokens > MAX_INPUT_TOKENS_PER_TURN) {
      return {
        content:
          '(Stopped: token budget exceeded for this turn. Try a simpler question or compact the conversation.)',
        messages,
      };
    }

    if (callbacks.onThinking) callbacks.onThinking(i);

    const result = await llmCall(apiKey, model, messages, tools, (delta, full) => {
      if (callbacks.onDelta) callbacks.onDelta(delta, full);
    });

    // Track usage
    if (result.usage) {
      totalInputTokens += result.usage.prompt_tokens || 0;
      if (callbacks.onUsage) callbacks.onUsage(result.usage, result.model);
    }

    // If the model wants to call tools
    if (result.toolCalls.length > 0) {
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: [],
      };
      for (const tc of result.toolCalls) {
        assistantMsg.tool_calls.push({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        });
      }
      messages.push(assistantMsg as unknown as ChatMessage);

      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          // ignore parse errors
        }

        if (callbacks.onToolCall) callbacks.onToolCall(tc.function.name, args);

        const toolResult = await executeTool(tc.function.name, args);
        const resultStr = String(toolResult);

        if (callbacks.onToolResult) callbacks.onToolResult(tc.function.name, args, resultStr);

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultStr,
        });
      }

      continue;
    }

    // No tool calls — final text response
    return { content: result.content, messages };
  }

  return {
    content: '(Agent reached maximum iterations without producing a final response)',
    messages,
  };
}

// Simple non-agentic LLM call (for compaction etc.)
export async function simpleLLMCall(
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SIMPLE_LLM_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: _apiHeaders(apiKey),
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      try {
        const d = JSON.parse(text);
        throw new Error(d.error?.message || d.error || `API error ${res.status}`);
      } catch (e) {
        if ((e as Error).message.startsWith('API')) throw e;
        throw new Error(`API error ${res.status}: ${res.statusText}`);
      }
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || data.error || 'Unknown error');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
