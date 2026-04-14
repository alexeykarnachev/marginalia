// Marginalia — library data layer
// In browser: backed by IndexedDB. In tests: backed by in-memory store.
//
// Data model (IDB v3 — split stores):
//   books_meta: { id, title, filename, size, pages, folder_id, archived, createdAt, coverDataUrl }
//   books_data: { id, data }
//   folders:    { id, name, parent_id, createdAt }

import type { Book, BookMeta, BookData, Folder } from '../types';
import { IDB_NAME, IDB_VERSION } from './constants';
import { log } from './logger';
import { AppError, isPermanentDbError, formatError } from './errors';

const BOOK_DATA_PREFIXES = ['chat', 'stats', 'model', 'prompt', 'compact_prompt'] as const;

export const MARGINALIA_VERSION = 221;

// --- Storage backend interface ---

export interface DbBackend {
  getAllBooksMeta: () => Promise<BookMeta[]>;
  getBookMeta: (id: string) => Promise<BookMeta | null>;
  getBook: (id: string) => Promise<Book | null>;
  saveBook: (book: Book) => Promise<void>;
  saveBookMeta: (meta: BookMeta) => Promise<void>;
  updateBookMeta: (id: string, partial: Partial<BookMeta>) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  saveBooksMetaBatch: (metas: BookMeta[]) => Promise<void>;
  getAllFolders: () => Promise<Folder[]>;
  getFolder: (id: string) => Promise<Folder | null>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  saveFolders: (folders: Folder[]) => Promise<void>;
}

export interface MemoryBackend extends DbBackend {
  _books: Map<string, Book>;
  _folders: Map<string, Folder>;
}

// --- IndexedDB connection management ---

let _cachedDb: IDBDatabase | null = null;

function _openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books_meta')) {
        db.createObjectStore('books_meta', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('books_data')) {
        db.createObjectStore('books_data', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      // Clean up legacy store from v2
      if (db.objectStoreNames.contains('books')) {
        db.deleteObjectStore('books');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { _cachedDb = null; };
      db.onversionchange = () => { db.close(); _cachedDb = null; };
      _cachedDb = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function _getDb(): Promise<IDBDatabase> {
  if (_cachedDb) return Promise.resolve(_cachedDb);
  return _openDb();
}

function _resetDb(): void {
  if (_cachedDb) {
    try { _cachedDb.close(); } catch {}
    _cachedDb = null;
  }
}

// Safari closes IndexedDB connections when the app is backgrounded.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _cachedDb) {
      _cachedDb.close();
      _cachedDb = null;
    }
  });
}

/**
 * Run an operation against the DB, retrying once on transient errors.
 * Permanent errors (QuotaExceededError, NotAllowedError) are not retried.
 */
async function _withRetry<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await _getDb();
    return await op(db);
  } catch (err) {
    if (isPermanentDbError(err)) {
      log('DB', 'permanent error, not retrying:', err);
      throw new AppError(
        (err as DOMException).name === 'QuotaExceededError'
          ? 'Storage is full. Delete some books to free space.'
          : `Database error: ${formatError(err)}`,
        { severity: 'error', retryable: false, cause: err }
      );
    }
    log('DB', 'transient error, retrying:', err);
    _resetDb();
    try {
      const db = await _getDb();
      return await op(db);
    } catch (retryErr) {
      log('DB', 'retry also failed:', retryErr);
      throw new AppError(
        `Database operation failed: ${formatError(retryErr)}`,
        { severity: 'error', retryable: true, cause: retryErr }
      );
    }
  }
}

// --- Swappable backend (for tests) ---

let _backend: DbBackend | null = null;

// --- Public API ---

/** Get all book metadata (no PDF data). Fast and safe for UI. */
export async function getAllBooksMeta(): Promise<BookMeta[]> {
  if (_backend) return _backend.getAllBooksMeta();
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books_meta', 'readonly');
    const req = tx.objectStore('books_meta').getAll();
    req.onsuccess = () => resolve(req.result as BookMeta[]);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Get single book metadata (no PDF data). */
export async function getBookMeta(id: string): Promise<BookMeta | null> {
  if (_backend) return _backend.getBookMeta(id);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books_meta', 'readonly');
    const req = tx.objectStore('books_meta').get(id);
    req.onsuccess = () => resolve((req.result as BookMeta) ?? null);
    tx.onerror = () => reject(tx.error);
  }));
}

/** Get full book (metadata + PDF data). Use only when PDF data is needed. */
export async function getBook(id: string): Promise<Book | null> {
  if (_backend) return _backend.getBook(id);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['books_meta', 'books_data'], 'readonly');
    const metaReq = tx.objectStore('books_meta').get(id);
    const dataReq = tx.objectStore('books_data').get(id);
    tx.oncomplete = () => {
      const meta = metaReq.result as BookMeta | undefined;
      const data = dataReq.result as BookData | undefined;
      if (!meta) { resolve(null); return; }
      resolve({ ...meta, data: data?.data ?? new Blob() });
    };
    tx.onerror = () => reject(tx.error);
  }));
}

