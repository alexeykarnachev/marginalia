import type { Book, Folder, ToolDefinition } from '../types';

export interface PDFOutlineItem {
  title: string;
  items?: PDFOutlineItem[];
}

export interface PDFViewerApp {
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
    off?: (event: string, handler: () => void) => void;
  };
}

export interface ToolRegistrationHelpers {
  getPdfApp: () => PDFViewerApp | undefined;
  getCurrentBookId: () => Promise<string | null>;
  resolveBookId: (bookId?: string) => Promise<string | null>;
  resolveBookTitle: (bookId: string) => Promise<string>;
  getBookPageText: (bookId: string, pageNum: number) => Promise<string>;
  getBookPageCount: (bookId: string) => Promise<number>;
  getAllPageTexts: (bookId: string) => Promise<string[]>;
  buildRegex: (query: string) => RegExp;
  extractSnippet: (text: string, match: RegExpMatchArray, contextChars?: number) => string;
  getAllBooks: () => Promise<Book[]>;
  getBook: (id: string) => Promise<Book | null>;
  saveBook: (book: Book) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  getAllFolders: () => Promise<Folder[]>;
  getFolder: (id: string) => Promise<Folder | null>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  deleteBookData: (bookId: string) => void;
  removeChatEntry: (id: string) => void;
  getOnBookChange: () => ((bookId: string) => void) | null;
  pageHistory: number[];
  setSuppressNextTrackedPageChange: (value: boolean) => void;
}

export type ToolRegistrar = (def: ToolDefinition) => void;
