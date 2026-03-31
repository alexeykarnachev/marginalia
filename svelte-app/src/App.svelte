<script lang="ts">
  import { onMount } from 'svelte';
  import LibraryApp from './library/LibraryApp.svelte';
  import ViewerApp from './viewer/ViewerApp.svelte';
  import { applyTheme } from './lib/state/settings.svelte';
  import { createChatState } from './lib/state/chat.svelte';
  import { createChatManager } from './lib/state/chat-manager.svelte';
  import { getAllBooksMeta, getAllFolders, saveBook, MARGINALIA_VERSION } from './lib/core/db';
  import { setOnBookChangeFn } from './lib/core/tools';
  import { getPdfjsLib } from './lib/core/pdfjs-loader';
  import { log } from './lib/core/logger';
  import type { Book, Folder } from './lib/types';

  // --- Routing ---
  let currentView = $state<'library' | 'viewer'>('library');
  let activeBookId = $state<string | null>(null);

  function navigateToViewer(bookId: string) {
    activeBookId = bookId;
    currentView = 'viewer';
    history.pushState(null, '', '#book/' + bookId);
  }

  function navigateToLibrary() {
    currentView = 'library';
    activeBookId = null;
    document.title = 'Marginalia';
    history.pushState(null, '', '#');
  }

  // --- Shared state ---
  let books = $state<Book[]>([]);
  let folders = $state<Folder[]>([]);
  let libraryLoaded = $state(false);
  let currentFolderId = $state<string | null>(null);

  const chatState = createChatState();
  const chatManager = createChatManager(chatState);

  async function refreshLibrary() {
    log('APP', 'refreshLibrary START');
    books = await getAllBooksMeta();
    folders = await getAllFolders();
    libraryLoaded = true;
    log('APP', 'refreshLibrary DONE', books.length, 'books', folders.length, 'folders');
  }

  async function loadDefaultBook() {
    const existing = await getAllBooksMeta();
    if (existing.length > 0) return;
    try {
      const res = await fetch('./default-book.pdf');
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      await saveBook({
        id: '1984',
        title: '1984',
        filename: '1984.pdf',
        data,
        size: data.byteLength,
        pages: null,
        folder_id: null,
        createdAt: Date.now(),
      });
    } catch {}
  }

  onMount(() => {
    log('APP', 'onMount');
    applyTheme();

    // Restore state from URL hash
    const hash = location.hash;
    if (hash.startsWith('#book/')) {
      activeBookId = hash.slice(6);
      currentView = 'viewer';
    }

    // Global book change handler (used by chat tools)
    setOnBookChangeFn((bookId: string) => navigateToViewer(bookId));

    // Browser back/forward
    window.addEventListener('popstate', () => {
      const h = location.hash;
      if (h.startsWith('#book/')) {
        activeBookId = h.slice(6);
        currentView = 'viewer';
      } else {
        currentView = 'library';
        activeBookId = null;
        document.title = 'Marginalia';
      }
    });

    // Load data and preload pdf.js
    void (async () => {
      await loadDefaultBook();
      await refreshLibrary();
      chatManager.init();
      // Preload pdf.js so cover rendering doesn't inject a script tag later
      getPdfjsLib();
    })();
  });
</script>

{#if currentView === 'library'}
  <LibraryApp
    {books}
    {folders}
    {libraryLoaded}
    {currentFolderId}
    {chatState}
    {chatManager}
    {refreshLibrary}
    version={MARGINALIA_VERSION}
    onOpenBook={(book) => navigateToViewer(book.id)}
    onFolderChange={(id) => { currentFolderId = id; }}
  />
{:else if activeBookId}
  <ViewerApp
    bookId={activeBookId}
    allBooks={books.map(b => ({ id: b.id, title: b.title }))}
    {chatState}
    {chatManager}
    onGoBack={navigateToLibrary}
    onBookChange={(id) => { activeBookId = id; history.replaceState(null, '', '#book/' + id); }}
    onLibraryRefresh={refreshLibrary}
  />
{/if}
