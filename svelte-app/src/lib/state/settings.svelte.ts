// Theme, API key, model — persisted to localStorage

function loadValue<T>(key: string, defaultValue: T): T {
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  if (typeof defaultValue === 'boolean') return (stored !== '0') as unknown as T;
  if (typeof defaultValue === 'number') return (parseInt(stored) || defaultValue) as unknown as T;
  return stored as unknown as T;
}

let _theme = $state(loadValue('marginalia_theme', 'dark'));
let _apiKey = $state(loadValue('openrouter_api_key', ''));
let _model = $state(loadValue('openrouter_model', 'x-ai/grok-4.1-fast'));
let _autoCompact = $state(loadValue('marginalia_auto_compact', true));
let _compactThreshold = $state(loadValue('marginalia_compact_threshold', 50000));

export const settings = {
  get theme() { return _theme; },
  set theme(v: string) { _theme = v; localStorage.setItem('marginalia_theme', v); applyTheme(); },

  get apiKey() { return _apiKey; },
  set apiKey(v: string) { _apiKey = v; localStorage.setItem('openrouter_api_key', v); },

  get model() { return _model; },
  set model(v: string) { _model = v; localStorage.setItem('openrouter_model', v); },

  get autoCompact() { return _autoCompact; },
  set autoCompact(v: boolean) { _autoCompact = v; localStorage.setItem('marginalia_auto_compact', v ? '1' : '0'); },

  get compactThreshold() { return _compactThreshold; },
  set compactThreshold(v: number) { _compactThreshold = v; localStorage.setItem('marginalia_compact_threshold', String(v)); },
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

let _chatFontSize = $state(parseInt(localStorage.getItem('marginalia_chat_font') || '14'));
let _chatMono = $state(localStorage.getItem('marginalia_chat_mono') === '1');

export const chatDisplay = {
  get fontSize() { return _chatFontSize; },
  set fontSize(v: number) { _chatFontSize = v; localStorage.setItem('marginalia_chat_font', String(v)); },
  get mono() { return _chatMono; },
  toggleMono() { _chatMono = !_chatMono; localStorage.setItem('marginalia_chat_mono', _chatMono ? '1' : '0'); },
};

// --- Per-book settings ---

export function getBookPrompt(bookId: string): string {
  return localStorage.getItem(`marginalia_prompt_${bookId}`) || '';
}

export function setBookPrompt(bookId: string, prompt: string): void {
  localStorage.setItem(`marginalia_prompt_${bookId}`, prompt);
}
