// Library store — single source of truth for books and folders.
// UI components and tools read from here; mutations update $state and persist to IndexedDB.

import type { Book, BookMeta, Folder } from '../types';
import {
  getAllBooksMeta,
  getBook as dbGetBook,
  saveBook as dbSaveBook,
  updateBookMeta as dbUpdateBookMeta,
  saveBooksMetaBatch as dbSaveBooksMetaBatch,
  deleteBook as dbDeleteBook,
  getAllFolders,
  saveFolder as dbSaveFolder,
  saveFolders as dbSaveFolders,
  deleteFolder as dbDeleteFolder,
  deleteBookData,
} from '../core/db';
import { buildLibraryTree } from '../core/library-tree';
import { log } from '../core/logger';

// --- Reactive state ---

let _books = $state<BookMeta[]>([]);
let _folders = $state<Folder[]>([]);
let _loaded = $state(false);
let _libraryTree = $derived(buildLibraryTree(_books, _folders));

// --- Public API ---

export const library = {
  get books() { return _books; },
  get folders() { return _folders; },
  get loaded() { return _loaded; },
  get libraryTree() { return _libraryTree; },

  /** Initial load from IndexedDB. Call once at startup. */
  async load() {
    log('LIBRARY', 'load START');
    _books = await getAllBooksMeta();
    _folders = await getAllFolders();
    _loaded = true;
    log('LIBRARY', 'load DONE', _books.length, 'books', _folders.length, 'folders');
  },

  // --- Book mutations ---

  /** Add a new book (with PDF data). */
  async addBook(book: Book) {
    await dbSaveBook(book);
    const { data, ...meta } = book;
    _books = [..._books, meta];
  },

  /** Update book metadata fields. No PDF data involved. */
  async updateBook(id: string, patch: Partial<BookMeta>) {
    await dbUpdateBookMeta(id, patch);
    _books = _books.map(b => b.id === id ? { ...b, ...patch } : b);
  },

  /** Delete a book from DB and in-memory state. */
  async deleteBook(id: string) {
    await dbDeleteBook(id);
    deleteBookData(id);
    _books = _books.filter(b => b.id !== id);
  },

  /** Batch update metadata for multiple books. */
  async updateBooksBatch(updates: { id: string; patch: Partial<BookMeta> }[]) {
    const metas: BookMeta[] = [];
    const patchMap = new Map(updates.map(u => [u.id, u.patch]));
    _books = _books.map(b => {
      const patch = patchMap.get(b.id);
      if (patch) {
        const updated = { ...b, ...patch };
        metas.push(updated);
        return updated;
      }
      return b;
    });
    await dbSaveBooksMetaBatch(metas);
  },

  /** Save multiple full BookMeta objects (replace in-memory + persist). */
  async saveBooksMetaBatch(metas: BookMeta[]) {
    const idSet = new Set(metas.map(m => m.id));
    const metaMap = new Map(metas.map(m => [m.id, m]));
    _books = _books.map(b => idSet.has(b.id) ? metaMap.get(b.id)! : b);
    await dbSaveBooksMetaBatch(metas);
  },

  /** Get a full book (with PDF data) from IndexedDB. For viewer/indexer only. */
  async getFullBook(id: string): Promise<Book | null> {
    return dbGetBook(id);
  },

  /** Get book metadata from in-memory state. */
  getBook(id: string): BookMeta | undefined {
    return _books.find(b => b.id === id);
  },

  // --- Folder mutations ---

  async addFolder(folder: Folder) {
    await dbSaveFolder(folder);
    _folders = [..._folders, folder];
  },

  async updateFolder(id: string, patch: Partial<Folder>) {
    const folder = _folders.find(f => f.id === id);
    if (!folder) return;
    const updated = { ...folder, ...patch };
    await dbSaveFolder(updated);
    _folders = _folders.map(f => f.id === id ? updated : f);
  },

  async deleteFolder(id: string) {
    await dbDeleteFolder(id);
    _folders = _folders.filter(f => f.id !== id);
  },

  async saveFoldersBatch(folders: Folder[]) {
    await dbSaveFolders(folders);
    const idSet = new Set(folders.map(f => f.id));
    const folderMap = new Map(folders.map(f => [f.id, f]));
    _folders = _folders.map(f => idSet.has(f.id) ? folderMap.get(f.id)! : f);
  },

  getFolder(id: string): Folder | undefined {
    return _folders.find(f => f.id === id);
  },
};
