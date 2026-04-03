<script lang="ts">
  import { onMount } from 'svelte';
  import LibraryApp from './library/LibraryApp.svelte';
  import ViewerApp from './viewer/ViewerApp.svelte';
  import Toast from './lib/components/Toast.svelte';
  import { applyTheme } from './lib/state/settings.svelte';
  import { createChatState } from './lib/state/chat.svelte';
  import { createChatManager } from './lib/state/chat-manager.svelte';
  import { library } from './lib/state/library.svelte';
  import { MARGINALIA_VERSION } from './lib/core/db';
  import { setOnBookChangeFn } from './lib/core/tools';
  import { LS_LIB_FOLDER, LS_ACTIVE_BOOK } from './lib/core/constants';
  import { getPdfjsLib } from './lib/core/pdfjs-loader';
  import { log } from './lib/core/logger';
  import { appStatus } from './lib/state/app-status.svelte';

  // --- Routing ---
  let currentView = $state<'library' | 'viewer'>('library');
  let activeBookId = $state<string | null>(null);

  function navigateToViewer(bookId: string) {
    activeBookId = bookId;
    currentView = 'viewer';
    localStorage.setItem(LS_ACTIVE_BOOK, bookId);
    history.pushState(null, '', '#book/' + bookId);
  }

  function navigateToLibrary() {
    currentView = 'library';
    activeBookId = null;
    localStorage.removeItem(LS_ACTIVE_BOOK);
    document.title = 'Marginalia';
    history.pushState(null, '', '#');
  }

  // --- Shared state ---
  let startupError = $state<string | null>(null);
  let currentFolderId = $state<string | null>(localStorage.getItem(LS_LIB_FOLDER));

  const chatState = createChatState();
  const chatManager = createChatManager(chatState);

  async function loadDefaultBook() {
    if (library.books.length > 0) return;
    try {
      const res = await fetch('./default-book.pdf');
      if (!res.ok) return;
      const data = await res.arrayBuffer();
      await library.addBook({
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

    // Restore state from URL hash or localStorage
    const hash = location.hash;
    const savedBook = localStorage.getItem(LS_ACTIVE_BOOK);
    if (hash.startsWith('#book/')) {
      activeBookId = hash.slice(6);
      currentView = 'viewer';
    } else if (savedBook) {
      activeBookId = savedBook;
      currentView = 'viewer';
      history.replaceState(null, '', '#book/' + savedBook);
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

    // Chat loads from localStorage — no async, do it immediately
    chatManager.init();

    // Load library and preload pdf.js
    void (async () => {
      try {
        await library.load();
        await loadDefaultBook();
        // Validate restored book still exists
        if (activeBookId && !library.books.some(b => b.id === activeBookId)) {
          navigateToLibrary();
        }
        getPdfjsLib();
      } catch (err: any) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        log('APP', 'INIT_ERROR', err);
        startupError = msg;
        appStatus.notify(`Startup failed: ${msg}`, 'fatal', () => location.reload());
        navigateToLibrary();
      }
    })();
  });
</script>

<Toast />

{#if startupError}
  <div style="position:fixed;top:0;left:0;right:0;background:#fee;color:#900;padding:12px 16px;font-size:14px;z-index:999999;font-family:monospace;word-break:break-all;">
    Startup error: {startupError}
    <button onclick={() => location.reload()} style="margin-left:12px;padding:4px 12px;">Reload</button>
  </div>
{/if}

{#if currentView === 'library'}
  <LibraryApp
    {currentFolderId}
    {chatState}
    {chatManager}
    version={MARGINALIA_VERSION}
    onOpenBook={(book) => navigateToViewer(book.id)}
    onFolderChange={(id) => { currentFolderId = id; id ? localStorage.setItem(LS_LIB_FOLDER, id) : localStorage.removeItem(LS_LIB_FOLDER); }}
  />
{:else if activeBookId}
  <ViewerApp
    bookId={activeBookId}
    {chatState}
    {chatManager}
    onGoBack={navigateToLibrary}
    onBookChange={(id) => { activeBookId = id; history.replaceState(null, '', '#book/' + id); }}
  />
{/if}
