// Marginalia — tool registry and tool definitions for the agentic loop
//
// Tools access any book in the library by ID. The "current book" is the one
// loaded in the PDF viewer (PDFViewerApplication). Other books are accessed
// by loading their data from IndexedDB and extracting text via pdf.js.

import type { Book, Folder, ToolDefinition, LibraryContext } from '../types';
import {
  getAllBooks,
  getBook,
  saveBook,
  deleteBook as deleteBookFromDb,
  getAllFolders,
  getFolder,
  saveFolder,
  deleteFolder as deleteFolderFromDb,
  deleteBookData,
} from './db';

// --- PDFViewerApplication type for window access ---

interface PDFOutlineItem {
  title: string;
  items?: PDFOutlineItem[];
}

interface PDFViewerApp {
  pdfDocument?: {
    getPage: (num: number) => Promise<{
      getTextContent: () => Promise<{ items: { str: string }[] }>;
    }>;
    getOutline: () => Promise<PDFOutlineItem[] | null>;
    numPages: number;
  };
  pagesCount?: number;
  page?: number;
  pdfLinkService?: {
    goToPage: (page: number) => void;
  };
  eventBus?: {
    on: (event: string, handler: () => void) => void;
  };
}

declare const pdfjsLib: {
  getDocument: (params: { data: Uint8Array }) => { promise: Promise<{ getPage: (num: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }>; numPages: number }> };
};

// --- PDF app accessor (set by Svelte ViewerApp to provide iframe's PDFViewerApplication) ---

let _pdfAppGetter: (() => PDFViewerApp | null) | null = null;

export function setPdfAppGetter(getter: (() => PDFViewerApp | null) | null): void {
  _pdfAppGetter = getter;
}

function _getPdfApp(): PDFViewerApp | undefined {
  if (_pdfAppGetter) {
    return _pdfAppGetter() ?? undefined;
  }
  return (window as unknown as { PDFViewerApplication?: PDFViewerApp }).PDFViewerApplication;
}

// --- Tool registry ---

const toolRegistry: ToolDefinition[] = [];

function registerTool(def: ToolDefinition): void {
  toolRegistry.push(def);
}

function _getDisabledTools(): string[] {
  try {
    return JSON.parse(localStorage.getItem('marginalia_disabled_tools') || '[]');
  } catch {
    return [];
  }
}

function _saveDisabledTools(list: string[]): void {
  localStorage.setItem('marginalia_disabled_tools', JSON.stringify(list));
}

export function isToolEnabled(name: string): boolean {
  return !_getDisabledTools().includes(name);
}

export function setToolEnabled(name: string, enabled: boolean): void {
  let disabled = _getDisabledTools();
  if (enabled) {
    disabled = disabled.filter((n) => n !== name);
  } else if (!disabled.includes(name)) {
    disabled.push(name);
  }
  _saveDisabledTools(disabled);
}

export function getToolDefinitions(): {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}[] {
  return toolRegistry
    .filter((t) => isToolEnabled(t.name))
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

export function getAllTools(): { name: string; description: string; enabled: boolean }[] {
  return toolRegistry.map((t) => ({
    name: t.name,
    description: t.description,
    enabled: isToolEnabled(t.name),
  }));
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = toolRegistry.find((t) => t.name === name);
  if (!tool) return `Error: unknown tool "${name}"`;
  try {
    return await tool.handler(args);
  } catch (err) {
    return `Error executing ${name}: ${(err as Error).message}`;
  }
}

// --- Book page text access ---
// Abstraction over PDFViewerApplication (current book) and IndexedDB (any book).
// In tests, _bookPageProvider is replaced with an in-memory implementation.

export interface BookPageProvider {
  getPageText: (bookId: string, pageNum: number) => Promise<string>;
  getPageCount: (bookId: string) => Promise<number>;
  getCurrentBookId: () => string | null;
}

let _bookPageProvider: BookPageProvider | null = null;

export function setBookPageProvider(provider: BookPageProvider | null): void {
  _bookPageProvider = provider;
}

async function _getCurrentBookId(): Promise<string | null> {
  return sessionStorage.getItem('marginalia_book_id') || null;
}

async function _getPageTextFromViewer(pageNum: number): Promise<string> {
  const app = _getPdfApp();
  if (!app?.pdfDocument) return '';
  try {
    const page = await app.pdfDocument.getPage(pageNum);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str).join(' ');
  } catch {
    return '';
  }
}

