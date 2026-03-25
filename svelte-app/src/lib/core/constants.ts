// Marginalia — tunable parameters and shared keys
// Only things that are: (a) tunable behavior, or (b) shared across multiple modules

// ── Agent / API ────────────────────────────────────────────────────
export const MAX_AGENT_ITERATIONS = 10;
export const MAX_INPUT_TOKENS_PER_TURN = 100000;
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const SIMPLE_LLM_TIMEOUT_MS = 30000;

// ── Tool result compression ────────────────────────────────────────
export const TOOL_RESULT_MIN_COMPRESS_LENGTH = 500;
export const SEARCH_RESULT_BLOCKS_TO_KEEP = 4;
export const GENERIC_COMPRESS_CHARS = 200;
export const SEARCH_SNIPPET_CONTEXT_CHARS = 80;
export const CROSS_BOOK_SNIPPET_CONTEXT_CHARS = 60;

// ── Tool limits ────────────────────────────────────────────────────
export const READ_PAGES_MAX = 20;
export const SEARCH_BOOK_DEFAULT_LIMIT = 20;
export const SEARCH_BOOK_MAX_LIMIT = 50;
export const SEARCH_ALL_BOOKS_DEFAULT_LIMIT = 5;
export const SEARCH_ALL_BOOKS_MAX_LIMIT = 20;
export const TOC_HEADING_MAX = 50;
export const TOC_SCAN_FIRST_PAGES = 15;
export const TOC_PAGE_TEXT_MAX_CHARS = 3000;
export const TOC_PREVIEW_PAGES = 3;
export const TOC_PREVIEW_CHARS = 200;
export const TOC_HEADING_CONTEXT_CHARS = 80;

// ── Page history ───────────────────────────────────────────────────
export const MAX_PAGE_HISTORY = 50;
export const PAGE_HISTORY_DISPLAY_LIMIT = 20;

// ── UI defaults (shared across components) ─────────────────────────
export const DEFAULT_CHAT_WIDTH = 380;
export const DEFAULT_CHAT_FONT_SIZE = 14;

// ── Default model ──────────────────────────────────────────────────
export const DEFAULT_MODEL = 'x-ai/grok-4.1-fast';

// ── IndexedDB ──────────────────────────────────────────────────────
export const IDB_NAME = 'marginalia';
export const IDB_VERSION = 2;

// ── localStorage keys ──────────────────────────────────────────────
export const LS_THEME = 'marginalia_theme';
export const LS_API_KEY = 'openrouter_api_key';
export const LS_MODEL = 'openrouter_model';
export const LS_CHAT_FONT = 'marginalia_chat_font';
export const LS_CHAT_MONO = 'marginalia_chat_mono';
export const LS_DISABLED_TOOLS = 'marginalia_disabled_tools';
export const LS_VIEWER_CHAT_WIDTH = 'marginalia_viewer_chat_width';
export const LS_LIB_CHAT_WIDTH = 'marginalia_lib_chat_width';
export const LS_CHAT_OPEN = 'marginalia_chat_open';
export const LS_LIB_CHAT_OPEN = 'marginalia_lib_chat_open';

// localStorage key builders (per-book)
export const lsChatKey = (bookId: string) => `marginalia_chat_${bookId}`;
export const lsStatsKey = (bookId: string) => `marginalia_stats_${bookId}`;
export const lsPromptKey = (bookId: string) => `marginalia_prompt_${bookId}`;
export const lsCompactPromptKey = (bookId: string) => `marginalia_compact_prompt_${bookId}`;

// ── sessionStorage keys ────────────────────────────────────────────
export const SS_BOOK_ID = 'marginalia_book_id';
export const SS_FOLDER_ID = 'marginalia_folder';

