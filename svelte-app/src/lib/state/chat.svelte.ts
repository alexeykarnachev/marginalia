// Chat state for a single chat session
// Export a createChatState() factory that returns reactive chat state

import type { ChatMessage, ChatStats } from '../types';
import { compactConversation } from '../core/compact';
import { lsChatKey, lsStatsKey } from '../core/constants';

export interface ChatState {
  readonly messages: ChatMessage[];
  readonly summary: string | null;
  readonly stats: ChatStats;
  readonly sending: boolean;
  readonly toolActivity: string[];
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  setSummary: (s: string | null) => void;
  setSending: (v: boolean) => void;
  updateStats: (partial: Partial<ChatStats>) => void;
  resetStats: () => void;
  resetToolActivity: () => void;
  addToolActivity: (action: string) => void;
  saveToStorage: (bookId: string) => void;
  loadFromStorage: (bookId: string) => void;
  compact: (apiKey: string, model: string, bookId: string) => Promise<void>;
  handleDelta: (full: string) => void;
  trackUsage: (usage: any, model: string) => void;
}

const defaultStats: ChatStats = {
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  lastContextTokens: 0,
  model: '',
};

export function createChatState(): ChatState {
  let messages = $state<ChatMessage[]>([]);
  let summary = $state<string | null>(null);
  let stats = $state<ChatStats>({ ...defaultStats });
  let sending = $state(false);
  let toolActivity = $state<string[]>([]);

  return {
    get messages() { return messages; },
    get summary() { return summary; },
    get stats() { return stats; },
    get sending() { return sending; },
    get toolActivity() { return toolActivity; },

    addMessage(msg: ChatMessage) {
      messages = [...messages, msg];
    },

    updateLastMessage(content: string) {
      if (messages.length === 0) return;
      const last = messages[messages.length - 1];
      messages = [...messages.slice(0, -1), { ...last, content }];
    },

    setMessages(msgs: ChatMessage[]) {
      messages = [...msgs];
    },

    clearMessages() {
      messages = [];
    },

    setSummary(s: string | null) {
      summary = s;
    },

    setSending(v: boolean) {
      sending = v;
    },

    updateStats(partial: Partial<ChatStats>) {
      stats = { ...stats, ...partial };
    },

    resetStats() {
      stats = { ...defaultStats };
    },

    resetToolActivity() {
      toolActivity = [];
    },

    addToolActivity(action: string) {
      toolActivity = [...toolActivity, action];
    },

    saveToStorage(bookId: string) {
      localStorage.setItem(lsChatKey(bookId), JSON.stringify({
        messages,
        summary,
      }));
      localStorage.setItem(lsStatsKey(bookId), JSON.stringify(stats));
    },

    loadFromStorage(bookId: string) {
      try {
        const raw = JSON.parse(localStorage.getItem(lsChatKey(bookId)) || 'null');
        if (Array.isArray(raw)) {
          // Legacy format: bare array
          messages = raw;
          summary = null;
        } else if (raw && raw.messages) {
          messages = raw.messages;
          summary = raw.summary || null;
        }
      } catch { /* ignore parse errors */ }
      try {
        const stored = JSON.parse(localStorage.getItem(lsStatsKey(bookId)) || 'null');
        if (stored) stats = { ...defaultStats, ...stored };
      } catch { /* ignore parse errors */ }
    },

    async compact(apiKey: string, model: string, bookId: string) {
      if (!apiKey) return;
      messages = [...messages, { role: 'system', content: 'Compacting conversation...' }];
      try {
        const msgsForCompact = messages.filter(m => m.content !== 'Compacting conversation...');
        const result = await compactConversation(apiKey, model, bookId, msgsForCompact, summary);
        summary = result.summary;
        messages = [
          { role: 'system', content: `Compacted (${result.inputTokens} in / ${result.outputTokens} out tokens)` },
          { role: 'assistant', content: result.summary },
        ];
      } catch (err: any) {
        messages = messages.filter(m => m.content !== 'Compacting conversation...');
        const msg = (err as Error).name === 'AbortError'
          ? 'Compact timed out (30s). Try again or reduce conversation length.'
          : `Compact failed: ${(err as Error).message}`;
        messages = [...messages, { role: 'system', content: msg }];
      }
    },

    handleDelta(full: string) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        const idx = messages.length - 1;
        messages = [...messages.slice(0, idx), { ...messages[idx], content: full }];
      } else {
        messages = [...messages, { role: 'assistant', content: full }];
      }
    },

    trackUsage(usage: any, model: string) {
      stats = {
        ...stats,
        inputTokens: stats.inputTokens + (usage.prompt_tokens || 0),
        outputTokens: stats.outputTokens + (usage.completion_tokens || 0),
        cost: stats.cost + (usage.cost || 0),
        lastContextTokens: usage.prompt_tokens || 0,
        model: model || stats.model,
      };
    },
  };
}