async function _getPageCountFromViewer(): Promise<number> {
  const app = _getPdfApp();
  return app?.pagesCount || 0;
}

async function _loadPdfDoc(book: Book) {
  const blob =
    book.data instanceof Blob ? book.data : new Blob([book.data], { type: 'application/pdf' });
  const buf = await blob.arrayBuffer();
  return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
}

export async function getBookPageText(bookId: string, pageNum: number): Promise<string> {
  if (_bookPageProvider) return await _bookPageProvider.getPageText(bookId, pageNum);

  const currentId = await _getCurrentBookId();
  if (!bookId || bookId === currentId) {
    return _getPageTextFromViewer(pageNum);
  }
  // Non-current book: use pre-extracted pages if available, else extract from PDF
  try {
    const book = await getBook(bookId);
    if (!book) return '(book not found)';
    if (book.pages && book.pages[pageNum - 1] !== undefined) {
      return book.pages[pageNum - 1];
    }
    // Fallback: extract from raw PDF data
    const pdf = await _loadPdfDoc(book);
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str).join(' ');
  } catch {
    return '(could not extract text from book)';
  }
}

export async function getBookPageCount(bookId: string): Promise<number> {
  if (_bookPageProvider) return await _bookPageProvider.getPageCount(bookId);

  const currentId = await _getCurrentBookId();
  if (!bookId || bookId === currentId) {
    return _getPageCountFromViewer();
  }
  try {
    const book = await getBook(bookId);
    if (!book) return 0;
    if (book.pages) return book.pages.length;
    // Fallback: count from raw PDF
    const pdf = await _loadPdfDoc(book);
    return pdf.numPages;
  } catch {
    return 0;
  }
}

async function _resolveBookId(bookId?: string): Promise<string | null> {
  if (bookId) return bookId;
  if (_bookPageProvider) return _bookPageProvider.getCurrentBookId();
  return await _getCurrentBookId();
}

async function _resolveBookTitle(bookId: string): Promise<string> {
  const book = await getBook(bookId);
  return book ? book.title : bookId;
}

// --- Library context (injected into system prompt, used by UI) ---
// Single source of truth for all library/reading state.

