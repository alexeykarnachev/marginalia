// Conversation compaction — summarizes the entire conversation via LLM call.
// User triggers manually via "Compact" in chat menu.
// getCompactPrompt / setCompactPrompt are in settings.svelte.ts

import type { ChatMessage } from '../types';
import { simpleLLMCall } from './agent';
import { getCompactPrompt } from '../state/settings.svelte';

export const DEFAULT_COMPACT_PROMPT = `Provide a detailed but concise summary of our conversation above. Focus on information that would be helpful for continuing the conversation, including what we discussed, what books and pages we referenced, what conclusions were reached, and what we're going to do next.`;

export interface CompactResult {
  summary: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compact a conversation: append the summarization prompt as a user message
 * to the actual conversation, so the LLM sees the full original context.
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

  const summarizeMessages: ChatMessage[] = [
    ...conv,
    { role: 'user', content: prompt },
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
