// Marginalia — library data layer
// In browser: backed by IndexedDB. In tests: backed by in-memory store.
//
// Data model:
//   Book:   { id, title, filename, data, size, folder_id? }
//   Folder: { id, name, parent_id? }

import type { Book, Folder } from '../types';
import { IDB_NAME, IDB_VERSION } from './constants';

const BOOK_DATA_PREFIXES = ['chat', 'stats', 'model', 'prompt', 'compact_prompt'] as const;

export const MARGINALIA_VERSION = 94;

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

const _db: {
  _backend: DbBackend | null;
  _cachedDb: IDBDatabase | null;
  _idb: () => Promise<IDBDatabase>;
  _idbGetAll: <T>(store: string) => Promise<T[]>;
  _idbGet: <T>(store: string, id: string) => Promise<T | undefined>;
  _idbPut: (store: string, obj: unknown) => Promise<void>;
  _idbDelete: (store: string, id: string) => Promise<void>;
} = {
  _backend: null,
  _cachedDb: null,

  async _idb(): Promise<IDBDatabase> {
    if (this._cachedDb) return this._cachedDb;
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
        this._cachedDb = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async _idbGetAll<T>(store: string): Promise<T[]> {
    const db = await this._idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  },

  async _idbGet<T>(store: string, id: string): Promise<T | undefined> {
    const db = await this._idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  },

  async _idbPut(store: string, obj: unknown): Promise<void> {
    const db = await this._idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async _idbDelete(store: string, id: string): Promise<void> {
    const db = await this._idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// --- Public API (tools and app code call these) ---

export async function getAllBooks(): Promise<Book[]> {
  if (_db._backend) return _db._backend.getAllBooks();
  return _db._idbGetAll<Book>('books');
}

export async function getBook(id: string): Promise<Book | null> {
  if (_db._backend) return _db._backend.getBook(id);
  return (await _db._idbGet<Book>('books', id)) ?? null;
}

export async function saveBook(book: Book): Promise<void> {
  if (_db._backend) return _db._backend.saveBook(book);
  return _db._idbPut('books', book);
}

export async function deleteBook(id: string): Promise<void> {
  if (_db._backend) return _db._backend.deleteBook(id);
  return _db._idbDelete('books', id);
}

export async function getAllFolders(): Promise<Folder[]> {
  if (_db._backend) return _db._backend.getAllFolders();
  return _db._idbGetAll<Folder>('folders');
}

export async function getFolder(id: string): Promise<Folder | null> {
  if (_db._backend) return _db._backend.getFolder(id);
  return (await _db._idbGet<Folder>('folders', id)) ?? null;
}

export async function saveFolder(folder: Folder): Promise<void> {
  if (_db._backend) return _db._backend.saveFolder(folder);
  return _db._idbPut('folders', folder);
}

export async function deleteFolder(id: string): Promise<void> {
  if (_db._backend) return _db._backend.deleteFolder(id);
  return _db._idbDelete('folders', id);
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
  _db._backend = backend;
}