function _formatSize(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

// External hooks — set by the app layer
let _cachedSelection = '';
let _getPageHistoryFn: (() => number[]) | null = null;
let _onBookChangeFn: ((bookId: string) => void) | null = null;

export function setCachedSelection(selection: string): void {
  _cachedSelection = selection;
}

export function setGetPageHistoryFn(fn: (() => number[]) | null): void {
  _getPageHistoryFn = fn;
}

export function setOnBookChangeFn(fn: ((bookId: string) => void) | null): void {
  _onBookChangeFn = fn;
}

export async function buildLibraryContext(): Promise<LibraryContext> {
  const folders = await getAllFolders();
  const books = await getAllBooks();

  // Library tree
  function buildTree(parentId: string | null, indent: string): string[] {
    const lines: string[] = [];
    for (const f of folders.filter((f) => (f.parent_id || null) === parentId)) {
      lines.push(`${indent}[folder] ${f.name} (id: ${f.id})`);
      lines.push(...buildTree(f.id, indent + '  '));
    }
    for (const b of books.filter((b) => (b.folder_id || null) === parentId)) {
      const pages = b.pages ? b.pages.length : '?';
      const size = _formatSize(b.size || 0);
      lines.push(`${indent}[book] ${b.title} (${pages} pages, ${size}, id: ${b.id})`);
    }
    return lines;
  }
  const treeLines = buildTree(null, '');
  const libraryTree = treeLines.length ? treeLines.join('\n') : '(empty library)';

  // Storage stats
  const totalSize = books.reduce((s, b) => s + (b.size || 0), 0);
  const totalPages = books.reduce((s, b) => s + (b.pages ? b.pages.length : 0), 0);

  // Current book focus
  const currentBookId =
    _bookPageProvider
      ? (_bookPageProvider.getCurrentBookId() ?? '')
      : ((await _getCurrentBookId()) ?? '');
  const currentBook = books.find((b) => b.id === currentBookId);

  const app =
    typeof window !== 'undefined'
      ? _getPdfApp()
      : null;
  const currentPage = app?.page || 1;
  const currentPageCount = currentBook?.pages
    ? currentBook.pages.length
    : app?.pagesCount || 0;

  // Page text
  let pageText = '';
  if (currentBookId) {
    pageText = await getBookPageText(currentBookId, currentPage);
  }

  // Selection: use cached selection (captured before focus moves to chat input)
  const selection = _cachedSelection || '';

  // Page history
  const history = _getPageHistoryFn ? _getPageHistoryFn() : [];
  const pageHistoryStr = history.length
    ? history.slice(-20).map((p) => `p.${p}`).join(' -> ') + ` -> p.${currentPage} (current)`
    : '';

  // Focus context
  const focusParts: string[] = [];
  if (currentBook) {
    focusParts.push(`Reading: "${currentBook.title}" (id: ${currentBookId})`);
    focusParts.push(`Page: ${currentPage} of ${currentPageCount}`);
  } else {
    focusParts.push('No book currently open');
  }
  focusParts.push(`Time: ${new Date().toLocaleString()}`);
  focusParts.push(
    `Library: ${books.length} books, ${folders.length} folders, ${_formatSize(totalSize)} total, ${totalPages} pages`
  );
  const focusContext = focusParts.join('\n');

  return {
    // For system prompt template
    libraryTree,
    focusContext,
    pageText,
    selection,
    pageHistory: pageHistoryStr,
    page: currentPage,
    totalPages: currentPageCount,
    title: currentBook?.title || '',
    time: new Date().toLocaleString(),
    // For UI / logging
    currentBookId,
    currentBookTitle: currentBook?.title || '',
    bookCount: books.length,
    folderCount: folders.length,
    totalSize,
    totalPageCount: totalPages,
  };
}

// --- Reading tools ---

// Bulk page text access (in-memory, no per-page async)
async function _getAllPageTexts(bookId: string): Promise<string[]> {
  if (_bookPageProvider) {
    const count = await _bookPageProvider.getPageCount(bookId);
    const pages: string[] = [];
    for (let i = 0; i < count; i++) pages.push(await _bookPageProvider.getPageText(bookId, i + 1));
    return pages;
  }
  const book = await getBook(bookId);
  if (book?.pages) return book.pages;
  const count = await getBookPageCount(bookId);
  const pages: string[] = [];
  for (let i = 1; i <= count; i++) pages.push(await getBookPageText(bookId, i));
  return pages;
}

// Shared regex builder
function _buildRegex(query: string): RegExp {
  try {
    return new RegExp(query, 'gi');
  } catch {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
}

function _extractSnippet(text: string, match: RegExpMatchArray, contextChars = 80): string {
  const start = Math.max(0, match.index! - contextChars);
  const end = Math.min(text.length, match.index! + match[0].length + contextChars);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// --- Tool definitions (all 17) ---

registerTool({
  name: 'read_page',
  description: 'Read extracted text from a specific page of any book.',
  parameters: {
    type: 'object',
    properties: {
      page: { type: 'integer', description: 'Page number (1-based)' },
      book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
    },
    required: ['page'],
  },
  handler: async ({ page, book_id }: { page: number; book_id?: string }) => {
    const bid = await _resolveBookId(book_id);
    if (!bid) return 'Error: no book specified and no current book';
    const total = await getBookPageCount(bid);
    if (page < 1 || page > total) return `Error: page ${page} out of range (1-${total})`;
    const title = await _resolveBookTitle(bid);
    const text = await getBookPageText(bid, page);
    return `[${title}, p.${page}/${total}]\n${text || '(no extractable text)'}`;
  },
});

registerTool({
  name: 'read_pages',
  description:
    'Read a range of pages from any book. More efficient than multiple read_page calls. Max 20 pages per call.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'integer', description: 'Start page (1-based)' },
      to: { type: 'integer', description: 'End page (inclusive)' },
      book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
    },
    required: ['from', 'to'],
  },
  handler: async ({ from, to, book_id }: { from: number; to: number; book_id?: string }) => {
    const bid = await _resolveBookId(book_id);
    if (!bid) return 'Error: no book specified and no current book';
    const total = await getBookPageCount(bid);
    if (from < 1 || to > total || from > to)
      return `Error: invalid range ${from}-${to} (book has ${total} pages)`;
    const clamped = Math.min(to, from + 19); // max 20 pages
    const title = await _resolveBookTitle(bid);
    const parts: string[] = [];
    for (let i = from; i <= clamped; i++) {
      const text = await getBookPageText(bid, i);
      parts.push(`--- p.${i} ---\n${text || '(no extractable text)'}`);
    }
    let header = `[${title}, p.${from}-${clamped}/${total}]`;
    if (clamped < to) header += ` (capped at 20 pages, requested up to ${to})`;
    return header + '\n\n' + parts.join('\n\n');
  },
});

registerTool({
  name: 'get_table_of_contents',
  description:
    'Get the table of contents / chapter structure of a book. Tries PDF outline first, then scans early pages for a TOC.',
  parameters: {
    type: 'object',
    properties: {
      book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
    },
  },
  handler: async ({ book_id }: { book_id?: string } = {}) => {
    const bid = await _resolveBookId(book_id);
    if (!bid) return 'Error: no book specified and no current book';
    const title = await _resolveBookTitle(bid);
    const total = await getBookPageCount(bid);

    // Try PDF outline (structured TOC from PDF metadata)
    try {
      const app = (window as unknown as { PDFViewerApplication?: PDFViewerApp })
        .PDFViewerApplication;
      const currentId = await _getCurrentBookId();
      if (bid === currentId && app?.pdfDocument) {
        const outline = await app.pdfDocument.getOutline();
        if (outline && outline.length > 0) {
          const lines: string[] = [];
          function walk(items: PDFOutlineItem[], indent: string): void {
            for (const item of items) {
              lines.push(`${indent}${item.title}`);
              if (item.items) walk(item.items, indent + '  ');
            }
          }
          walk(outline, '');
          return `[${title}] Table of Contents (PDF outline):\n${lines.join('\n')}`;
        }
      }
    } catch {
      // ignore
    }

    // Fallback: search for chapter/part headings across the book
    const pages = await _getAllPageTexts(bid);
    const headingPatterns = [
      /(?:^|\s)(Chapter|Part|Book|Section)\s+(\d+|[IVXLC]+(?:\s|$))/gi,
      /(?:^|\s)(\u0413\u043B\u0430\u0432\u0430|\u0427\u0430\u0441\u0442\u044C|\u0420\u0430\u0437\u0434\u0435\u043B)\s+(\d+|[IVXLC]+(?:\s|$))/gi,
      /(?:^|\s)\u00A7\s*\d+/g,
    ];

    const chapters: string[] = [];
    for (let i = 0; i < pages.length && chapters.length < 50; i++) {
      const text = pages[i];
      for (const re of headingPatterns) {
        re.lastIndex = 0;
        const m = re.exec(text);
        if (m) {
          // Grab some context around the heading
          const start = Math.max(0, m.index);
          const snippet = text.slice(start, start + 80).trim();
          chapters.push(`p.${i + 1}: ${snippet}`);
          break;
        }
      }
    }

    const TOC_WARNING =
      "\n\nWARNING: Page numbers printed in the book's TOC may NOT match PDF page numbers. To navigate, use search_book to find the actual PDF page, or use the p.N numbers shown above (those ARE PDF page numbers).";

    if (chapters.length > 0) {
      return `[${title}] Chapter/section headings found (${total} pages):\n${chapters.join('\n')}${TOC_WARNING}`;
    }

    // Last resort: scan first pages for a TOC-like page (dense with numbers + keywords)
    const tocKeywords =
      /contents|table of contents|\u043E\u0433\u043B\u0430\u0432\u043B\u0435\u043D\u0438\u0435|\u0441\u043E\u0434\u0435\u0440\u0436\u0430\u043D\u0438\u0435/i;
    for (let i = 0; i < Math.min(15, pages.length); i++) {
      if (tocKeywords.test(pages[i])) {
        return `[${title}] Table of Contents page found (p.${i + 1}/${total}):\n${pages[i].slice(0, 3000)}${TOC_WARNING}`;
      }
    }

    // Nothing found — return first 3 page previews so the agent can orient
    const preview = pages
      .slice(0, 3)
      .map((t, i) => `p.${i + 1}: ${t.slice(0, 200)}`)
      .join('\n\n');
    return `[${title}] No structured TOC found (${total} pages). First pages:\n${preview}`;
  },
});

registerTool({
  name: 'search_book',
  description:
    "Grep for a regex pattern across all pages of a book. Case-insensitive. Supports | (alternation), \\d, character classes, etc. Returns matching pages with snippets and match counts.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          "Regex pattern (e.g. 'guilt|conscience', 'theorem \\d+', 'Raskolnikov.*axe')",
      },
      book_id: { type: 'string', description: 'Book ID. Omit for current book.' },
      limit: { type: 'integer', description: 'Max results to return (default 20)' },
    },
    required: ['query'],
  },
  handler: async ({
    query,
    book_id,
    limit,
  }: {
    query: string;
    book_id?: string;
    limit?: number;
  }) => {
    const bid = await _resolveBookId(book_id);
    if (!bid) return 'Error: no book specified and no current book';
    if (!query) return 'Error: empty query';
    const maxResults = Math.min(limit || 20, 50);
    const title = await _resolveBookTitle(bid);
    const pages = await _getAllPageTexts(bid);
    const re = _buildRegex(query);

    const results: string[] = [];
    let totalMatches = 0;
    let totalPages = 0;
    for (let i = 0; i < pages.length; i++) {
      const text = pages[i];
      const matches = [...text.matchAll(re)];
      if (matches.length > 0) {
        totalMatches += matches.length;
        totalPages++;
        if (results.length < maxResults) {
          const snippet = _extractSnippet(text, matches[0]);
          const countSuffix =
            matches.length > 1 ? ` (${matches.length} matches on page)` : '';
          results.push(`p.${i + 1}${countSuffix}: ${snippet}`);
        }
      }
    }
    const header = `[${title}] grep /${query}/i`;
    const summary = `${totalMatches} total match(es) across ${totalPages} page(s)`;
    if (!results.length) return `${header} — no matches`;
    let output = `${header} — ${summary}`;
    if (results.length < totalPages) output += ` (showing first ${results.length} pages)`;
    return output + `:\n\n${results.join('\n\n')}`;
  },
});

