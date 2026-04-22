// Theme, API key, model — persisted to localStorage

import {
  LS_THEME,
  LS_API_KEY,
  LS_MODELS,
  LS_CHAT_FONT,
  LS_CHAT_MONO,
  LS_CHAT_SCOPE_MODE,
  DEFAULT_CHAT_FONT_SIZE,
  lsPromptKey,
  lsChatPromptKey,
  lsCompactPromptKey,
} from '../core/constants';

export type ChatScopeMode = 'global' | 'per-book';

function loadValue<T>(key: string, defaultValue: T): T {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  if (typeof defaultValue === 'boolean') return (stored !== '0') as unknown as T;
  if (typeof defaultValue === 'number') return (parseInt(stored) || defaultValue) as unknown as T;
  return stored as unknown as T;
}

let _theme = $state(loadValue(LS_THEME, 'dark'));
let _apiKey = $state(loadValue(LS_API_KEY, ''));

function loadChatScopeMode(): ChatScopeMode {
  const raw = localStorage.getItem(LS_CHAT_SCOPE_MODE);
  return raw === 'per-book' ? 'per-book' : 'global';
}
let _chatScopeMode = $state<ChatScopeMode>(loadChatScopeMode());

type ChatScopeModeListener = (mode: ChatScopeMode) => void;
const _chatScopeModeListeners = new Set<ChatScopeModeListener>();

function loadModels(): { models: string[]; active: number } {
  try {
    const raw = localStorage.getItem(LS_MODELS);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        // Migrate from old format (plain array) — active index defaults to 0
        return { models: data, active: 0 };
      }
      if (data && Array.isArray(data.models) && data.models.length > 0) {
        return { models: data.models, active: data.active ?? 0 };
      }
    }
  } catch {}
  // Migrate from old LS_MODEL key
  const old = localStorage.getItem('openrouter_model');
  if (old) {
    localStorage.removeItem('openrouter_model');
    return { models: [old], active: 0 };
  }
  return { models: ['x-ai/grok-4.1-fast'], active: 0 };
}

function saveModels() {
  localStorage.setItem(LS_MODELS, JSON.stringify({ models: _models, active: _activeModelIndex }));
}

const loaded = loadModels();
let _models = $state<string[]>(loaded.models);
let _activeModelIndex = $state(Math.min(loaded.active, Math.max(0, loaded.models.length - 1)));

export const settings = {
  get theme() { return _theme; },
  set theme(v: string) { _theme = v; localStorage.setItem(LS_THEME, v); applyTheme(); },

  get apiKey() { return _apiKey; },
  set apiKey(v: string) { _apiKey = v; localStorage.setItem(LS_API_KEY, v); },

  get model() { return _models[_activeModelIndex] ?? ''; },
  set model(v: string) {
    const idx = _models.indexOf(v);
    if (idx >= 0) { _activeModelIndex = idx; saveModels(); }
  },

  get models() { return _models; },
  addModel(v: string) {
    const m = v.trim();
    if (!m || _models.includes(m)) return;
    _models = [..._models, m];
    _activeModelIndex = _models.length - 1;
    saveModels();
  },
  removeModel(v: string) {
    const idx = _models.indexOf(v);
    if (idx < 0) return;
    _models = _models.filter(m => m !== v);
    if (_activeModelIndex >= _models.length) {
      _activeModelIndex = Math.max(0, _models.length - 1);
    }
    saveModels();
  },

  get chatScopeMode(): ChatScopeMode { return _chatScopeMode; },
  set chatScopeMode(v: ChatScopeMode) {
    if (v !== 'global' && v !== 'per-book') return;
    if (_chatScopeMode === v) return;
    _chatScopeMode = v;
    localStorage.setItem(LS_CHAT_SCOPE_MODE, v);
    for (const fn of _chatScopeModeListeners) fn(v);
  },

  onChatScopeModeChange(fn: ChatScopeModeListener): () => void {
    _chatScopeModeListeners.add(fn);
    return () => { _chatScopeModeListeners.delete(fn); };
  },
};

export function toggleTheme(): void {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
}

export function applyTheme(): void {
  const html = document.documentElement;
  html.dataset.theme = settings.theme;
  html.classList.toggle('is-light', settings.theme === 'light');
  html.classList.toggle('is-dark', settings.theme !== 'light');
}

// --- Shared chat display settings ---

let _chatFontSize = $state(parseInt(localStorage.getItem(LS_CHAT_FONT) || String(DEFAULT_CHAT_FONT_SIZE)));
let _chatMono = $state(localStorage.getItem(LS_CHAT_MONO) === '1');

export const chatDisplay = {
  get fontSize() { return _chatFontSize; },
  set fontSize(v: number) { _chatFontSize = v; localStorage.setItem(LS_CHAT_FONT, String(v)); },
  get mono() { return _chatMono; },
  toggleMono() { _chatMono = !_chatMono; localStorage.setItem(LS_CHAT_MONO, _chatMono ? '1' : '0'); },
};

// --- Per-book settings ---

export function getBookPrompt(bookId: string): string {
  return localStorage.getItem(lsPromptKey(bookId)) || '';
}

export function setBookPrompt(bookId: string, prompt: string): void {
  if (prompt.trim()) {
    localStorage.setItem(lsPromptKey(bookId), prompt.trim());
  } else {
    localStorage.removeItem(lsPromptKey(bookId));
  }
}

// --- Per-chat settings ---

export function getChatPrompt(chatId: string): string {
  return localStorage.getItem(lsChatPromptKey(chatId)) || '';
}

export function setChatPrompt(chatId: string, prompt: string): void {
  if (prompt.trim()) {
    localStorage.setItem(lsChatPromptKey(chatId), prompt.trim());
  } else {
    localStorage.removeItem(lsChatPromptKey(chatId));
  }
}

// --- Per-book compact prompt ---

export function getCompactPrompt(bookId: string): string {
  return localStorage.getItem(lsCompactPromptKey(bookId)) || '';
}

export function setCompactPrompt(bookId: string, prompt: string): void {
  if (prompt.trim()) {
    localStorage.setItem(lsCompactPromptKey(bookId), prompt.trim());
  } else {
    localStorage.removeItem(lsCompactPromptKey(bookId));
  }
}
