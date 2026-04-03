// Router — hash-based navigation state.
// Singleton reactive store. Manages view switching and URL hash sync.

import { LS_ACTIVE_BOOK, LS_LIB_FOLDER } from '../core/constants';
import { log } from '../core/logger';

let _currentView = $state<'library' | 'viewer'>('library');
let _activeBookId = $state<string | null>(null);
let _currentFolderId = $state<string | null>(localStorage.getItem(LS_LIB_FOLDER));

export const router = {
  get currentView() { return _currentView; },
  get activeBookId() { return _activeBookId; },
  get currentFolderId() { return _currentFolderId; },

  navigateToViewer(bookId: string) {
    _activeBookId = bookId;
    _currentView = 'viewer';
    localStorage.setItem(LS_ACTIVE_BOOK, bookId);
    history.pushState(null, '', '#book/' + bookId);
  },

  navigateToLibrary() {
    _currentView = 'library';
    _activeBookId = null;
    localStorage.removeItem(LS_ACTIVE_BOOK);
    document.title = 'Marginalia';
    history.pushState(null, '', '#');
  },

  /** Switch to a different book while already in viewer (no history push). */
  switchBook(bookId: string) {
    _activeBookId = bookId;
    history.replaceState(null, '', '#book/' + bookId);
  },

  setFolder(id: string | null) {
    _currentFolderId = id;
    id ? localStorage.setItem(LS_LIB_FOLDER, id) : localStorage.removeItem(LS_LIB_FOLDER);
  },

  /** Restore state from URL hash or localStorage. Call once on mount. */
  init() {
    const hash = location.hash;
    const savedBook = localStorage.getItem(LS_ACTIVE_BOOK);
    if (hash.startsWith('#book/')) {
      _activeBookId = hash.slice(6);
      _currentView = 'viewer';
    } else if (savedBook) {
      _activeBookId = savedBook;
      _currentView = 'viewer';
      history.replaceState(null, '', '#book/' + savedBook);
    }

    window.addEventListener('popstate', () => {
      const h = location.hash;
      if (h.startsWith('#book/')) {
        _activeBookId = h.slice(6);
        _currentView = 'viewer';
      } else {
        _currentView = 'library';
        _activeBookId = null;
        document.title = 'Marginalia';
      }
    });

    log('ROUTER', 'init', _currentView, _activeBookId);
  },
};