registerTool({
  name: 'search_all_books',
  description:
    'Grep for a regex pattern across ALL books in the library (or a subset). Returns results grouped by book.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Regex pattern' },
      book_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: only search these books. Omit to search all.',
      },
      limit_per_book: { type: 'integer', description: 'Max results per book (default 5)' },
    },
    required: ['query'],
  },
  handler: async ({
    query,
    book_ids,
    limit_per_book,
  }: {
    query: string;
    book_ids?: string[];
    limit_per_book?: number;
  }) => {
    if (!query) return 'Error: empty query';
    const maxPerBook = Math.min(limit_per_book || 5, 20);
    const re = _buildRegex(query);
    const books = await getAllBooks();
    const targets = book_ids ? books.filter((b) => book_ids.includes(b.id)) : books;

    const sections: string[] = [];
    let grandTotal = 0;
    for (const book of targets) {
      const pages = await _getAllPageTexts(book.id);
      const results: string[] = [];
      let bookMatches = 0;
      for (let i = 0; i < pages.length; i++) {
        const matches = [...pages[i].matchAll(re)];
        if (matches.length > 0) {
          bookMatches += matches.length;
          if (results.length < maxPerBook) {
            const snippet = _extractSnippet(pages[i], matches[0], 60);
            results.push(`  p.${i + 1}: ${snippet}`);
          }
        }
      }
      grandTotal += bookMatches;
      if (bookMatches > 0) {
        let header = `[${book.title}] ${bookMatches} match(es)`;
        if (results.length < bookMatches) header += ` (showing ${results.length} pages)`;
        sections.push(header + ':\n' + results.join('\n'));
      }
    }
    const header = `grep /${query}/i across ${targets.length} book(s) — ${grandTotal} total match(es)`;
    return sections.length ? header + '\n\n' + sections.join('\n\n') : header + ' — no matches';
  },
});

