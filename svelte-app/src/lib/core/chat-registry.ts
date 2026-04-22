// Chat registry — manages the list of user-created chats.
// Each chat has an id, name, and timestamp. Messages stored separately via lsChatKey.

import {
  lsChatKey,
  lsStatsKey,
  lsChatPromptKey,
  lsCompactPromptKey,
  lsActiveChatScopedKey,
  LS_ACTIVE_CHAT_GLOBAL,
} from './constants';

const LS_REGISTRY = 'marginalia_chats';

/** Scope for the active-chat pointer.
 *  null  — global (back-compat, single pointer).
 *  'library' — library view in per-book mode.
 *  'book:<id>' — viewer for a specific book in per-book mode.
 */
export type ChatScope = string | null;

export function libraryScope(): string { return 'library'; }
export function bookScope(bookId: string): string { return `book:${bookId}`; }

export interface ChatEntry {
  id: string;
  name: string;
  createdAt: number;
}

export function getChatRegistry(): ChatEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_REGISTRY) || '[]');
    return Array.isArray(parsed) ? [...parsed] : [];
  } catch {
    return [];
  }
}

function saveRegistry(entries: ChatEntry[]): void {
  localStorage.setItem(LS_REGISTRY, JSON.stringify(entries));
}

function removeChatEntry(id: string): void {
  saveRegistry(getChatRegistry().filter(e => e.id !== id));
}

export function createChat(name: string): ChatEntry {
  const entry: ChatEntry = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
  };
  const registry = getChatRegistry();
  registry.push(entry);
  saveRegistry(registry);
  return entry;
}

export function renameChat(id: string, name: string): void {
  const registry = getChatRegistry();
  const entry = registry.find(e => e.id === id);
  if (entry) {
    entry.name = name;
    saveRegistry(registry);
  }
}

export function deleteChat(id: string): void {
  removeChatEntry(id);
  localStorage.removeItem(lsChatKey(id));
  localStorage.removeItem(lsStatsKey(id));
  localStorage.removeItem(lsChatPromptKey(id));
  localStorage.removeItem(lsCompactPromptKey(id));
  // Scrub any active-chat pointer that points at this chat.
  if (localStorage.getItem(LS_ACTIVE_CHAT_GLOBAL) === id) {
    localStorage.removeItem(LS_ACTIVE_CHAT_GLOBAL);
  }
  const prefix = 'marginalia_active_chat:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && localStorage.getItem(key) === id) {
      localStorage.removeItem(key);
    }
  }
}

export function getActiveChat(scope: ChatScope = null): string | null {
  if (scope) return localStorage.getItem(lsActiveChatScopedKey(scope)) || null;
  return localStorage.getItem(LS_ACTIVE_CHAT_GLOBAL) || null;
}

export function setActiveChat(id: string | null, scope: ChatScope = null): void {
  const key = scope ? lsActiveChatScopedKey(scope) : LS_ACTIVE_CHAT_GLOBAL;
  if (id) {
    localStorage.setItem(key, id);
  } else {
    localStorage.removeItem(key);
  }
}

/** Forget the per-scope active-chat pointer (e.g. when the book it belongs to
 *  has been deleted). Safe to call for any scope. */
export function clearScopeActive(scope: string): void {
  localStorage.removeItem(lsActiveChatScopedKey(scope));
}
