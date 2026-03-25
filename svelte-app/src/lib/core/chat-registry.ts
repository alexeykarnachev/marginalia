// Chat registry — manages the list of user-created chats.
// Each chat has an id, name, and timestamp. Messages stored separately via lsChatKey.

import { lsChatKey, lsStatsKey } from './constants';

const LS_REGISTRY = 'marginalia_chat_registry';

export interface ChatEntry {
  id: string;
  name: string;
  createdAt: number;
}

export function getChatRegistry(): ChatEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_REGISTRY) || '[]');
  } catch {
    return [];
  }
}

function saveRegistry(entries: ChatEntry[]): void {
  localStorage.setItem(LS_REGISTRY, JSON.stringify(entries));
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
  const registry = getChatRegistry().filter(e => e.id !== id);
  saveRegistry(registry);
  localStorage.removeItem(lsChatKey(id));
  localStorage.removeItem(lsStatsKey(id));
}

/**
 * Migrate legacy per-book and library chats into the registry.
 * Scans localStorage for marginalia_chat_* keys not already in the registry.
 * Run once on app startup.
 */
export function migrateExistingChats(books: { id: string; title: string }[]): void {
  const registry = getChatRegistry();
  const knownIds = new Set(registry.map(e => e.id));

  const bookMap = new Map(books.map(b => [b.id, b.title]));
  const prefix = 'marginalia_chat_';

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const chatId = key.slice(prefix.length);
    if (knownIds.has(chatId)) continue;

    // Check if it actually has messages
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      const msgs = Array.isArray(raw) ? raw : raw?.messages;
      if (!msgs || msgs.length === 0) continue;
    } catch {
      continue;
    }

    // Determine name
    let name: string;
    if (chatId === '_library') {
      name = 'Library';
    } else {
      name = bookMap.get(chatId) || chatId.slice(0, 8);
    }

    registry.push({
      id: chatId,
      name,
      createdAt: Date.now(),
    });
  }

  saveRegistry(registry);
}

export function getActiveChat(): string | null {
  return localStorage.getItem('marginalia_active_chat') || null;
}

export function setActiveChat(id: string | null): void {
  if (id) {
    localStorage.setItem('marginalia_active_chat', id);
  } else {
    localStorage.removeItem('marginalia_active_chat');
  }
}