// --- Navigation tools ---

registerTool({
  name: 'go_to_page',
  description: 'Navigate the reader to a specific page of the current book.',
  parameters: {
    type: 'object',
    properties: { page: { type: 'integer', description: 'Page number (1-based)' } },
    required: ['page'],
  },
  handler: async ({ page }: { page: number }) => {
    const app = (window as unknown as { PDFViewerApplication?: PDFViewerApp })
      .PDFViewerApplication;
    const total = app?.pagesCount || 0;
    if (page < 1 || page > total) return `Error: page ${page} out of range (1-${total})`;
    const current = app!.page!;
    if (current !== page) {
      pageHistory.push(current);
      if (app!.pdfLinkService) {
        app!.pdfLinkService.goToPage(page);
      } else {
        app!.page = page;
      }
    }
    return `Navigated to page ${page}` + (current !== page ? ` (was on page ${current})` : '');
  },
});

registerTool({
  name: 'go_back',
  description: 'Navigate back to the previous page in history.',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const app = (window as unknown as { PDFViewerApplication?: PDFViewerApp })
      .PDFViewerApplication;
    const current = app?.page || '?';
    if (pageHistory.length === 0)
      return `No previous page in history (currently on page ${current})`;
    const prev = pageHistory.pop()!;
    if (app) app.page = prev;
    return `Returned to page ${prev} (was on page ${current})`;
  },
});

