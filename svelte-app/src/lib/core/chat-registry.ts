// Chat registry — manages the list of user-created chats.
// Each chat has an id, name, and timestamp. Messages stored separately via lsChatKey.

import { lsChatKey, lsStatsKey, lsChatPromptKey, lsCompactPromptKey } from './constants';

const LS_REGISTRY = 'marginalia_chats';

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

export function removeChatEntry(id: string): void {
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
