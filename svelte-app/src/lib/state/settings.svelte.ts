// Theme, API key, model — persisted to localStorage

import {
  LS_THEME,
  LS_API_KEY,
  LS_MODEL,
  LS_AUTO_COMPACT,
  LS_COMPACT_THRESHOLD,
  LS_CHAT_FONT,
  LS_CHAT_MONO,
  DEFAULT_MODEL,
  DEFAULT_COMPACT_THRESHOLD,
  DEFAULT_CHAT_FONT_SIZE,
  lsPromptKey,
} from '../core/constants';

function loadValue<T>(key: string, defaultValue: T): T {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  if (typeof defaultValue === 'boolean') return (stored !== '0') as unknown as T;
  if (typeof defaultValue === 'number') return (parseInt(stored) || defaultValue) as unknown as T;
  return stored as unknown as T;
}

let _theme = $state(loadValue(LS_THEME, 'dark'));
let _apiKey = $state(loadValue(LS_API_KEY, ''));
let _model = $state(loadValue(LS_MODEL, DEFAULT_MODEL));
let _autoCompact = $state(loadValue(LS_AUTO_COMPACT, true));
let _compactThreshold = $state(loadValue(LS_COMPACT_THRESHOLD, DEFAULT_COMPACT_THRESHOLD));

export const settings = {
  get theme() { return _theme; },
  set theme(v: string) { _theme = v; localStorage.setItem(LS_THEME, v); applyTheme(); },

  get apiKey() { return _apiKey; },
  set apiKey(v: string) { _apiKey = v; localStorage.setItem(LS_API_KEY, v); },

  get model() { return _model; },
  set model(v: string) { _model = v; localStorage.setItem(LS_MODEL, v); },

  get autoCompact() { return _autoCompact; },
  set autoCompact(v: boolean) { _autoCompact = v; localStorage.setItem(LS_AUTO_COMPACT, v ? '1' : '0'); },

  get compactThreshold() { return _compactThreshold; },
  set compactThreshold(v: number) { _compactThreshold = v; localStorage.setItem(LS_COMPACT_THRESHOLD, String(v)); },
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
  localStorage.setItem(lsPromptKey(bookId), prompt);
}