registerTool({
  name: 'open_book',
  description:
    'Open a different book from the library in the reader. This navigates the user to that book.',
  parameters: {
    type: 'object',
    properties: { book_id: { type: 'string', description: 'Book ID to open' } },
    required: ['book_id'],
  },
  handler: async ({ book_id }: { book_id: string }) => {
    const book = await getBook(book_id);
    if (!book) return `Error: book "${book_id}" not found`;
    // In browser: navigate to viewer with this book
    sessionStorage.setItem('marginalia_book_id', book_id);
    // Signal to the UI that we need to reload (the actual navigation happens in the browser)
    if (_onBookChangeFn) _onBookChangeFn(book_id);
    return `Opened "${book.title}"`;
  },
});

// --- Library management tools ---

registerTool({
  name: 'rename_book',
  description: 'Rename a book in the library.',
  parameters: {
    type: 'object',
    properties: {
      book_id: { type: 'string', description: 'Book ID' },
      new_title: { type: 'string', description: 'New title' },
    },
    required: ['book_id', 'new_title'],
  },
  handler: async ({ book_id, new_title }: { book_id: string; new_title: string }) => {
    const book = await getBook(book_id);
    if (!book) return `Error: book "${book_id}" not found`;
    book.title = new_title;
    await saveBook(book);
    return `Renamed to "${new_title}"`;
  },
});