/** Save a full book (metadata + PDF data) in one transaction. */
export async function saveBook(book: Book): Promise<void> {
  if (_backend) return _backend.saveBook(book);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['books_meta', 'books_data'], 'readwrite');
    const { data, ...meta } = book;
    tx.objectStore('books_meta').put(meta);
    tx.objectStore('books_data').put({ id: book.id, data });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Save only book metadata (no PDF data touched). */
export async function saveBookMeta(meta: BookMeta): Promise<void> {
  if (_backend) return _backend.saveBookMeta(meta);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books_meta', 'readwrite');
    tx.objectStore('books_meta').put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Partial update of book metadata. Reads meta, applies patch, writes back. No PDF data involved. */
export async function updateBookMeta(id: string, partial: Partial<BookMeta>): Promise<void> {
  if (_backend) return _backend.updateBookMeta(id, partial);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books_meta', 'readwrite');
    const store = tx.objectStore('books_meta');
    const req = store.get(id);
    req.onsuccess = () => {
      const existing = req.result;
      if (!existing) { reject(new Error(`Book ${id} not found`)); return; }
      store.put({ ...existing, ...partial, id });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Delete a book from both metadata and data stores. */
export async function deleteBook(id: string): Promise<void> {
  if (_backend) return _backend.deleteBook(id);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction(['books_meta', 'books_data'], 'readwrite');
    tx.objectStore('books_meta').delete(id);
    tx.objectStore('books_data').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Save multiple book metadata records in a single transaction. */
export async function saveBooksMetaBatch(metas: BookMeta[]): Promise<void> {
  if (_backend) return _backend.saveBooksMetaBatch(metas);
  if (metas.length === 0) return;
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books_meta', 'readwrite');
    const store = tx.objectStore('books_meta');
    for (const m of metas) store.put(m);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// --- Folders ---

export async function getAllFolders(): Promise<Folder[]> {
  if (_backend) return _backend.getAllFolders();
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readonly');
    const req = tx.objectStore('folders').getAll();
    req.onsuccess = () => resolve(req.result as Folder[]);
    tx.onerror = () => reject(tx.error);
  }));
}

export async function getFolder(id: string): Promise<Folder | null> {
  if (_backend) return _backend.getFolder(id);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readonly');
    const req = tx.objectStore('folders').get(id);
    req.onsuccess = () => resolve((req.result as Folder) ?? null);
    tx.onerror = () => reject(tx.error);
  }));
}

export async function saveFolder(folder: Folder): Promise<void> {
  if (_backend) return _backend.saveFolder(folder);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export async function deleteFolder(id: string): Promise<void> {
  if (_backend) return _backend.deleteFolder(id);
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

export async function saveFolders(folders: Folder[]): Promise<void> {
  if (_backend) return _backend.saveFolders(folders);
  if (folders.length === 0) return;
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    for (const f of folders) store.put(f);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// --- Misc ---

export function deleteBookData(bookId: string): void {
  BOOK_DATA_PREFIXES.forEach((k) =>
    localStorage.removeItem(`marginalia_${k}_${bookId}`)
  );
}

// --- In-memory backend (for tests and Node.js) ---

export function createMemoryBackend(): MemoryBackend {
  const books = new Map<string, Book>();
  const folders = new Map<string, Folder>();

  return {
    getAllBooksMeta: async () => [...books.values()].map(({ data, ...meta }) => meta),
    getBookMeta: async (id) => {
      const b = books.get(id);
      if (!b) return null;
      const { data, ...meta } = b;
      return meta;
    },
    getBook: async (id) => books.get(id) || null,
    saveBook: async (book) => { books.set(book.id, { ...book }); },
    saveBookMeta: async (meta) => {
      const existing = books.get(meta.id);
      if (existing) books.set(meta.id, { ...existing, ...meta });
      else books.set(meta.id, { ...meta, data: new Blob() });
    },
    updateBookMeta: async (id, partial) => {
      const existing = books.get(id);
      if (existing) books.set(id, { ...existing, ...partial, id });
    },
    deleteBook: async (id) => { books.delete(id); },
    saveBooksMetaBatch: async (metas) => {
      for (const m of metas) {
        const existing = books.get(m.id);
        if (existing) books.set(m.id, { ...existing, ...m });
        else books.set(m.id, { ...m, data: new Blob() });
      }
    },

    getAllFolders: async () => [...folders.values()],
    getFolder: async (id) => folders.get(id) || null,
    saveFolder: async (folder) => { folders.set(folder.id, { ...folder }); },
    deleteFolder: async (id) => { folders.delete(id); },
    saveFolders: async (flds) => { for (const f of flds) folders.set(f.id, { ...f }); },

    _books: books,
    _folders: folders,
  };
}

export function setBackend(backend: DbBackend | null): void {
  _backend = backend;
}
