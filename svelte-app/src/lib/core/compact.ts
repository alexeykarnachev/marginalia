// Conversation compaction — summarizes the entire conversation via LLM call.
// User triggers manually via "Compact" in chat menu.
// getCompactPrompt / setCompactPrompt are in settings.svelte.ts

import type { ChatMessage } from '../types';
import { simpleLLMCall } from './agent';
import { getCompactPrompt } from '../state/settings.svelte';

export const DEFAULT_COMPACT_PROMPT = `Summarize this reading assistant conversation into a structured reference.
Preserve ALL of:
- Page numbers and citations mentioned
- Key conclusions and analysis
- Book titles and IDs referenced
- Folder/library changes made
- Any specific facts or arguments discussed
Format as a bulleted list grouped by topic. Be specific, cite pages.`;

export interface CompactResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compact a conversation: LLM summarizes all messages into a summary.
 * Returns the summary and token usage.
 */
export async function compactConversation(
  apiKey: string,
  model: string,
  bookId: string,
  messages: ChatMessage[],
): Promise<CompactResult> {
  const conv = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  if (conv.length < 2) {
    throw new Error('Nothing to compact');
  }

  const customPrompt = getCompactPrompt(bookId);
  const prompt = customPrompt || DEFAULT_COMPACT_PROMPT;

  const historyText = conv.map(m => `${m.role}: ${m.content}`).join('\n\n');

  const summarizeMessages: ChatMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: historyText },
  ];

  const data = await simpleLLMCall(apiKey, model, summarizeMessages);
  const summary = (data as any).choices?.[0]?.message?.content || '';
  if (!summary) throw new Error('LLM returned empty summary');

  const usage = (data as any).usage || {};
  return {
    summary,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  };
}
