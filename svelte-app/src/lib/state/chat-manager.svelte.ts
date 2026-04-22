// Chat manager — manages the chat registry, switching, CRUD.
// Encapsulates all chat list logic shared between ViewerApp and LibraryApp.

import type { ChatState } from './chat.svelte';
import {
  getChatRegistry,
  createChat,
  renameChat,
  deleteChat as deleteChatEntry,
  getActiveChat,
  setActiveChat,
  type ChatEntry,
  type ChatScope,
} from '../core/chat-registry';
import { settings } from './settings.svelte';

export interface ChatManager {
  readonly chats: ChatEntry[];
  readonly activeChatId: string | null;
  refresh: () => void;
  /** Bind the manager to a view scope. In global mode the scope is ignored
   *  (we always read/write the single legacy pointer). In per-book mode the
   *  scope selects which pointer is used: 'library' or 'book:<id>'. */
  setScope: (scope: string | null) => void;
  init: () => void;
  select: (id: string) => void;
  create: (defaultName: string) => void;
  rename: (id: string) => void;
  remove: (id: string) => void;
  truncate: (fromIndex: number) => void;
  compact: (apiKey: string, model: string) => Promise<void>;
}

export function createChatManager(chatState: ChatState): ChatManager {
  let chats = $state<ChatEntry[]>([]);
  let activeChatId = $state<string | null>(null);
  /** The scope passed in by the current view. `null` means the caller has not
   *  bound a scope yet — we fall back to the global pointer. */
  let viewScope: string | null = null;

  /** The effective scope for registry reads/writes. Depends on settings.chatScopeMode. */
  function effectiveScope(): ChatScope {
    if (settings.chatScopeMode === 'per-book' && viewScope) return viewScope;
    return null;
  }

  function refresh() {
    chats = getChatRegistry();
  }

  /** Load the active chat for the current scope, or clear if none exists. */
  function loadActiveForScope() {
    const savedId = getActiveChat(effectiveScope());
    if (savedId && chats.some(c => c.id === savedId)) {
      activeChatId = savedId;
      chatState.resetStats();
      chatState.loadFromStorage(savedId);
    } else {
      activeChatId = null;
      chatState.clearMessages();
      chatState.resetStats();
    }
  }

  function switchTo(id: string) {
    if (activeChatId) chatState.saveToStorage(activeChatId);
    activeChatId = id;
    setActiveChat(id, effectiveScope());
    chatState.clearMessages();
    chatState.resetStats();
    chatState.loadFromStorage(id);
  }

  // React to scope-mode toggle: abort any in-flight send, persist the current
  // chat, then reload what belongs in this view under the new effective scope.
  settings.onChatScopeModeChange(() => {
    if (chatState.sending) chatState.abort();
    if (activeChatId) chatState.saveToStorage(activeChatId);
    refresh();
    loadActiveForScope();
  });

  return {
    get chats() { return chats; },
    get activeChatId() { return activeChatId; },

    refresh,

    setScope(scope: string | null) {
      if (viewScope === scope) return;
      // Abort any in-flight send and save current chat before swapping scope.
      if (chatState.sending) chatState.abort();
      if (activeChatId) chatState.saveToStorage(activeChatId);
      viewScope = scope;
      refresh();
      loadActiveForScope();
    },

    init() {
      refresh();
      loadActiveForScope();
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
        // deleteChatEntry already scrubbed any pointer matching this id,
        // so loadActiveForScope will fall through to the empty state.
        loadActiveForScope();
      }
    },

    truncate(fromIndex: number) {
      chatState.setMessages(chatState.messages.slice(0, fromIndex));
      if (activeChatId) chatState.saveToStorage(activeChatId);
    },

    async compact(apiKey: string, model: string) {
      if (!activeChatId) return;
      await chatState.compact(apiKey, model, activeChatId);
      chatState.saveToStorage(activeChatId);
    },
  };
}