registerTool({
  name: 'move_book',
  description: 'Move a book into a folder, or to root (folder_id = null).',
  parameters: {
    type: 'object',
    properties: {
      book_id: { type: 'string', description: 'Book ID' },
      folder_id: {
        type: ['string', 'null'],
        description: 'Target folder ID, or null for root',
      },
    },
    required: ['book_id', 'folder_id'],
  },
  handler: async ({
    book_id,
    folder_id,
  }: {
    book_id: string;
    folder_id: string | null;
  }) => {
    const book = await getBook(book_id);
    if (!book) return `Error: book "${book_id}" not found`;
    if (folder_id) {
      const folder = await getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
    }
    book.folder_id = folder_id || null;
    await saveBook(book);
    const dest = folder_id ? `folder "${(await getFolder(folder_id))!.name}"` : 'root';
    return `Moved "${book.title}" to ${dest}`;
  },
});

registerTool({
  name: 'delete_book',
  description: 'Delete a book from the library permanently.',
  parameters: {
    type: 'object',
    properties: { book_id: { type: 'string', description: 'Book ID' } },
    required: ['book_id'],
  },
  handler: async ({ book_id }: { book_id: string }) => {
    const book = await getBook(book_id);
    if (!book) return `Error: book "${book_id}" not found`;
    await deleteBookFromDb(book_id);
    deleteBookData(book_id);
    return `Deleted "${book.title}"`;
  },
});

registerTool({
  name: 'create_folder',
  description: 'Create a new folder. Optionally nest inside a parent folder.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Folder name' },
      parent_id: {
        type: ['string', 'null'],
        description: 'Parent folder ID, or null for root',
      },
    },
    required: ['name'],
  },
  handler: async ({ name, parent_id }: { name: string; parent_id?: string | null }) => {
    if (parent_id) {
      const parent = await getFolder(parent_id);
      if (!parent) return `Error: parent folder "${parent_id}" not found`;
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await saveFolder({ id, name, parent_id: parent_id || null });
    return `Created folder "${name}"\nfolder_id: ${id}\nUse this folder_id to move books into it.`;
  },
});

registerTool({
  name: 'rename_folder',
  description: 'Rename a folder.',
  parameters: {
    type: 'object',
    properties: {
      folder_id: { type: 'string', description: 'Folder ID' },
      new_name: { type: 'string', description: 'New name' },
    },
    required: ['folder_id', 'new_name'],
  },
  handler: async ({ folder_id, new_name }: { folder_id: string; new_name: string }) => {
    const folder = await getFolder(folder_id);
    if (!folder) return `Error: folder "${folder_id}" not found`;
    folder.name = new_name;
    await saveFolder(folder);
    return `Renamed folder to "${new_name}"`;
  },
});

async function _reparentFolderContents(
  folderId: string,
  newParentId: string | null
): Promise<void> {
  const books = await getAllBooks();
  for (const b of books) {
    if (b.folder_id === folderId) {
      b.folder_id = newParentId;
      await saveBook(b);
    }
  }
  const folders = await getAllFolders();
  for (const f of folders) {
    if (f.parent_id === folderId) {
      f.parent_id = newParentId;
      await saveFolder(f);
    }
  }
}

registerTool({
  name: 'delete_folder',
  description: 'Delete a folder. Contents (books and subfolders) move to the parent folder.',
  parameters: {
    type: 'object',
    properties: { folder_id: { type: 'string', description: 'Folder ID' } },
    required: ['folder_id'],
  },
  handler: async ({ folder_id }: { folder_id: string }) => {
    const folder = await getFolder(folder_id);
    if (!folder) return `Error: folder "${folder_id}" not found`;
    const parentId = folder.parent_id || null;
    await _reparentFolderContents(folder_id, parentId);
    await deleteFolderFromDb(folder_id);
    return `Deleted folder "${folder.name}"`;
  },
});

