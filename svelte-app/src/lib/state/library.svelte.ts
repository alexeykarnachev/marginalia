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
import { formatError } from '../core/errors';
import { appStatus } from './app-status.svelte';

// --- Reactive state ---

let _books = $state<BookMeta[]>([]);
let _folders = $state<Folder[]>([]);
let _loaded = $state(false);
let _libraryTree = $derived(buildLibraryTree(_books, _folders));

/** Run a mutation: update in-memory state first (via `apply`), then persist (via `persist`).
 *  On persist failure, reload from DB to restore consistency and show a toast. */
async function _mutate(apply: () => void, persist: () => Promise<void>, label: string) {
  apply();
  try {
    await persist();
  } catch (err) {
    log('LIBRARY', `${label} failed, reloading:`, err);
    appStatus.notify(`${label} failed: ${formatError(err)}`, 'error');
    // Reload from DB to restore consistency
    try {
      _books = await getAllBooksMeta();
      _folders = await getAllFolders();
      log('LIBRARY', `reload after ${label} failure: ${_books.length} books, ${_folders.length} folders`);
    } catch (reloadErr) {
      log('LIBRARY', `CRITICAL: reload after ${label} failure ALSO failed:`, reloadErr);
      appStatus.notify(`Reload failed: ${formatError(reloadErr)}`, 'error');
    }
  }
}

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

  /** Scan for orphaned books (books whose folder_id points to a non-existent folder)
   *  and move them back to root. Returns the list of repaired titles. */
  async repairOrphans(): Promise<string[]> {
    const folderIds = new Set(_folders.map(f => f.id));
    const orphans = _books.filter(b => b.folder_id && !folderIds.has(b.folder_id));
    if (orphans.length === 0) return [];
    // $state.snapshot strips Svelte reactive proxies — required for structured
    // clone (IndexedDB) to accept the object, otherwise DataCloneError.
    const fixed: BookMeta[] = orphans.map(b => ({ ...$state.snapshot(b), folder_id: null }));
    await _mutate(
      () => {
        const idSet = new Set(fixed.map(f => f.id));
        const map = new Map(fixed.map(f => [f.id, f]));
        _books = _books.map(b => idSet.has(b.id) ? map.get(b.id)! : b);
      },
      () => dbSaveBooksMetaBatch(fixed),
      'Repair orphans',
    );
    const titles = orphans.map(b => b.title);
    log('LIBRARY', `repaired ${orphans.length} orphan(s): ${titles.join(', ')}`);
    return titles;
  },

  /** Un-archive every archived book. Returns the count. */
  async unarchiveAll(): Promise<number> {
    const archived = _books.filter(b => b.archived);
    if (archived.length === 0) return 0;
    const fixed: BookMeta[] = archived.map(b => ({ ...$state.snapshot(b), archived: false }));
    await _mutate(
      () => {
        const idSet = new Set(fixed.map(f => f.id));
        const map = new Map(fixed.map(f => [f.id, f]));
        _books = _books.map(b => idSet.has(b.id) ? map.get(b.id)! : b);
      },
      () => dbSaveBooksMetaBatch(fixed),
      'Unarchive all',
    );
    log('LIBRARY', `unarchived ${archived.length} book(s)`);
    return archived.length;
  },

  // --- Book mutations ---

  async addBook(book: Book) {
    const { data, ...meta } = book;
    await _mutate(
      () => { _books = [..._books, meta]; },
      () => dbSaveBook(book),
      'Add book',
    );
  },

  async updateBook(id: string, patch: Partial<BookMeta>) {
    await _mutate(
      () => { _books = _books.map(b => b.id === id ? { ...b, ...patch } : b); },
      () => dbUpdateBookMeta(id, patch),
      'Update book',
    );
  },

  async deleteBook(id: string) {
    await _mutate(
      () => { _books = _books.filter(b => b.id !== id); },
      async () => { await dbDeleteBook(id); deleteBookData(id); },
      'Delete book',
    );
  },

  async updateBooksBatch(updates: { id: string; patch: Partial<BookMeta> }[]) {
    const patchMap = new Map(updates.map(u => [u.id, u.patch]));
    const metas: BookMeta[] = [];
    await _mutate(
      () => {
        _books = _books.map(b => {
          const patch = patchMap.get(b.id);
          if (patch) {
            const updated = { ...b, ...patch };
            // Snapshot before pushing to the persist list so IndexedDB
            // sees a plain object rather than a Svelte reactive proxy.
            metas.push($state.snapshot(updated) as BookMeta);
            return updated;
          }
          return b;
        });
      },
      () => dbSaveBooksMetaBatch(metas),
      'Batch update books',
    );
  },

  async saveBooksMetaBatch(metas: BookMeta[]) {
    // Snapshot incoming metas in case the caller passed reactive refs.
    const plain = metas.map(m => $state.snapshot(m) as BookMeta);
    const idSet = new Set(plain.map(m => m.id));
    const metaMap = new Map(plain.map(m => [m.id, m]));
    await _mutate(
      () => { _books = _books.map(b => idSet.has(b.id) ? metaMap.get(b.id)! : b); },
      () => dbSaveBooksMetaBatch(plain),
      'Batch save books',
    );
  },

  async getFullBook(id: string): Promise<Book | null> {
    return dbGetBook(id);
  },

  getBook(id: string): BookMeta | undefined {
    return _books.find(b => b.id === id);
  },

  // --- Folder mutations ---

  async addFolder(folder: Folder) {
    await _mutate(
      () => { _folders = [..._folders, folder]; },
      () => dbSaveFolder(folder),
      'Add folder',
    );
  },

  async updateFolder(id: string, patch: Partial<Folder>) {
    const folder = _folders.find(f => f.id === id);
    if (!folder) return;
    const updated = { ...folder, ...patch };
    await _mutate(
      () => { _folders = _folders.map(f => f.id === id ? updated : f); },
      () => dbSaveFolder(updated),
      'Update folder',
    );
  },

  async deleteFolder(id: string) {
    await _mutate(
      () => { _folders = _folders.filter(f => f.id !== id); },
      () => dbDeleteFolder(id),
      'Delete folder',
    );
  },

  async saveFoldersBatch(folders: Folder[]) {
    const idSet = new Set(folders.map(f => f.id));
    const folderMap = new Map(folders.map(f => [f.id, f]));
    await _mutate(
      () => { _folders = _folders.map(f => idSet.has(f.id) ? folderMap.get(f.id)! : f); },
      () => dbSaveFolders(folders),
      'Batch save folders',
    );
  },

  getFolder(id: string): Folder | undefined {
    return _folders.find(f => f.id === id);
  },
};
