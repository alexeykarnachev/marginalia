// Chat state for a single chat session
// Export a createChatState() factory that returns reactive chat state

import type { ChatMessage, ChatStats } from '../types';

export interface ChatState {
  readonly messages: ChatMessage[];
  readonly summary: string | null;
  readonly stats: ChatStats;
  readonly sending: boolean;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  clearMessages: () => void;
  setSummary: (s: string | null) => void;
  setSending: (v: boolean) => void;
  updateStats: (partial: Partial<ChatStats>) => void;
  resetStats: () => void;
  saveToStorage: (bookId: string) => void;
  loadFromStorage: (bookId: string) => void;
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

  return {
    get messages() { return messages; },
    get summary() { return summary; },
    get stats() { return stats; },
    get sending() { return sending; },

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

    saveToStorage(bookId: string) {
      localStorage.setItem(`marginalia_chat_${bookId}`, JSON.stringify({
        messages,
        summary,
      }));
      localStorage.setItem(`marginalia_stats_${bookId}`, JSON.stringify(stats));
    },

    loadFromStorage(bookId: string) {
      try {
        const raw = JSON.parse(localStorage.getItem(`marginalia_chat_${bookId}`) || 'null');
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
        const stored = JSON.parse(localStorage.getItem(`marginalia_stats_${bookId}`) || 'null');
        if (stored) stats = { ...defaultStats, ...stored };
      } catch { /* ignore parse errors */ }
    },
  };
}
