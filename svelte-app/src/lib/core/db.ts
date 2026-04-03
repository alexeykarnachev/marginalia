// Marginalia — library data layer
// In browser: backed by IndexedDB. In tests: backed by in-memory store.
//
// Data model:
//   Book:   { id, title, filename, data, size, folder_id? }
//   Folder: { id, name, parent_id? }

import type { Book, Folder } from '../types';
import { IDB_NAME, IDB_VERSION } from './constants';

const BOOK_DATA_PREFIXES = ['chat', 'stats', 'model', 'prompt', 'compact_prompt'] as const;

export const MARGINALIA_VERSION = 195;

// --- Storage backend interface ---

export interface DbBackend {
  getAllBooks: () => Promise<Book[]>;
  getBook: (id: string) => Promise<Book | null>;
  saveBook: (book: Book) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  getAllFolders: () => Promise<Folder[]>;
  getFolder: (id: string) => Promise<Folder | null>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
}

export interface MemoryBackend extends DbBackend {
  _books: Map<string, Book>;
  _folders: Map<string, Folder>;
}

// --- Storage backend (swappable for tests) ---

let _cachedDb: IDBDatabase | null = null;

function _openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { _cachedDb = null; };
      db.onerror = () => { _cachedDb = null; };
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

/** Force-drop the cached connection so the next _getDb() opens a fresh one. */
function _resetDb(): void {
  if (_cachedDb) {
    try { _cachedDb.close(); } catch {}
    _cachedDb = null;
  }
}

/**
 * Run an operation that needs a db, retrying once with a fresh connection on failure.
 * This handles the case where the cached connection has gone stale (iPad backgrounding,
 * memory pressure, etc.) — the first attempt fails, we reconnect, second attempt succeeds.
 */
async function _withRetry<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await _getDb();
    return await op(db);
  } catch {
    _resetDb();
    const db = await _getDb();
    return await op(db);
  }
}

function _txGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    tx.onerror = () => reject(tx.error);
  });
}

function _txGet<T>(db: IDBDatabase, store: string, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    tx.onerror = () => reject(tx.error);
  });
}

function _txPut(db: IDBDatabase, store: string, obj: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function _txDelete(db: IDBDatabase, store: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Safari closes IndexedDB connections when the app is backgrounded.
// Proactively drop the cached connection so the next operation reconnects cleanly.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _cachedDb) {
      _cachedDb.close();
      _cachedDb = null;
    }
  });
}

let _backend: DbBackend | null = null;

// --- Public API (tools and app code call these) ---

/** Load all books WITH full PDF data (use sparingly — high memory) */
export async function getAllBooks(): Promise<Book[]> {
  if (_backend) return _backend.getAllBooks();
  return _withRetry(db => _txGetAll<Book>(db, 'books'));
}

/** Load all books WITHOUT PDF data — safe for grid/library display */
export async function getAllBooksMeta(): Promise<Book[]> {
  if (_backend) return _backend.getAllBooks();
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readonly');
    const store = tx.objectStore('books');
    const results: Book[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        results.push({ ...cursor.value as Book, data: new Blob() });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    tx.onerror = () => reject(tx.error);
  }));
}

export async function getBook(id: string): Promise<Book | null> {
  if (_backend) return _backend.getBook(id);
  return (await _withRetry(db => _txGet<Book>(db, 'books', id))) ?? null;
}

export async function saveBook(book: Book): Promise<void> {
  if (_backend) return _backend.saveBook(book);
  return _withRetry(db => _txPut(db, 'books', book));
}

export async function deleteBook(id: string): Promise<void> {
  if (_backend) return _backend.deleteBook(id);
  return _withRetry(db => _txDelete(db, 'books', id));
}

export async function getAllFolders(): Promise<Folder[]> {
  if (_backend) return _backend.getAllFolders();
  return _withRetry(db => _txGetAll<Folder>(db, 'folders'));
}

export async function getFolder(id: string): Promise<Folder | null> {
  if (_backend) return _backend.getFolder(id);
  return (await _withRetry(db => _txGet<Folder>(db, 'folders', id))) ?? null;
}

export async function saveFolder(folder: Folder): Promise<void> {
  if (_backend) return _backend.saveFolder(folder);
  return _withRetry(db => _txPut(db, 'folders', folder));
}

export async function deleteFolder(id: string): Promise<void> {
  if (_backend) return _backend.deleteFolder(id);
  return _withRetry(db => _txDelete(db, 'folders', id));
}

/** Save multiple books in a single transaction */
export async function saveBooks(books: Book[]): Promise<void> {
  if (_backend) { for (const b of books) await _backend.saveBook(b); return; }
  if (books.length === 0) return;
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    for (const b of books) store.put(b);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Save multiple folders in a single transaction */
export async function saveFolders(folders: Folder[]): Promise<void> {
  if (_backend) { for (const f of folders) await _backend.saveFolder(f); return; }
  if (folders.length === 0) return;
  return _withRetry(db => new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    const store = tx.objectStore('folders');
    for (const f of folders) store.put(f);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

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
    // Books
    getAllBooks: async () => [...books.values()],
    getBook: async (id: string) => books.get(id) || null,
    saveBook: async (book: Book) => {
      books.set(book.id, { ...book });
    },
    deleteBook: async (id: string) => {
      books.delete(id);
    },

    // Folders
    getAllFolders: async () => [...folders.values()],
    getFolder: async (id: string) => folders.get(id) || null,
    saveFolder: async (folder: Folder) => {
      folders.set(folder.id, { ...folder });
    },
    deleteFolder: async (id: string) => {
      folders.delete(id);
    },

    // Test helpers
    _books: books,
    _folders: folders,
  };
}

export function setBackend(backend: DbBackend | null): void {
  _backend = backend;
}
