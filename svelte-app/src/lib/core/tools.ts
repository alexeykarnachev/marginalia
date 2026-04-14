// Marginalia — tool registry and tool definitions for the agentic loop
//
// Tools access any book in the library by ID. The "current book" is the one
// loaded in the PDF viewer (PDFViewerApplication). Other books are accessed
// by loading their data from IndexedDB and extracting text via pdf.js.

import type { Book, Folder, ToolDefinition, LibraryContext } from '../types';
import { log } from './logger';
import {
  LS_DISABLED_TOOLS,
  PAGE_HISTORY_DISPLAY_LIMIT,
  READ_PAGES_MAX,
  SEARCH_BOOK_DEFAULT_LIMIT,
  SEARCH_BOOK_MAX_LIMIT,
  SEARCH_ALL_BOOKS_DEFAULT_LIMIT,
  SEARCH_ALL_BOOKS_MAX_LIMIT,
  CROSS_BOOK_SNIPPET_CONTEXT_CHARS,
  TOC_HEADING_MAX,
  TOC_SCAN_FIRST_PAGES,
  TOC_PAGE_TEXT_MAX_CHARS,
  TOC_PREVIEW_PAGES,
  TOC_PREVIEW_CHARS,
  TOC_HEADING_CONTEXT_CHARS,
} from './constants';
import {
  getBook as dbGetBook,
  deleteBookData,
} from './db';
import { library } from '../state/library.svelte';
import { deleteChat } from './chat-registry';
import type { ToolRegistrationHelpers } from './tools-shared';
import { registerReadingTools } from './tools-reading';
import { registerNavigationTools } from './tools-navigation';
import { registerLibraryTools } from './tools-library';

declare const pdfjsLib: {
  getDocument: (params: { data: Uint8Array }) => { promise: Promise<{ getPage: (num: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }>; numPages: number }> };
};

import {
  getPdfApp as _getPdfApp,
  getCurrentBookId as _viewerGetCurrentBookId,
  getCachedSelection,
  getPageHistoryFromViewer,
  getOnBookChangeFn,
} from '../state/viewer-hooks';

// Re-export setters for ViewerApp/App to use
export {
  setPdfAppGetter,
  setCurrentBookIdFn,
  setCachedSelection,
  setGetPageHistoryFn,
  setOnBookChangeFn,
} from '../state/viewer-hooks';

// --- Tool registry ---

const toolRegistry: ToolDefinition[] = [];

function registerTool(def: ToolDefinition): void {
  toolRegistry.push(def);
}

function _getDisabledTools(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_DISABLED_TOOLS) || '[]');
  } catch {
    return [];
  }
}

function _saveDisabledTools(list: string[]): void {
  localStorage.setItem(LS_DISABLED_TOOLS, JSON.stringify(list));
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
  if (!tool) {
    log('TOOL', `unknown tool "${name}"`);
    return `Error: unknown tool "${name}"`;
  }
  const argsStr = (() => {
    try { return JSON.stringify(args); } catch { return '[unserializable]'; }
  })();
  log('TOOL', `call ${name}(${argsStr.slice(0, 500)})`);
  try {
    const result = await tool.handler(args);
    log('TOOL', `ok ${name} -> ${String(result).slice(0, 200)}`);
    return result;
  } catch (err) {
    const e = err as Error;
    log('TOOL', `FAIL ${name}: ${e.name}: ${e.message}${e.stack ? '\n' + e.stack : ''}`);
    return `Error executing ${name}: ${e.message}`;
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
  return _viewerGetCurrentBookId();
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
    const book = await dbGetBook(bookId);
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
    const book = await dbGetBook(bookId);
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
  const meta = library.getBook(bookId);
  return meta ? meta.title : bookId;
}

// --- Library context (injected into system prompt, used by UI) ---
// Single source of truth for all library/reading state.

import { formatSize as _formatSize } from './library-tree';


export async function buildLibraryContext(): Promise<LibraryContext> {
  const books = library.books;
  const folders = library.folders;

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
  const selection = getCachedSelection();

  // Page history
  const history = getPageHistoryFromViewer();
  const pageHistoryStr = history.length
    ? history.slice(-PAGE_HISTORY_DISPLAY_LIMIT).map((p) => `p.${p}`).join(' -> ') + ` -> p.${currentPage} (current)`
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

  const context: LibraryContext = {
    // For system prompt template
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
  return context;
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
  const book = await dbGetBook(bookId);
  if (book?.pages) return book.pages;
  const count = await getBookPageCount(bookId);
  const pages: string[] = [];
  for (let i = 1; i <= count; i++) pages.push(await getBookPageText(bookId, i));
  return pages;
}

import { buildRegex as _buildRegex, extractSnippet as _extractSnippet } from './text-utils';

// --- Tool definitions (composed from domain modules) ---

// Re-export page tracking functions for ViewerApp
export {
  initPageTracking,
  disposePageTracking,
  getPageHistory,
  clearPageHistory,
} from './page-tracker';
import { pageHistory, setSuppressNextTrackedPageChange } from './page-tracker';

const registrationHelpers: ToolRegistrationHelpers = {
  getPdfApp: _getPdfApp,
  getCurrentBookId: _getCurrentBookId,
  resolveBookId: _resolveBookId,
  resolveBookTitle: _resolveBookTitle,
  getBookPageText,
  getBookPageCount,
  getAllPageTexts: _getAllPageTexts,
  buildRegex: _buildRegex,
  extractSnippet: _extractSnippet,
  getAllBooksMeta: async () => library.books,
  getBookMeta: async (id: string) => library.getBook(id) ?? null,
  getBook: (id: string) => dbGetBook(id),
  saveBook: (book) => library.addBook(book),
  updateBookMeta: (id: string, partial: any) => library.updateBook(id, partial),
  saveBooksMetaBatch: (metas: any) => library.saveBooksMetaBatch(metas),
  deleteBook: (id: string) => library.deleteBook(id),
  getAllFolders: async () => library.folders,
  getFolder: async (id: string) => library.getFolder(id) ?? null,
  saveFolder: async (folder: any) => {
    if (library.getFolder(folder.id)) {
      await library.updateFolder(folder.id, folder);
    } else {
      await library.addFolder(folder);
    }
  },
  saveFolders: (folders: any) => library.saveFoldersBatch(folders),
  deleteFolder: (id: string) => library.deleteFolder(id),
  deleteBookData,
  deleteChat,
  getOnBookChange: getOnBookChangeFn,
  pageHistory,
  setSuppressNextTrackedPageChange,
};

registerReadingTools(registerTool, registrationHelpers);
registerNavigationTools(registerTool, registrationHelpers);
registerLibraryTools(registerTool, registrationHelpers);
