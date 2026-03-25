// Chat manager — manages the chat registry, switching, CRUD.
// Encapsulates all chat list logic shared between ViewerApp and LibraryApp.

import type { ChatState } from './chat.svelte';
import {
  getChatRegistry,
  createChat,
  renameChat,
  deleteChat as deleteChatEntry,
  migrateExistingChats,
  getActiveChat,
  setActiveChat,
  type ChatEntry,
} from '../core/chat-registry';

export interface ChatManager {
  readonly chats: ChatEntry[];
  readonly activeChatId: string | null;
  refresh: () => void;
  init: (books: { id: string; title: string }[]) => void;
  select: (id: string) => void;
  create: (defaultName: string) => void;
  rename: (id: string) => void;
  remove: (id: string) => void;
}

export function createChatManager(chatState: ChatState): ChatManager {
  let chats = $state<ChatEntry[]>([]);
  let activeChatId = $state<string | null>(getActiveChat());

  function refresh() {
    chats = getChatRegistry();
  }

  function switchTo(id: string) {
    if (activeChatId) chatState.saveToStorage(activeChatId);
    activeChatId = id;
    setActiveChat(id);
    chatState.clearMessages();
    chatState.setSummary(null);
    chatState.resetStats();
    chatState.loadFromStorage(id);
  }

  return {
    get chats() { return chats; },
    get activeChatId() { return activeChatId; },

    refresh,

    init(books: { id: string; title: string }[]) {
      migrateExistingChats(books);
      refresh();
      if (activeChatId && chats.some(c => c.id === activeChatId)) {
        chatState.loadFromStorage(activeChatId);
      } else if (chats.length > 0) {
        activeChatId = chats[0].id;
        setActiveChat(activeChatId);
        chatState.loadFromStorage(activeChatId);
      } else {
        activeChatId = null;
        setActiveChat(null);
      }
    },

    select: switchTo,

    create(defaultName: string) {
      const name = prompt('Chat name:', defaultName);
      if (!name?.trim()) return;
      const entry = createChat(name.trim());
      refresh();
      switchTo(entry.id);
    },

    rename(id: string) {
      const entry = chats.find(c => c.id === id);
      if (!entry) return;
      const name = prompt('Rename chat:', entry.name);
      if (!name?.trim()) return;
      renameChat(id, name.trim());
      refresh();
    },

    remove(id: string) {
      if (!confirm('Delete this chat?')) return;
      deleteChatEntry(id);
      refresh();
      if (activeChatId === id) {
        chatState.clearMessages();
        chatState.setSummary(null);
        chatState.resetStats();
        activeChatId = chats.length > 0 ? chats[0].id : null;
        setActiveChat(activeChatId);
        if (activeChatId) chatState.loadFromStorage(activeChatId);
      }
    },
  };
}