registerTool({
  name: 'move_folder',
  description: 'Move a folder to a new parent, or to root (parent_id = null).',
  parameters: {
    type: 'object',
    properties: {
      folder_id: { type: 'string', description: 'Folder ID to move' },
      parent_id: {
        type: ['string', 'null'],
        description: 'New parent folder ID, or null for root',
      },
    },
    required: ['folder_id', 'parent_id'],
  },
  handler: async ({
    folder_id,
    parent_id,
  }: {
    folder_id: string;
    parent_id: string | null;
  }) => {
    const folder = await getFolder(folder_id);
    if (!folder) return `Error: folder "${folder_id}" not found`;
    if (parent_id) {
      const parent = await getFolder(parent_id);
      if (!parent) return `Error: parent folder "${parent_id}" not found`;
      // Prevent circular nesting
      let check: string | null = parent_id;
      while (check) {
        if (check === folder_id) return 'Error: cannot move folder into its own descendant';
        const p = await getFolder(check);
        check = p?.parent_id || null;
      }
    }
    folder.parent_id = parent_id || null;
    await saveFolder(folder);
    const dest = parent_id ? `"${(await getFolder(parent_id))!.name}"` : 'root';
    return `Moved folder "${folder.name}" to ${dest}`;
  },
});

// --- Batch operations ---

registerTool({
  name: 'batch_move_books',
  description: 'Move multiple books to a folder in one operation.',
  parameters: {
    type: 'object',
    properties: {
      book_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Book IDs to move',
      },
      folder_id: {
        type: ['string', 'null'],
        description: 'Target folder ID, or null for root',
      },
    },
    required: ['book_ids', 'folder_id'],
  },
  handler: async ({
    book_ids,
    folder_id,
  }: {
    book_ids: string[];
    folder_id: string | null;
  }) => {
    if (folder_id) {
      const folder = await getFolder(folder_id);
      if (!folder) return `Error: folder "${folder_id}" not found`;
    }
    const results: string[] = [];
    for (const id of book_ids) {
      const book = await getBook(id);
      if (!book) {
        results.push(`${id}: not found`);
        continue;
      }
      book.folder_id = folder_id || null;
      await saveBook(book);
      results.push(`"${book.title}": moved`);
    }
    const dest = folder_id ? `folder "${(await getFolder(folder_id))!.name}"` : 'root';
    return `Moved ${book_ids.length} book(s) to ${dest}:\n${results.join('\n')}`;
  },
});

registerTool({
  name: 'batch_rename_books',
  description: 'Rename multiple books in one operation.',
  parameters: {
    type: 'object',
    properties: {
      renames: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            book_id: { type: 'string' },
            new_title: { type: 'string' },
          },
          required: ['book_id', 'new_title'],
        },
        description: 'Array of {book_id, new_title} pairs',
      },
    },
    required: ['renames'],
  },
  handler: async ({
    renames,
  }: {
    renames: { book_id: string; new_title: string }[];
  }) => {
    const results: string[] = [];
    for (const { book_id, new_title } of renames) {
      const book = await getBook(book_id);
      if (!book) {
        results.push(`${book_id}: not found`);
        continue;
      }
      const old = book.title;
      book.title = new_title;
      await saveBook(book);
      results.push(`"${old}" -> "${new_title}"`);
    }
    return `Renamed ${renames.length} book(s):\n${results.join('\n')}`;
  },
});

// --- Page navigation history ---

const pageHistory: number[] = [];
const MAX_HISTORY = 50;
let _lastTrackedPage: number | null = null;

export function trackPageChange(): void {
  const app = _getPdfApp();
  if (!app) return;
  const current = app.page!;
  if (current !== _lastTrackedPage) {
    if (_lastTrackedPage !== null) {
      pageHistory.push(_lastTrackedPage);
      if (pageHistory.length > MAX_HISTORY) pageHistory.shift();
    }
    _lastTrackedPage = current;
  }
}

export function getPageHistory(): number[] {
  return [...pageHistory];
}

export function initPageTracking(): void {
  const app = _getPdfApp();
  if (app) {
    _lastTrackedPage = app.page!;
    app.eventBus?.on('pagechanging', () => trackPageChange());
  }
}
