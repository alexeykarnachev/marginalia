// Marginalia — all magic numbers, thresholds, and storage keys in one place

// ── Agent / API ────────────────────────────────────────────────────
export const MAX_AGENT_ITERATIONS = 10;
export const MAX_INPUT_TOKENS_PER_TURN = 100000;
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const SIMPLE_LLM_TIMEOUT_MS = 30000;

// ── Prompt / context management ────────────────────────────────────
export const RECENT_MSG_COUNT = 12;
export const MAX_OLD_ASSISTANT_CHARS = 400;
export const MAX_OLD_USER_CHARS = 200;
export const MIN_MESSAGES_FOR_COMPACT = 6;
export const MIN_CONV_COUNT_FOR_COMPACT = 14;

// ── Auto-compact thresholds (chat-send) ────────────────────────────
export const AUTO_COMPACT_MSG_LIMIT = 22;
export const AUTO_COMPACT_MSG_MIN = 16;

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

// ── UI defaults ────────────────────────────────────────────────────
export const DEFAULT_CHAT_WIDTH = 380;
export const CHAT_MIN_WIDTH = 280;
export const CHAT_MAX_WIDTH_RATIO = 0.7;
export const DEFAULT_CHAT_FONT_SIZE = 14;
export const FONT_SIZE_SMALL = 12;
export const FONT_SIZE_MEDIUM = 14;
export const FONT_SIZE_LARGE = 16;
export const BOOK_COVER_RENDER_WIDTH = 300;
export const BOOK_COVER_JPEG_QUALITY = 0.8;
export const BOOK_TITLE_TRUNCATE_LENGTH = 30;
export const SELECTION_PREVIEW_LENGTH = 40;

// ── Timing ─────────────────────────────────────────────────────────
export const COPY_FEEDBACK_MS = 1500;
export const SEND_DONE_FEEDBACK_MS = 1500;
export const PDF_INIT_POLL_MS = 100;
export const PDF_INIT_TIMEOUT_MS = 15000;
export const PAGE_SYNC_INTERVAL_MS = 500;
export const PDF_DOC_POLL_MS = 500;
export const PDF_DOC_TIMEOUT_MS = 30000;
export const INDEXING_STATUS_CLEAR_MS = 2000;
export const INDEXING_FAIL_CLEAR_MS = 3000;
export const INDEXING_PROGRESS_INTERVAL = 10;
export const PDFJS_LIB_POLL_MS = 50;
export const PDFJS_LIB_TIMEOUT_MS = 5000;

// ── Default model ──────────────────────────────────────────────────
export const DEFAULT_MODEL = 'x-ai/grok-4.1-fast';
export const DEFAULT_COMPACT_THRESHOLD = 50000;

// ── IndexedDB ──────────────────────────────────────────────────────
export const IDB_NAME = 'marginalia';
export const IDB_VERSION = 2;

// ── localStorage keys ──────────────────────────────────────────────
export const LS_THEME = 'marginalia_theme';
export const LS_API_KEY = 'openrouter_api_key';
export const LS_MODEL = 'openrouter_model';
export const LS_AUTO_COMPACT = 'marginalia_auto_compact';
export const LS_COMPACT_THRESHOLD = 'marginalia_compact_threshold';
export const LS_CHAT_FONT = 'marginalia_chat_font';
export const LS_CHAT_MONO = 'marginalia_chat_mono';
export const LS_DISABLED_TOOLS = 'marginalia_disabled_tools';
export const LS_VIEWER_CHAT_WIDTH = 'marginalia_viewer_chat_width';
export const LS_LIB_CHAT_WIDTH = 'marginalia_lib_chat_width';
export const LS_CHAT_OPEN = 'marginalia_chat_open';
export const LS_LIB_CHAT_OPEN = 'marginalia_lib_chat_open';

// localStorage key builders (per-book keys)
export const lsChatKey = (bookId: string) => `marginalia_chat_${bookId}`;
export const lsStatsKey = (bookId: string) => `marginalia_stats_${bookId}`;
export const lsPromptKey = (bookId: string) => `marginalia_prompt_${bookId}`;
export const lsModelKey = (bookId: string) => `marginalia_model_${bookId}`;

// Per-book data prefixes (used by deleteBookData)
export const BOOK_DATA_PREFIXES = ['chat', 'stats', 'model', 'prompt'] as const;

// ── sessionStorage keys ────────────────────────────────────────────
export const SS_BOOK_ID = 'marginalia_book_id';

// ── Library chat storage key ───────────────────────────────────────
export const LIBRARY_CHAT_STORAGE_KEY = '_library';
